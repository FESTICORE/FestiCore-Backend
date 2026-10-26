import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { artistNameKeys } from '../../../../common/artist-name';
import { AdminAuditService } from '../../audit/admin-audit.service';
import {
  CrawlLineupRevision,
  ReviewedLineupArtist,
} from '../entity/crawl-lineup-revision.entity';
import { CrawlRun } from '../entity/crawl-run.entity';
import { CrawlSource } from '../entity/crawl-source.entity';
import { NolLineupEvidence } from './nol-world-lineup-evidence';

function validatedArtists(
  raw: unknown,
  lines: string[],
): ReviewedLineupArtist[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 80 || !lines.length)
    throw new BadRequestException('OCR 원본에 대응하는 출연진이 필요합니다.');
  const names = new Set<string>();
  return raw.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new BadRequestException('출연진 항목이 올바르지 않습니다.');
    const artist = item as Record<string, unknown>;
    if (
      Object.keys(artist).some((key) => !['name', 'lineIndex'].includes(key)) ||
      typeof artist.name !== 'string' ||
      !artist.name.trim() ||
      artist.name.length > 160 ||
      [...artist.name].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !Number.isInteger(artist.lineIndex) ||
      (artist.lineIndex as number) < 0 ||
      (artist.lineIndex as number) >= lines.length
    )
      throw new BadRequestException(
        'OCR 출처, 출연진 이름 또는 날짜가 올바르지 않습니다.',
      );
    const name = artist.name.trim();
    const keys = artistNameKeys(name);
    if (keys.some((key) => names.has(key)))
      throw new BadRequestException('중복된 출연진 이름입니다.');
    keys.forEach((key) => names.add(key));
    return {
      name,
      lineIndex: artist.lineIndex as number,
    };
  });
}

@Injectable()
export class CrawlLineupRevisionService {
  constructor(
    @InjectRepository(CrawlLineupRevision)
    private readonly revisions: Repository<CrawlLineupRevision>,
    @InjectRepository(CrawlRun) private readonly runs: Repository<CrawlRun>,
    @InjectRepository(CrawlSource)
    private readonly sources: Repository<CrawlSource>,
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  async list(sourceId?: string, status?: string) {
    if (
      sourceId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        sourceId,
      )
    )
      throw new BadRequestException('유효한 소스 ID가 필요합니다.');
    if (status && !['pending', 'approved', 'rejected'].includes(status))
      throw new BadRequestException('유효한 검토 상태가 필요합니다.');
    const query = this.revisions.createQueryBuilder('revision');
    if (sourceId) query.andWhere('revision.sourceId = :sourceId', { sourceId });
    if (status) query.andWhere('revision.status = :status', { status });
    return {
      items: await query
        .orderBy('revision.createdAt', 'DESC')
        .limit(100)
        .getMany(),
    };
  }

  private async latestEvidence(
    sourceId: string,
    runId: string,
    imageUrl: string,
    imageHash: string,
  ): Promise<NolLineupEvidence> {
    if (!/^[0-9a-f]{64}$/i.test(imageHash))
      throw new BadRequestException('이미지 SHA-256이 필요합니다.');
    const source = await this.sources.findOne({ where: { id: sourceId } });
    if (
      !source ||
      !source.enabled ||
      source.kind !== 'discovery' ||
      source.parser !== 'ticket-list' ||
      !/^https:\/\/world\.nol\.com\/en\/ticket\/products\/\d+$/.test(source.url)
    )
      throw new BadRequestException('NOL World 상품 소스가 아닙니다.');
    const latest = await this.runs.findOne({
      where: { sourceId },
      order: { startedAt: 'DESC' },
    });
    if (
      !latest ||
      latest.id !== runId ||
      latest.result === 'failed' ||
      !latest.finishedAt
    )
      throw new ConflictException(
        '최신 완료 수집 실행의 증거를 사용해 주세요.',
      );
    const evidence = latest.lineupEvidence?.find(
      (item) =>
        item.imageUrl === imageUrl &&
        item.imageHash === imageHash &&
        item.status === 'ok' &&
        item.sourceUrl === source.url &&
        Array.isArray(item.rawLines) &&
        item.rawLines.length > 0,
    );
    if (!evidence)
      throw new ConflictException(
        '수집 증거가 변경되었거나 사용할 수 없습니다.',
      );
    return evidence;
  }

  async stage(runId: string, imageUrl: string, imageHash: string) {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('수집 실행을 찾을 수 없습니다.');
    const evidence = await this.latestEvidence(
      run.sourceId,
      runId,
      imageUrl,
      imageHash,
    );
    const key = {
      sourceId: run.sourceId,
      imageUrl: evidence.imageUrl,
      imageHash,
      parserVersion: evidence.parserVersion,
    };
    const existing = await this.revisions.findOne({ where: key });
    if (existing) {
      if (
        JSON.stringify(existing.rawLines) !== JSON.stringify(evidence.rawLines)
      )
        throw new ConflictException(
          '동일 이미지의 OCR 원문이 변경되었습니다. 파서 버전을 갱신해야 합니다.',
        );
      return existing;
    }
    const revision = this.revisions.create({
      ...key,
      runId,
      productUrl: evidence.sourceUrl,
      rawLines: evidence.rawLines,
      artists: [],
      status: 'pending',
      reviewedAt: null,
      reviewedBy: null,
    });
    try {
      return await this.revisions.save(revision);
    } catch (error) {
      const databaseError = error as {
        code?: string;
        driverError?: { code?: string };
      };
      if (
        databaseError.code !== '23505' &&
        databaseError.driverError?.code !== '23505'
      )
        throw error;
      // A concurrent staging request may have inserted the same immutable evidence.
      const raced = await this.revisions.findOne({ where: key });
      if (raced) {
        if (
          JSON.stringify(raced.rawLines) !== JSON.stringify(evidence.rawLines)
        )
          throw new ConflictException(
            '동일 이미지의 OCR 원문이 변경되었습니다. 파서 버전을 갱신해야 합니다.',
          );
        return raced;
      }
      throw error;
    }
  }

  async review(
    id: string,
    adminId: string,
    imageHash: string,
    decision: 'approved' | 'rejected',
    artists?: unknown,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CrawlLineupRevision);
      const revision = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!revision)
        throw new NotFoundException('출연진 검토본을 찾을 수 없습니다.');
      if (revision.status !== 'pending')
        throw new ConflictException('대기 중인 검토본만 처리할 수 있습니다.');
      if (revision.imageHash !== imageHash)
        throw new ConflictException('원본 이미지 해시가 다릅니다.');
      await this.assertLatestEvidence(manager, revision);
      const reviewedArtists =
        decision === 'approved'
          ? validatedArtists(artists, revision.rawLines)
          : [];
      revision.status = decision;
      revision.artists = reviewedArtists;
      revision.reviewedAt = new Date();
      revision.reviewedBy = adminId;
      const saved = await repository.save(revision);
      await this.audit.record(manager, {
        actor: adminId,
        action: `crawl.lineup.${decision}`,
        target: `crawl-lineup-revision:${id}`,
        before: { status: 'pending' },
        after: { status: saved.status, imageHash, artists: saved.artists },
      });
      return saved;
    });
  }

  private async assertLatestEvidence(
    manager: EntityManager,
    revision: CrawlLineupRevision,
  ) {
    const source = await manager.getRepository(CrawlSource).findOne({
      where: { id: revision.sourceId },
    });
    const latest = await manager.getRepository(CrawlRun).findOne({
      where: { sourceId: revision.sourceId },
      order: { startedAt: 'DESC' },
    });
    if (
      !source ||
      !source.enabled ||
      source.url !== revision.productUrl ||
      source.kind !== 'discovery' ||
      source.parser !== 'ticket-list' ||
      !latest ||
      latest.result === 'failed' ||
      !latest.finishedAt ||
      !latest.lineupEvidence?.some(
        (item) =>
          item.sourceUrl === revision.productUrl &&
          item.imageUrl === revision.imageUrl &&
          item.imageHash === revision.imageHash &&
          item.parserVersion === revision.parserVersion &&
          item.status === 'ok' &&
          JSON.stringify(item.rawLines) === JSON.stringify(revision.rawLines),
      )
    )
      throw new ConflictException(
        '최신 수집 증거가 변경되었습니다. 다시 검토해 주세요.',
      );
  }
}
