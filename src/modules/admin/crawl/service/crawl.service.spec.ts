import { CrawlService } from './crawl.service';
import { CrawlSource } from '../entity/crawl-source.entity';
import { CrawlRun } from '../entity/crawl-run.entity';
import { NotFoundException } from '@nestjs/common';

type PrivateCrawl = {
  scheduleDue(): Promise<void>;
  runNow(id: string): Promise<{ runId: string }>;
  snapshot(id: string): Promise<{ body: string }>;
  proposalItems(
    source: CrawlSource,
    parsed: unknown,
  ): Promise<{
    kind: string;
    items: { id: string; op: string; path: string; after: unknown }[];
  }>;
  execute(run: CrawlRun, source: CrawlSource): Promise<void>;
};

function harness() {
  const source = {
    id: 'source-1',
    kind: 'discovery',
    createdAt: new Date('2026-10-19T00:00:00Z'),
    enabled: true,
    status: 'ok',
    url: 'https://tickets.example.com/events',
    consecutiveFailures: 2,
  } as CrawlSource;
  const run = { id: 'run-1', sourceId: source.id } as CrawlRun;
  const insertResult = { identifiers: [{ id: run.id }] };
  const reclaimResult = { raw: [] as { id: string }[] };
  const insertQb = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockImplementation(() => Promise.resolve(insertResult)),
  };
  const updateQb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockImplementation(() => Promise.resolve(reclaimResult)),
  };
  const runsRepo = {
    createQueryBuilder: jest
      .fn()
      .mockImplementationOnce(() => updateQb)
      .mockImplementationOnce(() => insertQb)
      .mockImplementation(() => updateQb),
    findOneByOrFail: jest.fn().mockResolvedValue(run),
    findOneBy: jest.fn().mockResolvedValue(run),
    save: jest
      .fn()
      .mockImplementation((value: unknown) => Promise.resolve(value)),
  };
  const snapshotsRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn(),
  };
  const sourcesRepo = {
    findBy: jest.fn().mockResolvedValue([source]),
    findOneBy: jest.fn().mockResolvedValue(source),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn(),
  };
  const imageStorage = { readCrawlSnapshot: jest.fn() };
  const alerts = {
    recordThresholdFailure: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CrawlService(
    sourcesRepo as never,
    runsRepo as never,
    snapshotsRepo as never,
    {} as never,
    {} as never,
    dataSource as never,
    imageStorage as never,
    alerts as never,
  ) as unknown as PrivateCrawl;
  const execute = jest.spyOn(service, 'execute').mockResolvedValue(undefined);
  return {
    service,
    source,
    run,
    runsRepo,
    sourcesRepo,
    dataSource,
    snapshotsRepo,
    imageStorage,
    alerts,
    insertQb,
    insertResult,
    updateQb,
    reclaimResult,
    execute,
  };
}

describe('CrawlService scheduled runs', () => {
  beforeEach(() =>
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T15:00:00Z')),
  );
  afterEach(() => jest.useRealTimers());

  it('reserves one run for the current Korean calendar date', async () => {
    const { service, source, insertQb, execute } = harness();

    await service.scheduleDue();

    expect(insertQb.values).toHaveBeenCalledWith({
      sourceId: source.id,
      scheduledDate: '2026-10-21',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('skips a duplicate daily run that is still active', async () => {
    const { service, insertResult, reclaimResult, execute } = harness();
    insertResult.identifiers = [];
    reclaimResult.raw = [];

    await service.scheduleDue();

    expect(execute).not.toHaveBeenCalled();
  });

  it('reclaims an abandoned daily run after the stale threshold', async () => {
    const { service, insertResult, reclaimResult, updateQb, execute } =
      harness();
    insertResult.identifiers = [];
    reclaimResult.raw = [{ id: 'run-1' }];

    await service.scheduleDue();

    expect(updateQb.andWhere).toHaveBeenCalledWith(
      '"startedAt" < :staleBefore',
      { staleBefore: new Date('2026-10-20T14:45:00Z') },
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not run a source added after midnight in Korea', async () => {
    const { service, source, insertQb, execute } = harness();
    source.createdAt = new Date('2026-10-20T15:00:00Z');

    await service.scheduleDue();

    expect(insertQb.execute).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('CrawlService manual runs and snapshots', () => {
  it('allows an unavailable 4xx robots file but fails closed on 5xx', async () => {
    const { service } = harness();
    const crawler = service as unknown as {
      checkRobots(url: string): Promise<void>;
      limitedGet(url: URL): Promise<{ status: number; body: string }>;
    };
    const get = jest.spyOn(crawler, 'limitedGet');
    get.mockResolvedValueOnce({ status: 403, body: '' });
    await expect(
      crawler.checkRobots(
        'https://mintpaper.s3.ap-northeast-2.amazonaws.com/poster.jpg',
      ),
    ).resolves.toBeUndefined();
    get.mockResolvedValueOnce({ status: 503, body: '' });
    await expect(
      crawler.checkRobots(
        'https://mintpaper.s3.ap-northeast-2.amazonaws.com/poster.jpg',
      ),
    ).rejects.toThrow('robots.txt 확인에 실패');
  });

  it('marks an abandoned manual run failed before reserving a replacement', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T15:00:00Z'));
    try {
      const { service, source, updateQb, insertQb } = harness();

      await service.runNow(source.id);

      expect(updateQb.set).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'failed' }),
      );
      expect(updateQb.andWhere).toHaveBeenCalledWith('"scheduledDate" IS NULL');
      expect(updateQb.andWhere).toHaveBeenCalledWith(
        '"startedAt" < :staleBefore',
        { staleBefore: new Date('2026-10-20T14:45:00Z') },
      );
      expect(insertQb.execute).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('records an alert when the persisted failure count reaches three', async () => {
    const { service, source, run, dataSource, runsRepo, alerts, execute } =
      harness();
    execute.mockRestore();
    jest
      .spyOn(
        service as unknown as { checkRobots(url: string): Promise<void> },
        'checkRobots',
      )
      .mockRejectedValue(new Error('수집 실패'));
    dataSource.query.mockResolvedValueOnce([{ consecutiveFailures: 3 }]);

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(runsRepo.save).toHaveBeenCalledWith(run);
    expect(alerts.recordThresholdFailure).toHaveBeenCalledWith(
      source.id,
      run.id,
      '수집 실패',
    );
  });

  it('returns the active run instead of starting the same source twice', async () => {
    const { service, insertResult, execute, run } = harness();
    insertResult.identifiers = [];

    await expect(service.runNow('source-1')).resolves.toEqual({
      runId: run.id,
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('reads an unexpired snapshot from object storage', async () => {
    const { service, snapshotsRepo, imageStorage } = harness();
    snapshotsRepo.findOneBy.mockResolvedValue({
      id: 'snapshot-1',
      runId: 'run-1',
      objectKey: 'crawl/snapshots/snapshot-1.txt',
      createdAt: new Date('2026-10-20T10:00:00Z'),
      expiresAt: new Date(Date.now() + 1000),
    });
    imageStorage.readCrawlSnapshot.mockResolvedValue(
      Buffer.from('<html>ok</html>'),
    );

    await expect(service.snapshot('snapshot-1')).resolves.toEqual(
      expect.objectContaining({ body: '<html>ok</html>' }),
    );
    expect(imageStorage.readCrawlSnapshot).toHaveBeenCalledWith(
      'crawl/snapshots/snapshot-1.txt',
    );
  });

  it('does not expose an expired snapshot', async () => {
    const { service, snapshotsRepo, imageStorage } = harness();
    snapshotsRepo.findOneBy.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.snapshot('snapshot-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(imageStorage.readCrawlSnapshot).not.toHaveBeenCalled();
  });
});

describe('CrawlService proposal changes', () => {
  it('omits festival URLs already proposed or present in a draft', async () => {
    const { service, source, dataSource } = harness();
    dataSource.query.mockResolvedValueOnce([
      { url: 'https://tickets.example.com/one', value: null },
    ]);

    const result = await service.proposalItems(source, [
      { name: '기존 축제', url: 'https://tickets.example.com/one' },
      { name: '새 축제', url: 'https://tickets.example.com/two' },
    ]);

    expect(result.items).toEqual([
      expect.objectContaining({
        after: { name: '새 축제', url: 'https://tickets.example.com/two' },
      }),
    ]);
  });

  it('reproposes a changed discovery entry even when its URL has an open proposal', async () => {
    const { service, source, dataSource } = harness();
    const url = 'https://tickets.example.com/one';
    dataSource.query.mockResolvedValueOnce([
      { url, value: { name: '기존 제목', url } },
    ]);

    const result = await service.proposalItems(source, [
      { name: '변경된 제목', url },
    ]);

    expect(result.items).toEqual([
      expect.objectContaining({ after: { name: '변경된 제목', url } }),
    ]);
    const queryCall = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(queryCall[0]).toContain("status IN ('open', 'partial')");
  });

  it('does not duplicate the same open discovery entry when JSON keys are reordered', async () => {
    const { service, source, dataSource } = harness();
    const url = 'https://tickets.example.com/one';
    dataSource.query.mockResolvedValueOnce([
      { url, value: { url, name: '같은 축제' } },
    ]);

    const result = await service.proposalItems(source, [
      { name: '같은 축제', url },
    ]);

    expect(result.items).toEqual([]);
  });

  it('removes disappeared timetable sets only when owned by this source', async () => {
    const { service, source, dataSource } = harness();
    source.kind = 'timetable';
    source.festivalId = 'fst-1';
    dataSource.getRepository.mockReturnValue({
      findOneBy: jest.fn().mockResolvedValue({
        draft: {
          sets: [
            { id: 'owned', crawlSourceId: source.id },
            { id: 'other', crawlSourceId: 'source-2' },
            { id: 'manual' },
          ],
        },
      }),
    });

    const result = await service.proposalItems(source, []);

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'owned', op: 'remove', path: '/sets/0' }),
    ]);
  });
});
