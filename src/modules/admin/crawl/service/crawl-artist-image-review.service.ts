import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AdminAuditService } from '../../audit/admin-audit.service';
import { CrawlArtistImageReview } from '../entity/crawl-artist-image-review.entity';
import { CrawlRun } from '../entity/crawl-run.entity';
import { CrawlSource } from '../entity/crawl-source.entity';
import { checkedUrl } from './crawl-fetch';
import { CrawlService } from './crawl.service';
import { canonicalCcByLicenseUrl } from './commons-approved-profile';

export interface PrepareArtistImageReviewInput {
  discoveryRunId: string;
  festivalId: string;
  festivalSourceUrl: string;
  artistName: string;
  fileId: number;
  filePageUrl: string;
  officialEvidenceUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
}

type PreparedImage = {
  runId: string;
  imageId: string;
  originalSha256: string;
  author: string;
  license: string;
  licenseUrl: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const LICENSE = /^CC BY (2\.0|2\.5|3\.0|4\.0)$/;

function requireUrl(value: string): URL {
  try {
    return checkedUrl(value);
  } catch {
    throw new BadRequestException('공개 HTTPS 주소가 필요합니다.');
  }
}

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function validateInput(input: PrepareArtistImageReviewInput) {
  if (
    !UUID.test(input.discoveryRunId) ||
    !/^fst_[a-z0-9]+$/.test(input.festivalId) ||
    !Number.isSafeInteger(input.fileId) ||
    input.fileId <= 0 ||
    !input.artistName.trim() ||
    input.artistName !== input.artistName.trim() ||
    input.artistName.length > 160 ||
    hasControl(input.artistName)
  )
    throw new BadRequestException('후보 축제·출연진 정보가 올바르지 않습니다.');
  const festival = requireUrl(input.festivalSourceUrl);
  const file = requireUrl(input.filePageUrl);
  requireUrl(input.officialEvidenceUrl);
  if (
    file.hostname !== 'commons.wikimedia.org' ||
    !/^\/wiki\/File:[^/?#]{1,250}$/u.test(file.pathname) ||
    file.search ||
    file.hash ||
    festival.href !== input.festivalSourceUrl ||
    file.href !== input.filePageUrl
  )
    throw new BadRequestException(
      'Commons 파일 또는 축제 원본 URL이 올바르지 않습니다.',
    );
  if (
    !input.author.trim() ||
    input.author !== input.author.trim() ||
    input.author.length > 500 ||
    /[<>]/.test(input.author) ||
    hasControl(input.author) ||
    !LICENSE.test(input.license)
  )
    throw new BadRequestException(
      '저작자 또는 CC BY 라이선스가 올바르지 않습니다.',
    );
  if (!canonicalCcByLicenseUrl(input.licenseUrl, input.license))
    throw new BadRequestException('CC BY 라이선스 URL이 일치하지 않습니다.');
}

function samePreparedCredit(
  review: CrawlArtistImageReview,
  prepared: PreparedImage,
) {
  return (
    prepared.author === review.author &&
    prepared.license === review.license &&
    prepared.licenseUrl === review.licenseUrl
  );
}

@Injectable()
export class CrawlArtistImageReviewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly crawl: CrawlService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(status?: string) {
    if (status && !['pending', 'approved', 'revoked'].includes(status))
      throw new BadRequestException('유효한 검토 상태가 필요합니다.');
    const query = this.dataSource
      .getRepository(CrawlArtistImageReview)
      .createQueryBuilder('review');
    if (status) query.where('review.status = :status', { status });
    return {
      items: await query
        .orderBy('review.createdAt', 'DESC')
        .take(100)
        .getMany(),
    };
  }

  async get(id: string) {
    const review = await this.dataSource
      .getRepository(CrawlArtistImageReview)
      .findOneBy({ id });
    if (!review) throw new NotFoundException('사진 검토본을 찾을 수 없습니다.');
    return review;
  }

  private async assertOfficialEvidenceSource(
    sources: Repository<CrawlSource>,
    input: PrepareArtistImageReviewInput,
  ) {
    if (input.officialEvidenceUrl === input.festivalSourceUrl) return;
    const evidenceHost = new URL(input.officialEvidenceUrl).hostname;
    if (
      evidenceHost !== new URL(input.festivalSourceUrl).hostname ||
      /(?:^|\.)(?:wikimedia|wikipedia)\.org$/i.test(evidenceHost)
    )
      throw new UnprocessableEntityException(
        '공식 출연 증거는 축제 원본과 같은 호스트여야 합니다.',
      );
    const linked = await sources
      .createQueryBuilder('source')
      .where('source.enabled = true')
      .andWhere('source.kind IN (:...kinds)', {
        kinds: ['discovery', 'timetable', 'notice', 'artist-gallery'],
      })
      .andWhere('source.url = :url', { url: input.officialEvidenceUrl })
      .andWhere(
        "source.parserConfig->>'festivalSourceUrl' = :festivalSourceUrl",
        {
          festivalSourceUrl: input.festivalSourceUrl,
        },
      )
      .getOne();
    if (!linked)
      throw new UnprocessableEntityException(
        '공식 출연 증거는 현재 축제에 연결된 원본이어야 합니다.',
      );
  }

  async stage(input: PrepareArtistImageReviewInput, adminId: string) {
    validateInput(input);
    const run = await this.dataSource
      .getRepository(CrawlRun)
      .createQueryBuilder('run')
      .addSelect('run.artistImageEvidence')
      .where('run.id = :id', { id: input.discoveryRunId })
      .getOne();
    if (!run || !run.finishedAt || run.result === 'failed')
      throw new UnprocessableEntityException(
        '완료된 Commons 탐색 실행이 필요합니다.',
      );
    const sources = this.dataSource.getRepository(CrawlSource);
    const discoverySource = await sources.findOneBy({ id: run.sourceId });
    if (
      !discoverySource ||
      discoverySource.kind !== 'artist-image-discovery' ||
      !discoverySource.enabled
    )
      throw new UnprocessableEntityException(
        '유효한 Commons 탐색 소스가 아닙니다.',
      );
    const latest = await this.dataSource.getRepository(CrawlRun).findOne({
      where: { sourceId: run.sourceId },
      order: { startedAt: 'DESC', id: 'DESC' },
    });
    if (latest?.id !== run.id)
      throw new ConflictException('최신 Commons 탐색 실행을 사용해 주세요.');
    const target = run.artistImageEvidence?.targets.find(
      (item) =>
        item.festivalId === input.festivalId &&
        item.festivalSourceUrl === input.festivalSourceUrl &&
        item.artistName === input.artistName,
    );
    if (
      target?.status !== 'candidates' ||
      !target.candidates.some(
        (candidate) =>
          candidate.fileId === input.fileId &&
          candidate.filePageUrl === input.filePageUrl &&
          candidate.status === 'pending',
      )
    )
      throw new UnprocessableEntityException(
        '탐색 실행의 출연진과 Commons 후보가 일치하지 않습니다.',
      );
    await this.assertOfficialEvidenceSource(sources, input);

    const review = await this.dataSource.transaction(async (manager) => {
      const id = randomUUID();
      const source = await manager.getRepository(CrawlSource).save({
        festivalId: null,
        kind: 'artist-image',
        url: input.filePageUrl,
        parser: 'html-text',
        parserConfig: {
          seed: 'commons-approved-profile',
          reviewId: id,
          festivalSourceUrl: input.festivalSourceUrl,
          artistName: input.artistName,
        },
        intervalMinutes: 1440,
        enabled: false,
        status: 'disabled',
      });
      const saved = await manager.getRepository(CrawlArtistImageReview).save({
        id,
        sourceId: source.id,
        imageId: null,
        festivalId: input.festivalId,
        festivalSourceUrl: input.festivalSourceUrl,
        artistName: input.artistName,
        fileId: input.fileId,
        filePageUrl: input.filePageUrl,
        officialEvidenceUrl: input.officialEvidenceUrl,
        discoveryRunId: input.discoveryRunId,
        preparedRunId: null,
        approvedRunId: null,
        author: input.author,
        license: input.license,
        licenseUrl: canonicalCcByLicenseUrl(input.licenseUrl, input.license)!,
        originalSha256: null,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        revokedBy: null,
        revokedAt: null,
        verifiedAt: null,
      });
      await this.audit.record(manager, {
        actor: adminId,
        action: 'crawl.artist-image.staged',
        target: `crawl-artist-image-review:${id}`,
        before: null,
        after: {
          sourceId: source.id,
          discoveryRunId: input.discoveryRunId,
          festivalId: input.festivalId,
          artistName: input.artistName,
          fileId: input.fileId,
        },
      });
      return saved;
    });
    return this.prepare(review.id, adminId);
  }

  async prepare(id: string, adminId: string) {
    const review = await this.get(id);
    if (review.status !== 'pending' || review.preparedRunId)
      throw new ConflictException('준비 전 검토 대기본만 수집할 수 있습니다.');
    const prepared = await this.crawl.prepareApprovedCommonsImage(id);
    if (
      !SHA256.test(prepared.originalSha256) ||
      !samePreparedCredit(review, prepared)
    )
      throw new ConflictException(
        '원본 파일의 권리 또는 해시가 검토 내용과 다릅니다.',
      );
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CrawlArtistImageReview);
      const locked = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'pending' || locked.preparedRunId)
        throw new ConflictException('검토본 상태가 변경되었습니다.');
      locked.imageId = prepared.imageId;
      locked.originalSha256 = prepared.originalSha256.toLowerCase();
      locked.preparedRunId = prepared.runId;
      locked.verifiedAt = new Date();
      const saved = await repository.save(locked);
      await this.audit.record(manager, {
        actor: adminId,
        action: 'crawl.artist-image.prepared',
        target: `crawl-artist-image-review:${id}`,
        before: { imageId: null, preparedRunId: null },
        after: {
          imageId: saved.imageId,
          preparedRunId: saved.preparedRunId,
          originalSha256: saved.originalSha256,
        },
      });
      return saved;
    });
  }

  async approve(id: string, originalSha256: string, adminId: string) {
    if (!SHA256.test(originalSha256))
      throw new BadRequestException('원본 SHA-256이 필요합니다.');
    const review = await this.get(id);
    if (
      review.status !== 'pending' ||
      !review.imageId ||
      !review.preparedRunId ||
      review.originalSha256 !== originalSha256.toLowerCase()
    )
      throw new ConflictException(
        '준비한 이미지와 확인한 원본 해시가 다릅니다.',
      );
    const verified = await this.crawl.verifyApprovedCommonsReview(id);
    if (
      verified.imageId !== review.imageId ||
      verified.originalSha256.toLowerCase() !== review.originalSha256 ||
      !samePreparedCredit(review, verified)
    )
      throw new ConflictException(
        '승인 직전 이미지 또는 권리가 변경되었습니다.',
      );
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CrawlArtistImageReview);
      const locked = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      const source = locked
        ? await manager.getRepository(CrawlSource).findOne({
            where: { id: locked.sourceId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      if (
        !locked ||
        !source ||
        locked.status !== 'pending' ||
        source.enabled ||
        source.url !== locked.filePageUrl ||
        source.parserConfig.reviewId !== id ||
        locked.imageId !== verified.imageId ||
        locked.originalSha256 !== verified.originalSha256.toLowerCase() ||
        !samePreparedCredit(locked, verified)
      )
        throw new ConflictException('검토본 또는 소스가 변경되었습니다.');
      locked.status = 'approved';
      locked.approvedRunId = verified.runId;
      locked.reviewedBy = adminId;
      locked.reviewedAt = new Date();
      locked.verifiedAt = locked.reviewedAt;
      source.enabled = true;
      source.status = 'ok';
      await manager.getRepository(CrawlSource).save(source);
      const saved = await repository.save(locked);
      await this.audit.record(manager, {
        actor: adminId,
        action: 'crawl.artist-image.approved',
        target: `crawl-artist-image-review:${id}`,
        before: { status: 'pending', sourceEnabled: false },
        after: {
          status: 'approved',
          sourceEnabled: true,
          imageId: saved.imageId,
          approvedRunId: saved.approvedRunId,
          originalSha256: saved.originalSha256,
        },
      });
      return saved;
    });
  }

  async revoke(id: string, adminId: string) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CrawlArtistImageReview);
      const review = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!review)
        throw new NotFoundException('사진 검토본을 찾을 수 없습니다.');
      if (review.status === 'revoked')
        throw new ConflictException('이미 철회된 사진입니다.');
      const source = await manager.getRepository(CrawlSource).findOne({
        where: { id: review.sourceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source) throw new ConflictException('연결된 수집 소스가 없습니다.');
      const before = review.status;
      review.status = 'revoked';
      review.revokedBy = adminId;
      review.revokedAt = new Date();
      source.enabled = false;
      source.status = 'disabled';
      await manager.getRepository(CrawlSource).save(source);
      const saved = await repository.save(review);
      await this.audit.record(manager, {
        actor: adminId,
        action: 'crawl.artist-image.revoked',
        target: `crawl-artist-image-review:${id}`,
        before: { status: before, sourceEnabled: true },
        after: { status: 'revoked', sourceEnabled: false },
      });
      return saved;
    });
  }
}
