import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { UnprocessableEntityException } from '@nestjs/common';
import { CrawlService } from './crawl.service';
import { CrawlRun } from '../entity/crawl-run.entity';
import { CrawlSource } from '../entity/crawl-source.entity';

const reviewId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const imageId = '44444444-4444-4444-8444-444444444444';
const pageUrl = 'https://commons.wikimedia.org/wiki/File:Artist_portrait.jpg';
const originalUrl =
  'https://upload.wikimedia.org/wikipedia/commons/a/ab/Artist_portrait.jpg';
const festivalUrl =
  'https://ticket.melon.com/performance/index.htm?prodId=213666';
const author = 'Jane Photographer';
const license = 'CC BY 4.0';
const licenseUrl = 'https://creativecommons.org/licenses/by/4.0';
const page = `<h1 id="firstHeading">File:Artist portrait.jpg</h1>
  <div class="fullImageLink" id="file"><a href="${originalUrl}"></a></div>
  <td id="fileinfotpl&#95;aut">Author</td><td>${author}</td>
  <span class="licensetpl&#95;link">${licenseUrl}</span>
  <span class="licensetpl&#95;short">${license}</span>`;

type ApprovedCrawl = {
  prepareApprovedCommonsImage(reviewId: string): Promise<{
    runId: string;
    imageId: string;
    originalSha256: string;
    author: string;
    license: string;
    licenseUrl: string;
  }>;
  verifyApprovedCommonsReview(
    reviewId: string,
  ): ReturnType<CrawlService['verifyApprovedCommonsReview']>;
  execute(run: CrawlRun, source: CrawlSource): Promise<void>;
  checkRobots(url: string): Promise<void>;
  getListing(source: CrawlSource): Promise<{ status: number; body: string }>;
  limitedGet(url: URL): Promise<{ status: number; body: string }>;
  limitedGetImage(
    url: URL,
  ): Promise<{ status: number; body: Buffer; contentType: string }>;
  captureImages(
    source: CrawlSource,
    run: CrawlRun,
    urls: URL[],
    preloaded?: Map<
      string,
      { status: number; body: Buffer; contentType: string }
    >,
  ): Promise<string[]>;
};

function harness(bytes: Buffer) {
  const source = {
    id: sourceId,
    kind: 'artist-image',
    url: pageUrl,
    parser: 'html-text',
    parserConfig: {
      seed: 'commons-approved-profile',
      reviewId,
      festivalSourceUrl: festivalUrl,
      artistName: 'Artist',
    },
    enabled: false,
    status: 'disabled',
    consecutiveFailures: 0,
  } as unknown as CrawlSource;
  const run = { id: runId, sourceId } as CrawlRun;
  const review = {
    id: reviewId,
    sourceId,
    status: 'pending',
    festivalId: 'fst_example',
    festivalSourceUrl: festivalUrl,
    artistName: 'Artist',
    filePageUrl: pageUrl,
    officialEvidenceUrl: festivalUrl,
    author,
    license,
    licenseUrl,
    imageId: null as string | null,
    originalSha256: null as string | null,
  };
  const query = jest.fn((sql: string) =>
    Promise.resolve(
      sql.includes('FROM crawl_artist_image_reviews') ? [review] : [],
    ),
  );
  const runsRepo = {
    create: jest.fn((value: object) => ({ id: runId, ...value })),
    save: jest.fn((value: CrawlRun) => Promise.resolve(value)),
    findOneByOrFail: jest.fn(() => Promise.resolve(run)),
    createQueryBuilder: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ identifiers: [{ id: runId }] }),
      getOneOrFail: jest.fn(() => Promise.resolve(run)),
    })),
  };
  const publicFestivals = {
    hasCurrentArtist: jest.fn().mockResolvedValue(true),
  };
  const imageRepo = {
    findOneBy: jest.fn(),
    findOneByOrFail: jest.fn().mockResolvedValue({ id: imageId }),
    createQueryBuilder: jest.fn(),
    save: jest.fn((image: object) => Promise.resolve(image)),
  };
  const imageInsert = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };
  imageRepo.createQueryBuilder.mockReturnValue(imageInsert);
  const imageStorage = {
    saveCrawlImage: jest.fn().mockResolvedValue(undefined),
  };
  const reviewRepository = {
    findOne: jest.fn(() => Promise.resolve(review)),
    save: jest.fn((value: object) => Promise.resolve(value)),
  };
  const sourceRepository = {
    findOne: jest.fn(() => Promise.resolve(source)),
    save: jest.fn((value: object) => Promise.resolve(value)),
  };
  const manager = {
    getRepository: jest.fn((entity: object) =>
      entity === CrawlSource ? sourceRepository : reviewRepository,
    ),
  };
  const transaction = jest.fn((work: (value: typeof manager) => unknown) =>
    Promise.resolve(work(manager)),
  );
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const linkedOfficialSource = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({ enabled: true }),
  };
  const sourcesRepo = {
    findOneBy: jest.fn().mockResolvedValue(source),
    createQueryBuilder: jest.fn(() => linkedOfficialSource),
  };
  const service = new CrawlService(
    sourcesRepo as never,
    runsRepo as never,
    {} as never,
    imageRepo as never,
    {} as never,
    { query, transaction } as never,
    imageStorage as never,
    { recordThresholdFailure: jest.fn() } as never,
    audit as never,
    {} as never,
    publicFestivals as never,
  ) as unknown as ApprovedCrawl;
  const response = { status: 200, body: bytes, contentType: 'image/png' };
  jest.spyOn(service, 'checkRobots').mockResolvedValue(undefined);
  jest
    .spyOn(service, 'getListing')
    .mockResolvedValue({ status: 200, body: page });
  jest
    .spyOn(service, 'limitedGet')
    .mockResolvedValue({ status: 200, body: '<h1>Artist</h1>' });
  jest.spyOn(service, 'limitedGetImage').mockResolvedValue(response);
  const capture = jest
    .spyOn(service, 'captureImages')
    .mockResolvedValue([`/api/v1/admin/crawl/images/${imageId}`]);
  return {
    source,
    run,
    review,
    service,
    query,
    capture,
    response,
    publicFestivals,
    imageRepo,
    imageInsert,
    imageStorage,
    reviewRepository,
    sourceRepository,
    transaction,
    audit,
    linkedOfficialSource,
  };
}

describe('승인된 Commons 사진 수집', () => {
  let bytes: Buffer;

  beforeAll(async () => {
    bytes = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#cc8844',
      },
    })
      .png()
      .toBuffer();
  });

  it('준비 실행에서 공식 출연진과 원본을 확인한 뒤 원본 해시와 저장 이미지 ID를 기록한다', async () => {
    const { service, run, capture, response, publicFestivals } = harness(bytes);

    const prepared = await service.prepareApprovedCommonsImage(reviewId);

    expect(prepared).toMatchObject({
      runId,
      imageId,
      originalSha256: createHash('sha256').update(bytes).digest('hex'),
      author,
      license,
      licenseUrl,
    });
    expect(run.result).toBe('nochange-parsed');
    expect(publicFestivals.hasCurrentArtist).toHaveBeenCalledWith(
      'fst_example',
      festivalUrl,
      'Artist',
    );
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      run,
      [new URL(originalUrl)],
      new Map([[originalUrl, response]]),
    );
  });

  it('같은 파일 URL의 원본 바이트가 승인 준비 때와 달라지면 재검증을 거절한다', async () => {
    const { service, review, run, capture } = harness(bytes);
    review.originalSha256 = createHash('sha256')
      .update(Buffer.from('previous original'))
      .digest('hex');

    await expect(
      service.verifyApprovedCommonsReview(reviewId),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(run.result).toBe('failed');
    expect(run.artistImageRightsEvidence?.status).not.toBe('ok');
    expect(capture).not.toHaveBeenCalled();
  });

  it('승인 후 원본 바이트가 바뀌면 승인 철회·소스 비활성화·감사를 원자적으로 기록하고 복구 후에도 재게시하지 않는다', async () => {
    const { service, review, source, run, capture, transaction, audit } =
      harness(bytes);
    review.status = 'approved';
    source.enabled = true;
    source.status = 'ok';
    review.originalSha256 = createHash('sha256')
      .update(Buffer.from('previous original'))
      .digest('hex');

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(run.error).toBe('COMMONS_ORIGINAL_CHANGED');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(review.status).toBe('revoked');
    expect(source).toMatchObject({ enabled: false, status: 'disabled' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: null,
        action: 'crawl.artist-image.revoked',
        after: {
          status: 'revoked',
          sourceEnabled: false,
          reason: 'COMMONS_ORIGINAL_CHANGED',
        },
      }),
    );
    review.originalSha256 = createHash('sha256').update(bytes).digest('hex');
    const restoredRun = {
      id: '55555555-5555-4555-8555-555555555555',
    } as CrawlRun;
    await service.execute(restoredRun, source);
    expect(restoredRun.result).toBe('failed');
    expect(restoredRun.artistImageRightsEvidence?.status).not.toBe('ok');
    expect(capture).not.toHaveBeenCalled();
  });

  it('승인 후 Commons 권리 표시가 바뀌면 승인·수집 소스를 철회한다', async () => {
    const { service, review, source, run, transaction, audit } = harness(bytes);
    review.status = 'approved';
    source.enabled = true;
    source.status = 'ok';
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: page.replace(license, 'CC BY-SA 4.0'),
    });

    await service.execute(run, source);

    expect(run.error).toBe('COMMONS_RIGHTS_MISMATCH');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(review.status).toBe('revoked');
    expect(source.enabled).toBe(false);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('원본 검증 뒤 이미지 저장 ID가 승인 ID와 달라지면 승인 철회한다', async () => {
    const { service, review, source, run, transaction } = harness(bytes);
    review.status = 'approved';
    review.imageId = '66666666-6666-4666-8666-666666666666';
    review.originalSha256 = createHash('sha256').update(bytes).digest('hex');
    source.enabled = true;
    source.status = 'ok';

    await service.execute(run, source);

    expect(run.error).toBe('COMMONS_IMAGE_CHANGED');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(review.status).toBe('revoked');
    expect(source.enabled).toBe(false);
  });

  it('일시적인 Commons HTTP 오류는 승인 상태를 철회하지 않는다', async () => {
    const { service, review, source, run, transaction } = harness(bytes);
    review.status = 'approved';
    source.enabled = true;
    source.status = 'ok';
    jest
      .spyOn(service, 'getListing')
      .mockResolvedValue({ status: 503, body: '' });

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(review.status).toBe('approved');
    expect(source.enabled).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('HTTP 200 차단 페이지처럼 파일 정체를 검증할 수 없을 때 승인 철회하지 않는다', async () => {
    const { service, review, source, run, transaction } = harness(bytes);
    review.status = 'approved';
    source.enabled = true;
    source.status = 'ok';
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: '<html><h1>Temporarily unavailable</h1></html>',
    });

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(run.error).toBe('COMMONS_RIGHTS');
    expect(review.status).toBe('approved');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('이미지 저장 결과가 일시적으로 비어 있으면 승인 철회하지 않는다', async () => {
    const { service, review, source, run, capture, transaction } =
      harness(bytes);
    review.status = 'approved';
    review.originalSha256 = createHash('sha256').update(bytes).digest('hex');
    source.enabled = true;
    source.status = 'ok';
    capture.mockResolvedValue([]);

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(review.status).toBe('approved');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('저장 이미지 행에 Sharp 변환 전의 원본 SHA-256을 남긴다', async () => {
    const { service, source, run, capture, imageInsert } = harness(bytes);
    capture.mockRestore();

    const result = await service.captureImages(
      source,
      run,
      [new URL(originalUrl)],
      new Map([
        [originalUrl, { status: 200, body: bytes, contentType: 'image/png' }],
      ]),
    );

    expect(result).toEqual([`/api/v1/admin/crawl/images/${imageId}`]);
    expect(imageInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId,
        originUrl: originalUrl,
        originalSha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    );
  });

  it('WebP 출력 해시만 달라져도 같은 원본 SHA-256의 기존 승인 이미지 ID를 유지한다', async () => {
    const {
      service,
      source,
      run,
      capture,
      imageRepo,
      imageInsert,
      imageStorage,
    } = harness(bytes);
    capture.mockRestore();
    imageRepo.findOneBy.mockImplementation(
      (where: { originalSha256?: string }) =>
        Promise.resolve(
          where.originalSha256
            ? {
                id: imageId,
                originalSha256: where.originalSha256,
                contentHash: 'previous-webp-hash',
                runId,
              }
            : null,
        ),
    );

    const result = await service.captureImages(
      source,
      run,
      [new URL(originalUrl)],
      new Map([
        [originalUrl, { status: 200, body: bytes, contentType: 'image/png' }],
      ]),
    );

    expect(result).toEqual([`/api/v1/admin/crawl/images/${imageId}`]);
    expect(imageRepo.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId,
        originalSha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    );
    expect(imageRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: imageId }),
    );
    expect(imageRepo.findOneBy).toHaveBeenCalledTimes(1);
    expect(imageInsert.execute).not.toHaveBeenCalled();
    expect(imageStorage.saveCrawlImage).not.toHaveBeenCalled();
  });

  it('최신 수집에서 Commons 권리 표시가 바뀌면 준비를 실패로 기록한다', async () => {
    const { service, run, capture } = harness(bytes);
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: page.replace(license, 'CC BY-SA 4.0'),
    });

    await expect(
      service.prepareApprovedCommonsImage(reviewId),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(run.result).toBe('failed');
    expect(run.artistImageRightsEvidence?.status).not.toBe('ok');
    expect(capture).not.toHaveBeenCalled();
  });

  it('공식 출연진 근거에서 해당 아티스트를 찾지 못하면 Commons 사진을 요청하지 않는다', async () => {
    const { service, run, capture } = harness(bytes);
    jest
      .spyOn(service, 'limitedGet')
      .mockResolvedValue({ status: 200, body: '<h1>Other Performer</h1>' });
    const listing = jest.spyOn(service, 'getListing');

    await expect(
      service.prepareApprovedCommonsImage(reviewId),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(run.result).toBe('failed');
    expect(listing).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it.each(['ArtistX', 'SuperArtist', 'Artist2'])(
    '공식 페이지에 다른 이름 %s만 있으면 부분 문자열을 출연 근거로 인정하지 않는다',
    async (otherArtist) => {
      const { service, source, run, capture } = harness(bytes);
      jest.spyOn(service, 'limitedGet').mockResolvedValue({
        status: 200,
        body: `<h1>${otherArtist}</h1>`,
      });

      await service.execute(run, source);

      expect(run.result).toBe('failed');
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it('연결이 해제된 별도 공식 근거 소스는 승인 상태를 철회한다', async () => {
    const { service, review, source, run, linkedOfficialSource, transaction } =
      harness(bytes);
    review.status = 'approved';
    review.officialEvidenceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=999999';
    source.enabled = true;
    linkedOfficialSource.getOne.mockResolvedValue(null);

    await service.execute(run, source);

    expect(run.error).toBe('COMMONS_OFFICIAL_SOURCE_UNLINKED');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(review.status).toBe('revoked');
    expect(source.enabled).toBe(false);
  });

  it('Commons 파일이 404로 삭제되면 승인을 철회한다', async () => {
    const { service, review, source, run, transaction } = harness(bytes);
    review.status = 'approved';
    source.enabled = true;
    jest
      .spyOn(service, 'getListing')
      .mockResolvedValue({ status: 404, body: '' });

    await service.execute(run, source);

    expect(run.error).toBe('COMMONS_FILE_REMOVED');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(review.status).toBe('revoked');
    expect(source.enabled).toBe(false);
  });
});
