import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AdminAuditService } from '../../audit/admin-audit.service';
import {
  CrawlTimetableRevision,
  CrawlTimetableSet,
} from '../entity/crawl-timetable-revision.entity';
import { CrawlRun } from '../entity/crawl-run.entity';

export interface TimetableCandidate {
  sourceId: string;
  runId: string;
  festivalSourceUrl: string;
  sourceUrl: string;
  imageId: string | null;
  contentHash: string;
  parserHash: string;
  sets: CrawlTimetableSet[];
}

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validDate(value: string): boolean {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function validInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && Number.isFinite(Date.parse(value))
  );
}

function validSets(sets: CrawlTimetableSet[]): boolean {
  return (
    Array.isArray(sets) &&
    sets.length > 0 &&
    sets.length <= 100 &&
    sets.every(
      (set) =>
        set &&
        typeof set.artist === 'string' &&
        !!set.artist.trim() &&
        set.artist.length <= 160 &&
        typeof set.stageName === 'string' &&
        !!set.stageName.trim() &&
        set.stageName.length <= 100 &&
        validDate(set.date) &&
        validInstant(set.startsAt) &&
        set.startsAt.slice(0, 10) === set.date &&
        (set.endsAt === null ||
          (validInstant(set.endsAt) &&
            Date.parse(set.endsAt) > Date.parse(set.startsAt))),
    )
  );
}

@Injectable()
export class CrawlTimetableRevisionService {
  constructor(
    @InjectRepository(CrawlTimetableRevision)
    private readonly revisions: Repository<CrawlTimetableRevision>,
    @InjectRepository(CrawlRun)
    private readonly runs: Repository<CrawlRun>,
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  async list(sourceId?: string, status?: string) {
    if (
      sourceId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        sourceId,
      )
    )
      throw new BadRequestException('유효한 소스 ID가 필요합니다.');
    if (status && !['pending', 'verified', 'rejected'].includes(status))
      throw new BadRequestException('유효한 검토 상태가 필요합니다.');
    const query = this.revisions.createQueryBuilder('revision');
    if (sourceId) query.andWhere('revision.sourceId = :sourceId', { sourceId });
    if (status) query.andWhere('revision.status = :status', { status });
    const revisions = await query
      .orderBy('revision.createdAt', 'DESC')
      .limit(100)
      .getMany();
    if (!revisions.length) return { items: [] };
    const sources = await this.dataSource.query<
      { id: string; expectedRows: string | null }[]
    >(
      `SELECT id, "parserConfig"->>'expectedRows' AS "expectedRows"
       FROM crawl_sources WHERE id = ANY($1::uuid[]) AND parser = 'image-ocr'`,
      [[...new Set(revisions.map((revision) => revision.sourceId))]],
    );
    const expectedRows = new Map(
      sources.map((source) => [source.id, Number(source.expectedRows)]),
    );
    return {
      items: revisions.map((revision) => ({
        ...revision,
        expectedRows: expectedRows.get(revision.sourceId) ?? null,
      })),
    };
  }

  async stageCandidate(
    candidate: TimetableCandidate,
  ): Promise<CrawlTimetableRevision> {
    if (
      !validHttpsUrl(candidate.festivalSourceUrl) ||
      !validHttpsUrl(candidate.sourceUrl) ||
      !/^[0-9a-f]{64}$/i.test(candidate.contentHash) ||
      !/^[0-9a-f]{64}$/i.test(candidate.parserHash) ||
      !validSets(candidate.sets)
    ) {
      throw new BadRequestException('검증할 수 없는 공연 시간표입니다.');
    }
    const run = await this.runs.findOne({
      where: { id: candidate.runId, sourceId: candidate.sourceId },
    });
    if (!run)
      throw new BadRequestException(
        '수집 실행과 시간표 출처가 일치하지 않습니다.',
      );
    const existing = await this.revisions.findOne({
      where: {
        sourceId: candidate.sourceId,
        contentHash: candidate.contentHash,
        parserHash: candidate.parserHash,
      },
    });
    if (existing) return existing;
    return this.revisions.save(
      this.revisions.create({
        ...candidate,
        status: 'pending',
        verifiedAt: null,
        verifiedBy: null,
      }),
    );
  }

  async verify(
    id: string,
    adminId: string,
    correctedSets?: CrawlTimetableSet[],
  ): Promise<CrawlTimetableRevision> {
    if (correctedSets !== undefined && !validSets(correctedSets))
      throw new BadRequestException('수정한 공연 시간표가 올바르지 않습니다.');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CrawlTimetableRevision);
      const revision = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!revision)
        throw new NotFoundException('시간표 검토본을 찾을 수 없습니다.');
      if (revision.status !== 'pending')
        throw new BadRequestException('대기 중인 시간표만 검증할 수 있습니다.');
      const before = { status: revision.status, sets: revision.sets };
      if (correctedSets !== undefined) revision.sets = correctedSets;
      if (revision.sourceId) {
        const sources = await manager.query<
          { parser: string; parserConfig: Record<string, unknown> }[]
        >(`SELECT parser, "parserConfig" FROM crawl_sources WHERE id = $1`, [
          revision.sourceId,
        ]);
        const source = sources[0];
        if (source?.parser === 'image-ocr') {
          const expectedRows = Number(source.parserConfig.expectedRows);
          if (
            !Number.isInteger(expectedRows) ||
            revision.sets.length !== expectedRows
          )
            throw new BadRequestException(
              `공식 원본의 공연 ${expectedRows}개를 모두 확인한 뒤 승인해 주세요.`,
            );
        }
      }
      revision.status = 'verified';
      revision.verifiedAt = new Date();
      revision.verifiedBy = adminId;
      const saved = await repository.save(revision);
      await this.audit.record(manager, {
        actor: adminId,
        action: 'crawl.timetable.verified',
        target: `crawl-timetable-revision:${id}`,
        before,
        after: { status: saved.status, sets: saved.sets },
      });
      return saved;
    });
  }

  async reject(id: string, adminId: string): Promise<CrawlTimetableRevision> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CrawlTimetableRevision);
      const revision = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!revision)
        throw new NotFoundException('시간표 검토본을 찾을 수 없습니다.');
      if (revision.status !== 'pending')
        throw new BadRequestException('대기 중인 시간표만 거절할 수 있습니다.');
      revision.status = 'rejected';
      const saved = await repository.save(revision);
      await this.audit.record(manager, {
        actor: adminId,
        action: 'crawl.timetable.rejected',
        target: `crawl-timetable-revision:${id}`,
        before: { status: 'pending' },
        after: { status: 'rejected' },
      });
      return saved;
    });
  }
}
