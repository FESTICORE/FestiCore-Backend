import { BadRequestException } from '@nestjs/common';
import { CrawlTimetableRevisionService } from './crawl-timetable-revision.service';

const candidate = {
  sourceId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
  festivalSourceUrl: 'https://tickets.example/festival',
  sourceUrl: 'https://official.example/timetable',
  imageId: null,
  contentHash: 'a'.repeat(64),
  parserHash: 'b'.repeat(64),
  sets: [
    {
      artist: 'Artist',
      date: '2026-10-17',
      stageName: 'Stage A',
      startsAt: '2026-10-17T12:20:00+09:00',
      endsAt: null,
    },
  ],
};

describe('CrawlTimetableRevisionService', () => {
  const findOne = jest.fn();
  const runFindOne = jest.fn();
  const create = jest.fn((value: unknown) => value);
  const save = jest.fn((value: unknown) => Promise.resolve(value));
  const repository = { findOne, create, save };
  const sourceQuery = jest.fn().mockResolvedValue([]);
  const dataSource = {
    query: sourceQuery,
    transaction: jest.fn((callback: (manager: unknown) => Promise<unknown>) =>
      callback({ getRepository: () => repository, query: sourceQuery }),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CrawlTimetableRevisionService(
    repository as never,
    { findOne: runFindOne } as never,
    dataSource as never,
    audit as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    runFindOne.mockResolvedValue({
      id: candidate.runId,
      sourceId: candidate.sourceId,
    });
  });

  it('stages a source-backed timetable for explicit verification and allows unknown end time', async () => {
    findOne.mockResolvedValue(null);
    await expect(service.stageCandidate(candidate)).resolves.toMatchObject({
      status: 'pending',
      sets: [{ endsAt: null }],
      sourceUrl: candidate.sourceUrl,
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('returns the existing revision for an unchanged source/parser/content', async () => {
    const existing = { id: 'existing', status: 'verified' };
    findOne.mockResolvedValue(existing);
    await expect(service.stageCandidate(candidate)).resolves.toBe(existing);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects invalid times without storing them', async () => {
    await expect(
      service.stageCandidate({
        ...candidate,
        sets: [{ ...candidate.sets[0], endsAt: '2026-10-17T11:20:00+09:00' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a run that does not belong to the timetable source', async () => {
    runFindOne.mockResolvedValue(null);
    await expect(service.stageCandidate(candidate)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(runFindOne).toHaveBeenCalledWith({
      where: { id: candidate.runId, sourceId: candidate.sourceId },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('verifies only a pending revision', async () => {
    findOne.mockResolvedValue({ id: 'pending', status: 'pending' });
    await expect(service.verify('pending', 'admin')).resolves.toMatchObject({
      status: 'verified',
      verifiedBy: 'admin',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: 'admin',
        action: 'crawl.timetable.verified',
      }),
    );
    findOne.mockResolvedValue({ id: 'verified', status: 'verified' });
    await expect(service.verify('verified', 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('audits a rejected candidate without publishing it', async () => {
    findOne.mockResolvedValue({ id: 'pending', status: 'pending' });
    await expect(service.reject('pending', 'admin')).resolves.toMatchObject({
      status: 'rejected',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'crawl.timetable.rejected' }),
    );
  });

  it('publishes a reviewed correction and rejects invalid replacement rows', async () => {
    findOne.mockResolvedValue({
      id: 'pending',
      status: 'pending',
      sets: candidate.sets,
    });
    const reviewed = [
      {
        ...candidate.sets[0],
        artist: 'Official Artist',
        endsAt: '2026-10-17T13:00:00+09:00',
      },
    ];
    await expect(
      service.verify('pending', 'admin', reviewed),
    ).resolves.toMatchObject({ status: 'verified', sets: reviewed });
    findOne.mockResolvedValue({ id: 'pending', status: 'pending' });
    await expect(
      service.verify('pending', 'admin', [
        { ...candidate.sets[0], artist: '', endsAt: null },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires every expected OCR row before publishing a partial candidate', async () => {
    const pending = {
      id: 'pending',
      sourceId: candidate.sourceId,
      status: 'pending',
      sets: candidate.sets,
    };
    findOne.mockResolvedValue(pending);
    sourceQuery.mockResolvedValueOnce([
      { parser: 'image-ocr', parserConfig: { expectedRows: '2' } },
    ]);
    await expect(service.verify('pending', 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(save).not.toHaveBeenCalled();

    sourceQuery.mockResolvedValueOnce([
      { parser: 'image-ocr', parserConfig: { expectedRows: '2' } },
    ]);
    const completed = [
      candidate.sets[0],
      {
        ...candidate.sets[0],
        artist: 'Second Artist',
        startsAt: '2026-10-17T13:20:00+09:00',
      },
    ];
    await expect(
      service.verify('pending', 'admin', completed),
    ).resolves.toMatchObject({
      status: 'verified',
      sets: completed,
    });
  });

  it('requires a real stage for each OCR row before publication', async () => {
    findOne.mockResolvedValue({
      id: 'pending',
      sourceId: candidate.sourceId,
      status: 'pending',
      sets: [{ ...candidate.sets[0], stageName: '무대 확인 필요 ' }],
    });
    sourceQuery.mockResolvedValueOnce([
      { parser: 'image-ocr', parserConfig: { expectedRows: '1' } },
    ]);
    await expect(service.verify('pending', 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('limits manually corrected OCR stages to the official stage names', async () => {
    findOne.mockResolvedValue({
      id: 'pending',
      sourceId: candidate.sourceId,
      status: 'pending',
      sets: [{ ...candidate.sets[0], stageName: 'Other Stage' }],
    });
    sourceQuery.mockResolvedValueOnce([
      {
        parser: 'image-ocr',
        parserConfig: {
          expectedRows: '1',
          allowedStageNames: ['WONDER STAGE', 'LIVET STAGE'],
        },
      },
    ]);
    await expect(service.verify('pending', 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('verifies a reviewed batch in one transaction with a system audit actor', async () => {
    findOne.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        sourceId: candidate.sourceId,
        status: 'pending',
        sets: candidate.sets,
      }),
    );
    sourceQuery.mockResolvedValue([
      { parser: 'image-ocr', parserConfig: { expectedRows: '1' } },
    ]);
    const items = [
      { id: 'day-1', sets: candidate.sets },
      { id: 'day-2', sets: candidate.sets },
    ];
    await expect(
      service.verifyReviewedBatch(items, 'a'.repeat(64)),
    ).resolves.toHaveLength(2);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: 'system:reviewed-timetable-import',
      }),
    );
    const recordedCalls = audit.record.mock.calls as unknown as [
      unknown,
      { after: { imageSha256: string } },
    ][];
    expect(recordedCalls[0][1].after.imageSha256).toBe('a'.repeat(64));
    const savedRevisions = save.mock.calls as unknown as [
      { verifiedBy: string | null },
    ][];
    expect(
      savedRevisions.every(([revision]) => revision.verifiedBy === null),
    ).toBe(true);
  });

  it('includes the expected OCR row count in review items', async () => {
    const revision = { id: 'pending', sourceId: candidate.sourceId };
    const orderBy = jest.fn().mockReturnThis();
    const limit = jest.fn().mockReturnThis();
    const getMany = jest.fn().mockResolvedValue([revision]);
    (
      repository as typeof repository & { createQueryBuilder?: jest.Mock }
    ).createQueryBuilder = jest.fn(() => ({ orderBy, limit, getMany }));
    sourceQuery.mockResolvedValueOnce([
      { id: candidate.sourceId, expectedRows: '12' },
    ]);
    await expect(service.list()).resolves.toEqual({
      items: [{ ...revision, expectedRows: 12 }],
    });
  });
});
