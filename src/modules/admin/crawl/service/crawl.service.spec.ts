import { CrawlService } from './crawl.service';
import { CrawlSource } from '../entity/crawl-source.entity';
import { CrawlRun } from '../entity/crawl-run.entity';
import { NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { createHash } from 'crypto';
import {
  CreateCrawlSourceDto,
  UpdateCrawlSourceDto,
} from '../dto/crawl-source.dto';

type PrivateCrawl = {
  scheduleDue(): Promise<void>;
  runNow(id: string): Promise<{ runId: string }>;
  createSource(
    dto: CreateCrawlSourceDto,
    actor: string | null,
  ): Promise<CrawlSource>;
  updateSource(
    id: string,
    dto: UpdateCrawlSourceDto,
    actor: string | null,
  ): Promise<CrawlSource>;
  checkRobots(url: string): Promise<void>;
  snapshot(id: string): Promise<{ body: string }>;
  proposalItems(
    source: CrawlSource,
    parsed: unknown,
  ): Promise<{
    kind: string;
    items: { id: string; op: string; path: string; after: unknown }[];
  }>;
  execute(run: CrawlRun, source: CrawlSource): Promise<void>;
  getListing(source: CrawlSource): Promise<{ status: number; body: string }>;
};

function harness() {
  const source = {
    id: 'source-1',
    kind: 'discovery',
    createdAt: new Date('2026-10-19T00:00:00Z'),
    enabled: true,
    status: 'ok',
    url: 'https://tickets.example.com/events',
    parser: 'ticket-list',
    parserConfig: { sourceName: 'Tickets' },
    festivalId: null,
    consecutiveFailures: 2,
  } as unknown as CrawlSource;
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
    create: jest.fn((value: unknown) => value),
    save: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
  };
  const sourcesRepo = {
    findBy: jest.fn().mockResolvedValue([source]),
    findOneBy: jest.fn().mockResolvedValue(source),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn(),
    transaction: jest.fn((callback: (manager: unknown) => Promise<unknown>) =>
      callback({}),
    ),
  };
  const imageStorage = {
    readCrawlSnapshot: jest.fn(),
    saveCrawlSnapshot: jest.fn().mockResolvedValue(undefined),
  };
  const alerts = {
    recordThresholdFailure: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new CrawlService(
    sourcesRepo as never,
    runsRepo as never,
    snapshotsRepo as never,
    {} as never,
    {} as never,
    dataSource as never,
    imageStorage as never,
    alerts as never,
    audit as never,
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
    audit,
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

  it('retries a broken source on the next Korean calendar day', async () => {
    const { service, source, sourcesRepo, execute } = harness();
    source.status = 'broken';
    source.lastRunAt = new Date('2026-10-20T14:59:00Z');

    await service.scheduleDue();

    expect(sourcesRepo.findBy).toHaveBeenCalledWith({
      enabled: true,
      status: In(['ok', 'broken']),
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry a broken source again after a run today', async () => {
    const { service, source, execute } = harness();
    source.status = 'broken';
    source.lastRunAt = new Date('2026-10-20T15:00:00Z');

    await service.scheduleDue();

    expect(execute).not.toHaveBeenCalled();
  });
});

describe('CrawlService source audit', () => {
  it('records a new source in the same transaction', async () => {
    const { service, dataSource, audit } = harness();
    jest.spyOn(service, 'checkRobots').mockResolvedValue(undefined);
    const repo = {
      create: jest.fn((value: CrawlSource) => value),
      save: jest.fn((value: CrawlSource) =>
        Promise.resolve({ ...value, id: 'source-new' }),
      ),
    };
    const manager = { getRepository: jest.fn(() => repo) };
    dataSource.transaction.mockImplementation(
      (callback: (transactionManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    );
    const dto = {
      kind: 'discovery',
      url: 'https://tickets.example.com/events',
      parser: 'ticket-list',
      parserConfig: { sourceName: 'Tickets' },
    } as CreateCrawlSourceDto;

    await expect(service.createSource(dto, 'admin-1')).resolves.toMatchObject({
      id: 'source-new',
    });
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin-1',
      action: 'crawl.source.created',
      target: 'crawl-source:source-new',
      before: null,
      after: {
        id: 'source-new',
        festivalId: null,
        kind: 'discovery',
        url: dto.url,
        parser: 'ticket-list',
        parserConfig: dto.parserConfig,
        enabled: true,
        status: 'ok',
      },
    });
  });

  it('records the previous and new source settings', async () => {
    const { service, source, dataSource, audit } = harness();
    const checkRobots = jest
      .spyOn(service, 'checkRobots')
      .mockResolvedValue(undefined);
    const repo = {
      findOne: jest.fn().mockResolvedValue(source),
      save: jest.fn((value: CrawlSource) => Promise.resolve(value)),
    };
    const manager = { getRepository: jest.fn(() => repo) };
    dataSource.transaction.mockImplementation(
      (callback: (transactionManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    );

    await service.updateSource(
      source.id,
      { enabled: false, url: source.url },
      'admin-1',
    );

    expect(checkRobots).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin-1',
      action: 'crawl.source.updated',
      target: `crawl-source:${source.id}`,
      before: {
        id: source.id,
        festivalId: null,
        kind: 'discovery',
        url: source.url,
        parser: 'ticket-list',
        parserConfig: source.parserConfig,
        enabled: true,
        status: 'ok',
      },
      after: {
        id: source.id,
        festivalId: null,
        kind: 'discovery',
        url: source.url,
        parser: 'ticket-list',
        parserConfig: source.parserConfig,
        enabled: false,
        status: 'disabled',
      },
    });
  });

  it('does not start a manual run when the request audit fails', async () => {
    const { service, source, audit, insertQb } = harness();
    audit.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.runNow(source.id)).rejects.toThrow(
      'audit unavailable',
    );
    expect(insertQb.execute).not.toHaveBeenCalled();
  });
});

describe('CrawlService manual runs and snapshots', () => {
  it('reparses an unchanged English YES24 listing after the parser update', async () => {
    const { service, source, run, runsRepo, execute } = harness();
    execute.mockRestore();
    source.url = 'https://ticket.yes24.com/English/Genre/Concert';
    const body = `<ul class="list_wrap">
      <li class="poster"><a href="/English/Perf/60590"><img alt="poster"></a></li>
      <li class="conlist"><h3><a href="/English/Perf/60590">COUNTDOWN FANTASY 2026-2027</a></h3>
        <ul class="con_txt"><li><span>Genre</span>: [Festival]</li><li><span>Date/Time</span>: Dec 31, 2026</li><li><span>Venue</span>: KINTEX HALL 7·8</li></ul>
      </li></ul>`;
    const oldHash = createHash('sha256')
      .update(body)
      .update('ticket-list:v3')
      .digest('hex');
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({ status: 200, body });
    jest
      .spyOn(
        service as unknown as {
          captureImages(
            source: CrawlSource,
            run: CrawlRun,
            urls: URL[],
          ): Promise<string[]>;
        },
        'captureImages',
      )
      .mockResolvedValue([]);
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ contentHash: oldHash }),
    }));
    const proposalItems = jest
      .spyOn(service, 'proposalItems')
      .mockResolvedValue({
        kind: 'discovery',
        items: [],
      });

    await service.execute(run, source);

    expect(proposalItems).toHaveBeenCalledTimes(1);
    expect(run.result).toBe('nochange-parsed');
    expect(run.contentHash).not.toBe(oldHash);
  });

  it('registers only NOL product pages discovered from a festival listing', async () => {
    const { service, source, run, dataSource, runsRepo, execute } = harness();
    execute.mockRestore();
    source.url = 'https://nol.yanolja.com/ticket/genre/concert';
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: '<script>self.__next_f.push([1,"action":{"web":"https://nol.yanolja.com/ticket/places/25000827/products/26013510"},"title":"ASEAN-Korea Music Festival 2026","dateInfo":"26.11.07 ~ 26.11.08","locationDetails":["인천남동체육관"]},{"action":{"web":"https://nol.yanolja.com/ticket.evil.example/products/1"},"title":"Fake Festival"}]);</script>',
    });
    jest
      .spyOn(
        service as unknown as {
          captureImages(
            source: CrawlSource,
            run: CrawlRun,
            urls: URL[],
          ): Promise<string[]>;
        },
        'captureImages',
      )
      .mockResolvedValue([]);
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    }));
    jest.spyOn(service, 'proposalItems').mockResolvedValue({
      kind: 'discovery',
      items: [],
    });

    await service.execute(run, source);

    expect(run.result).toBe('nochange-parsed');
    const sourceUrls = dataSource.query.mock.calls
      .filter(([sql]: [string]) => sql.includes('INSERT INTO crawl_sources'))
      .map(([, parameters]: [string, string[]]) => parameters[0]);
    expect(sourceUrls).toEqual([
      'https://nol.yanolja.com/ticket/products/26013510',
    ]);
  });

  it('fetches bounded YES24 category pages and combines their listings', async () => {
    const { service, source } = harness();
    source.url =
      'https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx?genre=15464&sort=0&area=&genretype=2&pCurPage=1&pPageSize=30';
    const crawler = service as unknown as {
      checkRobots(url: string): Promise<void>;
      limitedGet(url: URL): Promise<{ status: number; body: string }>;
    };
    const robots = jest.spyOn(crawler, 'checkRobots').mockResolvedValue();
    const get = jest
      .spyOn(crawler, 'limitedGet')
      .mockResolvedValueOnce({
        status: 200,
        body: '<input id="ListTotalCnt" value="99"/><a>first</a>',
      })
      .mockResolvedValue({ status: 200, body: '<a>next</a>' });

    await expect(service.getListing(source)).resolves.toEqual({
      status: 200,
      body: '<input id="ListTotalCnt" value="99"/><a>first</a>\n<a>next</a>\n<a>next</a>\n<a>next</a>',
    });
    expect(get).toHaveBeenCalledTimes(4);
    expect(
      get.mock.calls.map(([url]) => url.searchParams.get('pCurPage')),
    ).toEqual(['1', '2', '3', '4']);
    expect(robots).toHaveBeenCalledTimes(3);
  });

  it('does not request an extra YES24 page without a valid total', async () => {
    const { service, source } = harness();
    source.url =
      'https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx?genre=15464&pCurPage=1&pPageSize=30';
    const crawler = service as unknown as {
      limitedGet(url: URL): Promise<{ status: number; body: string }>;
    };
    const get = jest.spyOn(crawler, 'limitedGet').mockResolvedValue({
      status: 200,
      body: '<input id="ListTotalCnt" value="4"/>',
    });
    await service.getListing(source);
    expect(get).toHaveBeenCalledTimes(1);
  });

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
      .mockRejectedValue(new Error('수집 실패: oauth-refresh-token-raw'));
    dataSource.query.mockResolvedValueOnce([{ consecutiveFailures: 3 }]);

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(runsRepo.save).toHaveBeenCalledWith(run);
    expect(alerts.recordThresholdFailure).toHaveBeenCalledWith(
      source.id,
      run.id,
      'ROBOTS',
    );
    expect(JSON.stringify(run)).not.toContain('oauth-refresh-token-raw');
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
