import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminAuditService } from '../../audit/admin-audit.service';
import { CrawlArtistImageReview } from '../entity/crawl-artist-image-review.entity';
import { CrawlRun } from '../entity/crawl-run.entity';
import { CrawlSource } from '../entity/crawl-source.entity';
import {
  CrawlArtistImageReviewService,
  PrepareArtistImageReviewInput,
} from './crawl-artist-image-review.service';
import { CrawlService } from './crawl.service';
import { parseApprovedCommonsProfile } from './commons-approved-profile';

const runId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const reviewId = '33333333-3333-4333-8333-333333333333';
const imageId = '44444444-4444-4444-8444-444444444444';
const sha = 'a'.repeat(64);
const filePageUrl =
  'https://commons.wikimedia.org/wiki/File:Artist_portrait.jpg';
const festivalSourceUrl =
  'https://ticket.melon.com/performance/index.htm?prodId=213666';
const input: PrepareArtistImageReviewInput = {
  discoveryRunId: runId,
  festivalId: 'fst_example',
  festivalSourceUrl,
  artistName: '홍길동',
  fileId: 123,
  filePageUrl,
  officialEvidenceUrl: festivalSourceUrl,
  author: 'Photographer',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

describe('CrawlArtistImageReviewService', () => {
  const crawl = {
    prepareApprovedCommonsImage: jest.fn(),
    verifyApprovedCommonsReview: jest.fn(),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  let repositories: Map<unknown, unknown>;
  let dataSource: { getRepository: jest.Mock; transaction: jest.Mock };
  let service: CrawlArtistImageReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    repositories = new Map();
    dataSource = {
      getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
      transaction: jest.fn(async (fn: (manager: unknown) => Promise<unknown>) =>
        fn({ getRepository: (entity: unknown) => repositories.get(entity) }),
      ),
    };
    service = new CrawlArtistImageReviewService(
      dataSource as unknown as DataSource,
      crawl as unknown as CrawlService,
      audit as unknown as AdminAuditService,
    );
  });

  it('rejects a non-CC-BY license before reading the database', async () => {
    await expect(
      service.stage({ ...input, license: 'CC BY-SA 4.0' }, reviewId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it.each([
    'https://creativecommons.org/licenses/by/4.0',
    'https://creativecommons.org/licenses/by/4.0/',
  ])('prepares Commons metadata with license URL %s', async (licenseUrl) => {
    const run = {
      id: runId,
      sourceId,
      finishedAt: new Date(),
      result: 'nochange-parsed',
      artistImageEvidence: {
        targets: [
          {
            festivalId: input.festivalId,
            festivalSourceUrl,
            artistName: input.artistName,
            status: 'candidates',
            candidates: [
              { fileId: input.fileId, filePageUrl, status: 'pending' },
            ],
          },
        ],
      },
    };
    const runRepo = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(run),
      })),
      findOne: jest.fn().mockResolvedValue(run),
    };
    const sourceRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        id: sourceId,
        kind: 'artist-image-discovery',
        enabled: true,
      }),
      save: jest.fn((value: unknown) =>
        Promise.resolve({
          ...(value as object),
          id: sourceId,
        }),
      ),
    };
    let savedReview: CrawlArtistImageReview;
    const reviewRepo = {
      save: jest.fn((value: CrawlArtistImageReview) => {
        savedReview = { ...value };
        return Promise.resolve(savedReview);
      }),
      findOneBy: jest.fn(() => Promise.resolve(savedReview)),
      findOne: jest.fn(() => Promise.resolve(savedReview)),
    };
    repositories.set(CrawlRun, runRepo);
    repositories.set(CrawlSource, sourceRepo);
    repositories.set(CrawlArtistImageReview, reviewRepo);

    const commonsPage = `<h1 id="firstHeading">File:Artist portrait.jpg</h1>
      <div class="fullImageLink" id="file"><a href="https://upload.wikimedia.org/wikipedia/commons/a/ab/Artist_portrait.jpg"></a></div>
      <td id="fileinfotpl&#95;aut">Author</td><td>Photographer</td>
      <span class="licensetpl&#95;link">https://creativecommons.org/licenses/by/4.0</span>
      <span class="licensetpl&#95;short">CC BY 4.0</span>`;
    crawl.prepareApprovedCommonsImage.mockImplementation(() => {
      const profile = parseApprovedCommonsProfile(commonsPage, filePageUrl, {
        fileKey: 'File:Artist_portrait.jpg',
        author: savedReview.author,
        license: savedReview.license,
        licenseUrl: savedReview.licenseUrl,
      });
      if (!profile) throw new Error('Commons metadata rejected');
      return Promise.resolve({
        runId,
        imageId,
        originalSha256: sha,
        ...profile.credit,
      });
    });

    const prepared = await service.stage({ ...input, licenseUrl }, reviewId);

    expect(prepared).toMatchObject({
      imageId,
      preparedRunId: runId,
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
    });
  });

  it('rejects a candidate that does not exactly match the discovery target', async () => {
    const run = {
      id: runId,
      sourceId,
      finishedAt: new Date(),
      result: 'nochange-parsed',
      artistImageEvidence: {
        targets: [
          {
            festivalId: 'fst_example',
            festivalSourceUrl,
            artistName: '다른 아티스트',
            status: 'candidates',
            candidates: [{ fileId: 123, filePageUrl, status: 'pending' }],
          },
        ],
      },
    };
    const runRepo = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(run),
      })),
      findOne: jest.fn().mockResolvedValue(run),
    };
    const sourceRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        id: sourceId,
        kind: 'artist-image-discovery',
        enabled: true,
      }),
    };
    repositories.set(CrawlRun, runRepo);
    repositories.set(CrawlSource, sourceRepo);
    await expect(service.stage(input, reviewId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects another Commons image source as official lineup evidence', async () => {
    const run = {
      id: runId,
      sourceId,
      finishedAt: new Date(),
      result: 'nochange-parsed',
      artistImageEvidence: {
        targets: [
          {
            festivalId: input.festivalId,
            festivalSourceUrl,
            artistName: input.artistName,
            status: 'candidates',
            candidates: [
              { fileId: input.fileId, filePageUrl, status: 'pending' },
            ],
          },
        ],
      },
    };
    repositories.set(CrawlRun, {
      createQueryBuilder: () => ({
        addSelect: () => ({
          where: () => ({ getOne: () => Promise.resolve(run) }),
        }),
      }),
      findOne: () => Promise.resolve(run),
    });
    repositories.set(CrawlSource, {
      findOneBy: () =>
        Promise.resolve({
          id: sourceId,
          kind: 'artist-image-discovery',
          enabled: true,
        }),
    });
    await expect(
      service.stage({ ...input, officialEvidenceUrl: filePageUrl }, reviewId),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not approve when the inspected SHA differs from the prepared image', async () => {
    repositories.set(CrawlArtistImageReview, {
      findOneBy: jest.fn().mockResolvedValue({
        id: reviewId,
        status: 'pending',
        imageId,
        preparedRunId: runId,
        originalSha256: sha,
      }),
    });
    await expect(
      service.approve(reviewId, 'b'.repeat(64), reviewId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(crawl.verifyApprovedCommonsReview).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('keeps the source disabled when the verified image differs from the prepared image', async () => {
    repositories.set(CrawlArtistImageReview, {
      findOneBy: jest.fn().mockResolvedValue({
        id: reviewId,
        status: 'pending',
        imageId,
        preparedRunId: runId,
        originalSha256: sha,
        author: input.author,
        license: input.license,
        licenseUrl: input.licenseUrl,
      }),
    });
    crawl.verifyApprovedCommonsReview.mockResolvedValue({
      runId,
      imageId: sourceId,
      originalSha256: sha,
      author: input.author,
      license: input.license,
      licenseUrl: input.licenseUrl,
    });
    await expect(
      service.approve(reviewId, sha, reviewId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('pins the reverified run and enables the source in the approval transaction', async () => {
    const review = {
      id: reviewId,
      sourceId,
      status: 'pending' as const,
      imageId,
      preparedRunId: runId,
      originalSha256: sha,
      author: input.author,
      license: input.license,
      licenseUrl: input.licenseUrl,
      reviewedBy: null,
      reviewedAt: null,
      verifiedAt: null,
      approvedRunId: null,
      filePageUrl,
    };
    const source = {
      id: sourceId,
      enabled: false,
      status: 'disabled',
      url: filePageUrl,
      parserConfig: { reviewId },
    };
    const reviewRepo = {
      findOneBy: jest.fn().mockResolvedValue(review),
      findOne: jest.fn().mockResolvedValue(review),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    const sourceRepo = {
      findOne: jest.fn().mockResolvedValue(source),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    repositories.set(CrawlArtistImageReview, reviewRepo);
    repositories.set(CrawlSource, sourceRepo);
    crawl.verifyApprovedCommonsReview.mockResolvedValue({
      runId,
      imageId,
      originalSha256: sha,
      author: input.author,
      license: input.license,
      licenseUrl: input.licenseUrl,
    });

    const approved = await service.approve(reviewId, sha, reviewId);

    expect(approved).toMatchObject({
      status: 'approved',
      approvedRunId: runId,
      imageId,
      originalSha256: sha,
    });
    expect(sourceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, status: 'ok' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'crawl.artist-image.approved' }),
    );
  });
});
