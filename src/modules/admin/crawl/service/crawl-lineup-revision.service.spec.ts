import { BadRequestException, ConflictException } from '@nestjs/common';
import { CrawlLineupRevisionService } from './crawl-lineup-revision.service';

const sourceId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
const imageHash = 'a'.repeat(64);
const url = 'https://world.nol.com/en/ticket/products/26014246';
const evidence = {
  sourceUrl: url,
  imageUrl:
    'https://ticketimage.interpark.com/Play/image/etc/26/26014246-02.jpg',
  imageHash,
  parserVersion: 'nol-world-detail-ocr:v1',
  status: 'ok',
  failureReason: null,
  rawLines: ['DASUT O3ohn Sanbo'],
};
const run = {
  id: runId,
  sourceId,
  result: 'nochange-parsed',
  finishedAt: new Date(),
  lineupEvidence: [evidence],
};
const pending = {
  id: 'revision',
  sourceId,
  runId,
  productUrl: url,
  imageUrl: evidence.imageUrl,
  imageHash,
  parserVersion: evidence.parserVersion,
  rawLines: evidence.rawLines,
  artists: [],
  status: 'pending',
  reviewedAt: null,
  reviewedBy: null,
};

describe('CrawlLineupRevisionService', () => {
  const revisionFind = jest.fn();
  const runFind = jest.fn();
  const sourceFind = jest.fn();
  const revisionRepository = {
    findOne: revisionFind,
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    createQueryBuilder: jest.fn(),
  };
  const runRepository = { findOne: runFind };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const manager = {
    getRepository: jest.fn((entity: { name: string }) =>
      entity.name === 'CrawlRun'
        ? runRepository
        : entity.name === 'CrawlSource'
          ? { findOne: sourceFind }
          : revisionRepository,
    ),
  };
  const dataSource = {
    transaction: jest.fn((callback: (value: unknown) => Promise<unknown>) =>
      callback(manager),
    ),
  };
  const service = new CrawlLineupRevisionService(
    revisionRepository as never,
    runRepository as never,
    { findOne: sourceFind } as never,
    dataSource as never,
    audit as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    runFind.mockResolvedValue(run);
    sourceFind.mockResolvedValue({
      id: sourceId,
      enabled: true,
      kind: 'discovery',
      parser: 'ticket-list',
      url,
    });
    revisionFind.mockResolvedValue(null);
  });

  it('stages only the latest matching private OCR evidence and deduplicates re-crawls', async () => {
    await expect(
      service.stage(runId, evidence.imageUrl, imageHash),
    ).resolves.toMatchObject({
      sourceId,
      runId,
      productUrl: url,
      rawLines: ['DASUT O3ohn Sanbo'],
      status: 'pending',
    });
    expect(revisionRepository.save).toHaveBeenCalledTimes(1);
    revisionFind.mockResolvedValue({ ...pending, status: 'approved' });
    await expect(
      service.stage(runId, evidence.imageUrl, imageHash),
    ).resolves.toMatchObject({
      status: 'approved',
    });
    expect(revisionRepository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale run, changed image bytes and wrong product source', async () => {
    runFind
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ ...run, id: 'newer' });
    await expect(
      service.stage(runId, evidence.imageUrl, imageHash),
    ).rejects.toBeInstanceOf(ConflictException);
    runFind.mockResolvedValue(run);
    await expect(
      service.stage(runId, evidence.imageUrl, 'b'.repeat(64)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.stage(
        runId,
        'https://ticketimage.interpark.com/other.jpg',
        imageHash,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    sourceFind.mockResolvedValue({
      id: sourceId,
      kind: 'discovery',
      parser: 'ticket-list',
      url: 'https://elsewhere.test/',
    });
    await expect(
      service.stage(runId, evidence.imageUrl, imageHash),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not reuse a review when OCR words change under the same image hash and parser', async () => {
    revisionFind.mockResolvedValue({ ...pending, rawLines: ['old OCR'] });
    await expect(
      service.stage(runId, evidence.imageUrl, imageHash),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not stage or approve evidence from a disabled source', async () => {
    sourceFind.mockResolvedValue({
      id: sourceId,
      enabled: false,
      kind: 'discovery',
      parser: 'ticket-list',
      url,
    });
    await expect(
      service.stage(runId, evidence.imageUrl, imageHash),
    ).rejects.toBeInstanceOf(BadRequestException);
    revisionFind.mockResolvedValue({ ...pending });
    await expect(
      service.review('revision', 'admin', imageHash, 'approved', [
        { name: 'DASUT', lineIndex: 0 },
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not hide a database failure or a concurrent row with changed OCR words', async () => {
    revisionRepository.save.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(
      service.stage(runId, evidence.imageUrl, imageHash),
    ).rejects.toThrow('database unavailable');
    revisionRepository.save.mockRejectedValueOnce({
      driverError: { code: '23505' },
    });
    revisionFind
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...pending, rawLines: ['different OCR'] });
    await expect(
      service.stage(runId, evidence.imageUrl, imageHash),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects malformed source UUID before the database query', async () => {
    await expect(
      service.list('------------------------------------'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(revisionRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('approves corrected names tied to OCR lines without adding fabricated date, image, time or stage', async () => {
    revisionFind.mockResolvedValue({ ...pending });
    await expect(
      service.review('revision', 'admin', imageHash, 'approved', [
        { name: 'DASUT', lineIndex: 0 },
        { name: 'O3ohn', lineIndex: 0 },
      ]),
    ).resolves.toMatchObject({
      status: 'approved',
      artists: [{ name: 'DASUT' }, { name: 'O3ohn' }],
    });
    expect(audit.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'crawl.lineup.approved',
        target: 'crawl-lineup-revision:revision',
      }),
    );
    expect(revisionRepository.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    [[{ name: 'DASUT', lineIndex: 1 }]],
    [[{ name: 'DASUT', lineIndex: 0, imageUrl: 'https://fake.test/a.jpg' }]],
    [[{ name: 'DASUT', lineIndex: 0, startsAt: '2026-11-08T17:00:00Z' }]],
    [[{ name: 'DASUT', lineIndex: 0, date: '2026-02-30' }]],
    [[{ name: 'DASUT', lineIndex: 0, date: '2026-11-08' }]],
    [
      [
        { name: 'DASUT', lineIndex: 0 },
        { name: 'dasut', lineIndex: 0 },
      ],
    ],
    [
      [
        { name: 'DASUT (다섯)', lineIndex: 0 },
        { name: '다섯', lineIndex: 0 },
      ],
    ],
  ])('rejects an invalid or invented performer field', async (artists) => {
    revisionFind.mockResolvedValue({ ...pending });
    await expect(
      service.review('revision', 'admin', imageHash, 'approved', artists),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(revisionRepository.save).not.toHaveBeenCalled();
  });

  it('rejects stale approval and second concurrent decision', async () => {
    revisionFind.mockResolvedValue({ ...pending });
    runFind.mockResolvedValue({
      ...run,
      lineupEvidence: [{ ...evidence, imageHash: 'b'.repeat(64) }],
    });
    await expect(
      service.review('revision', 'admin', imageHash, 'approved', [
        { name: 'DASUT', lineIndex: 0 },
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
    revisionFind.mockResolvedValue({ ...pending, status: 'approved' });
    await expect(
      service.review('revision', 'admin', imageHash, 'rejected'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisionRepository.save).not.toHaveBeenCalled();
  });

  it('rejects approval after the source product URL is reassigned', async () => {
    revisionFind.mockResolvedValue({ ...pending });
    sourceFind.mockResolvedValue({
      id: sourceId,
      kind: 'discovery',
      parser: 'ticket-list',
      url: 'https://world.nol.com/en/ticket/products/99999999',
    });
    await expect(
      service.review('revision', 'admin', imageHash, 'approved', [
        { name: 'DASUT', lineIndex: 0 },
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisionRepository.save).not.toHaveBeenCalled();
  });
});
