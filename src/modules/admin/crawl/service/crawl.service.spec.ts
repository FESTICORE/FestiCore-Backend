import { CrawlService } from './crawl.service';
import { CrawlSource } from '../entity/crawl-source.entity';
import { CrawlRun } from '../entity/crawl-run.entity';
import { Logger, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { createHash } from 'crypto';
import sharp from 'sharp';
import * as imageOcr from './timetable-image-ocr';
import * as artistGallery from './artist-gallery';
import {
  WONDERLIVET_FESTIVAL_URL,
  WONDERLIVET_IMAGE_ORIGIN,
  WONDERLIVET_LINEUP_URL,
} from './wonderlivet-lineup';
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
  syncXmfArtistAliases(source: CrawlSource, body: string): Promise<void>;
  syncXmfAliasesFromRecentSnapshot(source: CrawlSource): Promise<void>;
  reconcileOfficialTicketLinks(
    source: CrawlSource,
    parsed: unknown,
  ): Promise<void>;
};

const XMF_NOTICE_HTML = `<div class="acd_row"><h4>[XMF 2026 최종 라인업 공개]</h4>
  <p>10월 3일부터 4일까지 이틀간 인천 파라다이스시티에서 열리는 XMF 2026.</p>
  <p>첫날인 10월 3일에는 아도(Ado), 루시(LUCY) 등 2팀이 공연한다.</p>
  <p>둘째 날인 4일 무대는 데이식스(DAY6) 등 1팀이 공연한다.</p></div>`;

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
  const proposalsRepo = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) =>
      Promise.resolve({ ...(value as object), id: 'proposal-1' }),
    ),
  };
  const imageStorage = {
    readCrawlSnapshot: jest.fn(),
    saveCrawlSnapshot: jest.fn().mockResolvedValue(undefined),
    saveCrawlImage: jest.fn().mockResolvedValue(undefined),
  };
  const alerts = {
    recordThresholdFailure: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const timetableRevisions = {
    stageCandidate: jest
      .fn()
      .mockImplementation((candidate) =>
        Promise.resolve({ ...candidate, id: 'revision-1' }),
      ),
  };
  const service = new CrawlService(
    sourcesRepo as never,
    runsRepo as never,
    snapshotsRepo as never,
    {} as never,
    proposalsRepo as never,
    dataSource as never,
    imageStorage as never,
    alerts as never,
    audit as never,
    timetableRevisions as never,
  ) as unknown as PrivateCrawl;
  const execute = jest.spyOn(service, 'execute').mockResolvedValue(undefined);
  return {
    service,
    source,
    run,
    runsRepo,
    sourcesRepo,
    dataSource,
    proposalsRepo,
    snapshotsRepo,
    imageStorage,
    alerts,
    audit,
    timetableRevisions,
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

describe('CrawlService official timetable image', () => {
  afterEach(() => jest.restoreAllMocks());

  it('stores a partial OCR result as pending for manual completion', async () => {
    const { service, source, run, runsRepo, timetableRevisions } = harness();
    jest.spyOn(service, 'execute').mockRestore();
    source.kind = 'timetable';
    source.parser = 'image-ocr';
    source.url = 'https://official.example/timetable-day1.jpg';
    source.parserConfig = {
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=123',
      sourcePageUrl: 'https://official.example/notice/1',
      date: '2026-10-17',
      expectedRows: '2',
      columns: JSON.stringify([
        {
          stageId: 'stg_main',
          stageName: 'Main Stage',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
        },
      ]),
    };
    const privateService = service as unknown as {
      limitedGetImage: (url: URL) => Promise<unknown>;
      captureImages: () => Promise<string[]>;
    };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(privateService, 'limitedGetImage').mockResolvedValue({
      status: 200,
      body: Buffer.from('official-image'),
      contentType: 'image/jpeg',
    });
    jest
      .spyOn(privateService, 'captureImages')
      .mockResolvedValue([
        '/api/v1/admin/crawl/images/00000000-0000-4000-8000-000000000010',
      ]);
    jest.spyOn(imageOcr, 'extractTimetableImageCandidates').mockResolvedValue([
      {
        stageId: 'stg_main',
        startsAt: '2026-10-17T12:20:00+09:00',
        endsAt: null,
        artistText: 'Artist A',
        rawText: '12:20 -',
      },
    ]);
    runsRepo.createQueryBuilder.mockReset().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    });

    await service.execute(run, source);

    expect(run.result).toBe('proposed');
    expect(timetableRevisions.stageCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: source.id,
        festivalSourceUrl: source.parserConfig.festivalSourceUrl,
        sourceUrl: source.parserConfig.sourcePageUrl,
        imageId: '00000000-0000-4000-8000-000000000010',
        sets: [
          {
            artist: 'Artist A',
            date: '2026-10-17',
            stageName: 'Main Stage',
            startsAt: '2026-10-17T12:20:00+09:00',
            endsAt: null,
          },
        ],
      }),
    );
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

  it('rejects an artist profile source without a safe event mapping', async () => {
    const { service, dataSource } = harness();
    const dto = {
      kind: 'artist-image',
      url: 'https://artist.example.com/profile',
      parser: 'html-text',
      parserConfig: {
        artistName: 'Artist',
        festivalSourceUrl: 'http://127.0.0.1/private',
        imageHint: 'profile-photo',
      },
    } as CreateCrawlSourceDto;
    await expect(service.createSource(dto, 'admin-1')).rejects.toThrow(
      'festivalSourceUrl',
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('requires a distinctive image hint for an artist profile', async () => {
    const { service, dataSource } = harness();
    const dto = {
      kind: 'artist-image',
      url: 'https://artist.example.com/profile',
      parser: 'html-text',
      parserConfig: {
        artistName: 'Artist',
        festivalSourceUrl:
          'https://ticket.melon.com/performance/index.htm?prodId=213793',
        imageHint: 'logo',
      },
    } as CreateCrawlSourceDto;
    await expect(service.createSource(dto, 'admin-1')).rejects.toThrow(
      'imageHint',
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-string artist alias as invalid source config', async () => {
    const { service, dataSource } = harness();
    const dto = {
      kind: 'artist-image',
      url: 'https://xmfestival.com/lineup',
      parser: 'html-text',
      parserConfig: {
        artistName: 'DAY6',
        artistAlias: null,
        festivalSourceUrl:
          'https://ticket.melon.com/performance/index.htm?prodId=213766',
        imageHint: '20260811/9e91f35508e81.jpg',
      },
    } as unknown as CreateCrawlSourceDto;
    await expect(service.createSource(dto, 'admin-1')).rejects.toMatchObject({
      status: 422,
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not connect the XMF gallery to another ticket on the same site', async () => {
    const { service, dataSource } = harness();
    await expect(
      service.createSource(
        {
          kind: 'artist-gallery',
          url: 'https://xmfestival.com/lineup',
          parser: 'html-text',
          parserConfig: {
            festivalSourceUrl:
              'https://ticket.melon.com/performance/index.htm?prodId=213793',
          },
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('prevents reassigning stored artist photos to another profile or event', async () => {
    const { service, source, dataSource } = harness();
    source.kind = 'artist-image';
    source.url = 'https://artist.example.com/profile';
    await expect(
      service.updateSource(
        source.id,
        { url: 'https://another.example.com/profile' },
        'admin-1',
      ),
    ).rejects.toThrow('변경할 수 없습니다');
    await expect(
      service.updateSource(
        source.id,
        { parserConfig: { artistName: 'Other' } },
        'admin-1',
      ),
    ).rejects.toThrow('변경할 수 없습니다');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('allows a reviewed display alias without changing the image owner', async () => {
    const { service, source, dataSource } = harness();
    source.kind = 'artist-image';
    source.url = 'https://xmfestival.com/lineup';
    source.parserConfig = {
      artistName: 'DAY6',
      artistAlias: '이전 자동 별칭',
      artistAliasSource: 'official-notice',
      imageHint: '20260811/9e91f35508e81.jpg',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
      seed: 'official-artist-gallery',
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue({
        ...source,
        parserConfig: {
          ...source.parserConfig,
          imageHint: '20261023/recent-gallery.jpg',
        },
      }),
      save: jest.fn((value: CrawlSource) => Promise.resolve(value)),
    };
    dataSource.transaction.mockImplementation(
      (
        callback: (manager: {
          getRepository: () => typeof repo;
        }) => Promise<unknown>,
      ) => callback({ getRepository: () => repo }),
    );

    await expect(
      service.updateSource(
        source.id,
        { parserConfig: { artistAlias: '데이식스' } },
        'admin-1',
      ),
    ).resolves.toMatchObject({
      parserConfig: {
        artistName: 'DAY6',
        artistAlias: '데이식스',
        imageHint: '20261023/recent-gallery.jpg',
        seed: 'official-artist-gallery',
      },
    });
    expect(repo.save.mock.calls[0][0].parserConfig).not.toHaveProperty(
      'artistAliasSource',
    );
  });

  it('replaces an automatic XMF alias while preserving a manually reviewed alias', async () => {
    const { service, source, dataSource } = harness();
    source.url = 'https://xmfestival.com/notice';
    source.parserConfig = {
      seed: 'official-lineup',
      expectedYear: '2026',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    const rows = [
      {
        id: 'id-ado',
        enabled: true,
        artistName: 'Ａｄｏ',
        artistAlias: '옛 아도',
        aliasSource: 'official-notice',
        seed: 'official-artist-gallery',
      },
      {
        id: 'id-lucy',
        enabled: true,
        artistName: 'LUCY',
        artistAlias: '수동 별칭',
        aliasSource: null,
        seed: 'official-artist-gallery',
      },
      {
        id: 'id-day6',
        enabled: true,
        artistName: 'DAY6',
        artistAlias: null,
        aliasSource: null,
        seed: 'official-artist-gallery',
      },
    ];
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('SELECT id, enabled') ? rows : []),
    );

    await service.syncXmfArtistAliases(source, XMF_NOTICE_HTML);

    const updates = dataSource.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes('UPDATE crawl_sources'),
    ) as [string, string[]][];
    expect(updates.map(([, values]) => [values[0], values[2]])).toEqual([
      ['id-ado', '아도'],
      ['id-day6', '데이식스'],
    ]);
    expect(updates[0][0]).toContain("'artistAliasSource', 'official-notice'");
    expect(updates[0][0]).toContain(
      'OR NOT ("parserConfig" ? \'artistAlias\')',
    );
  });

  it('links a shortened gallery title only when its official site proves the full notice name', async () => {
    const { service, source, dataSource } = harness();
    source.url = 'https://xmfestival.com/notice';
    source.parserConfig = {
      seed: 'official-lineup',
      expectedYear: '2026',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    const rows = [
      {
        id: 'id-mika',
        enabled: true,
        artistName: 'MIKA',
        artistAlias: null,
        aliasSource: null,
        officialSiteKeys: ['mikanakashima'],
        artistOfficialName: null,
        officialNameSource: null,
        seed: 'official-artist-gallery',
      },
      {
        id: 'id-other',
        enabled: true,
        artistName: 'MIKA BAND',
        artistAlias: null,
        aliasSource: null,
        officialSiteKeys: [],
        artistOfficialName: null,
        officialNameSource: null,
        seed: 'official-artist-gallery',
      },
    ];
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('SELECT id, enabled') ? rows : []),
    );
    const notice = XMF_NOTICE_HTML.replace(
      '아도(Ado), 루시(LUCY) 등 2팀',
      '아도(Ado), 루시(LUCY), 나카시마 미카(MIKA NAKASHIMA) 등 3팀',
    );

    await service.syncXmfArtistAliases(source, notice);

    const updates = dataSource.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes('UPDATE crawl_sources'),
    ) as [string, string[]][];
    expect(updates.map(([, values]) => values.slice(0, 3))).toEqual([
      ['id-mika', 'MIKA NAKASHIMA', '나카시마 미카'],
    ]);
    rows[0].officialSiteKeys = [];
    dataSource.query.mockClear();
    await service.syncXmfArtistAliases(source, notice);
    expect(
      dataSource.query.mock.calls.some(([sql]: [string]) =>
        sql.includes('UPDATE crawl_sources'),
      ),
    ).toBe(false);
  });

  it('clears only obsolete automatic aliases and rejects same-festival conflicts', async () => {
    const { service, source, dataSource } = harness();
    source.url = 'https://xmfestival.com/notice';
    source.parserConfig = {
      seed: 'official-lineup',
      expectedYear: '2026',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    const rows = [
      {
        id: 'id-ado',
        enabled: true,
        artistName: 'Ado',
        artistAlias: '옛 아도',
        aliasSource: 'official-notice',
        seed: 'official-artist-gallery',
      },
      {
        id: 'id-other',
        enabled: true,
        artistName: '아도',
        artistAlias: null,
        aliasSource: null,
        seed: 'manual',
      },
      {
        id: 'id-lucy',
        enabled: false,
        artistName: 'LUCY',
        artistAlias: '루시',
        aliasSource: 'official-notice',
        seed: 'official-artist-gallery',
      },
      {
        id: 'id-day6',
        enabled: true,
        artistName: 'DAY6',
        artistAlias: null,
        aliasSource: null,
        seed: 'official-artist-gallery',
      },
      {
        id: 'id-day6-other',
        enabled: true,
        artistName: 'DAY6',
        artistAlias: null,
        aliasSource: null,
        seed: 'manual',
      },
    ];
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('SELECT id, enabled') ? rows : []),
    );
    await service.syncXmfArtistAliases(source, XMF_NOTICE_HTML);
    expect(
      dataSource.query.mock.calls
        .filter(([sql]: [string]) => sql.includes('UPDATE crawl_sources'))
        .map(([, values]: [string, string[]]) => [values[0], values[2]]),
    ).toEqual([
      ['id-ado', null],
      ['id-lucy', null],
    ]);
  });

  it('clears an automatic alias when the notice proposes two image owners', async () => {
    const { service, source, dataSource } = harness();
    source.url = 'https://xmfestival.com/notice';
    source.parserConfig = {
      seed: 'official-lineup',
      expectedYear: '2026',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    const rows = [
      {
        id: 'id-lucy',
        enabled: true,
        artistName: 'LUCY',
        artistAlias: '루시',
        aliasSource: 'official-notice',
        seed: 'official-artist-gallery',
      },
      {
        id: 'id-band',
        enabled: true,
        artistName: 'LUCY BAND',
        artistAlias: null,
        aliasSource: null,
        seed: 'official-artist-gallery',
      },
    ];
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('SELECT id, enabled') ? rows : []),
    );
    const notice = XMF_NOTICE_HTML.replace(
      '루시(LUCY) 등 2팀',
      '루시(LUCY), 루시(LUCY BAND) 등 3팀',
    );
    await service.syncXmfArtistAliases(source, notice);
    expect(
      dataSource.query.mock.calls
        .filter(([sql]: [string]) => sql.includes('UPDATE crawl_sources'))
        .map(([, values]: [string, string[]]) => [values[0], values[2]]),
    ).toEqual([['id-lucy', null]]);
  });

  it('moves an automatic alias to its new official image owner in one run', async () => {
    const { service, source, dataSource } = harness();
    source.url = 'https://xmfestival.com/notice';
    source.parserConfig = {
      seed: 'official-lineup',
      expectedYear: '2026',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    const rows = [
      {
        id: 'id-lucy',
        enabled: true,
        artistName: 'LUCY',
        artistAlias: '루시',
        aliasSource: 'official-notice',
        seed: 'official-artist-gallery',
      },
      {
        id: 'id-band',
        enabled: true,
        artistName: 'LUCY BAND',
        artistAlias: null,
        aliasSource: null,
        seed: 'official-artist-gallery',
      },
    ];
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('SELECT id, enabled') ? rows : []),
    );
    const notice = XMF_NOTICE_HTML.replace('루시(LUCY)', '루시(LUCY BAND)');
    await service.syncXmfArtistAliases(source, notice);
    expect(
      dataSource.query.mock.calls
        .filter(([sql]: [string]) => sql.includes('UPDATE crawl_sources'))
        .map(([, values]: [string, string[]]) => [values[0], values[2]]),
    ).toEqual([
      ['id-lucy', null],
      ['id-band', '루시'],
    ]);
  });

  it('does not change aliases for another official notice year or invalid counts', async () => {
    const { service, source, dataSource } = harness();
    source.url = 'https://xmfestival.com/notice';
    source.parserConfig = {
      seed: 'official-lineup',
      expectedYear: '2027',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    await service.syncXmfArtistAliases(source, XMF_NOTICE_HTML);
    source.parserConfig.expectedYear = '2026';
    await service.syncXmfArtistAliases(
      source,
      XMF_NOTICE_HTML.replace('등 2팀', '등 3팀'),
    );
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('links a gallery source added after the first valid notice collection', async () => {
    const { service, source, dataSource } = harness();
    source.url = 'https://xmfestival.com/notice';
    source.parserConfig = {
      seed: 'official-lineup',
      expectedYear: '2026',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    let rows: object[] = [];
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('SELECT id, enabled') ? rows : []),
    );
    await service.syncXmfArtistAliases(source, XMF_NOTICE_HTML);
    expect(
      dataSource.query.mock.calls.some(([sql]: [string]) =>
        sql.includes('UPDATE crawl_sources'),
      ),
    ).toBe(false);
    rows = [
      {
        id: 'id-ado',
        enabled: true,
        artistName: 'Ado',
        artistAlias: null,
        aliasSource: null,
        seed: 'official-artist-gallery',
      },
    ];
    await service.syncXmfArtistAliases(source, XMF_NOTICE_HTML);
    expect(
      dataSource.query.mock.calls
        .filter(([sql]: [string]) => sql.includes('UPDATE crawl_sources'))
        .map(([, values]: [string, string[]]) => [values[0], values[2]]),
    ).toEqual([['id-ado', '아도']]);
  });

  it('synchronizes a late gallery alias even when the notice content is unchanged', async () => {
    const { service, source, run, runsRepo, dataSource, execute } = harness();
    execute.mockRestore();
    source.url = 'https://xmfestival.com/notice';
    source.parserConfig = {
      seed: 'official-lineup',
      expectedYear: '2026',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: XMF_NOTICE_HTML,
    });
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
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
      getOne: jest.fn().mockResolvedValue({
        contentHash: createHash('sha256')
          .update(XMF_NOTICE_HTML)
          .update('ticket-list:v4')
          .digest('hex'),
      }),
    }));
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('SELECT id, enabled')
          ? [
              {
                id: 'id-ado',
                enabled: true,
                artistName: 'Ado',
                artistAlias: null,
                aliasSource: null,
                seed: 'official-artist-gallery',
              },
            ]
          : [],
      ),
    );
    const proposalItems = jest.spyOn(service, 'proposalItems');
    await service.execute(run, source);
    expect(run.result).toBe('unchanged');
    expect(
      dataSource.query.mock.calls.some(([sql]: [string]) =>
        sql.includes('UPDATE crawl_sources'),
      ),
    ).toBe(true);
    expect(proposalItems).not.toHaveBeenCalled();
  });

  it('recovers proven XMF aliases from a recent official notice snapshot after HTTP 403', async () => {
    const {
      service,
      source,
      run,
      execute,
      sourcesRepo,
      dataSource,
      imageStorage,
    } = harness();
    execute.mockRestore();
    const festivalSourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213766';
    source.kind = 'artist-gallery';
    source.url = 'https://xmfestival.com/lineup';
    source.parserConfig = { festivalSourceUrl };
    const notice = {
      ...source,
      id: 'notice-1',
      kind: 'discovery',
      url: 'https://xmfestival.com/notice',
      parserConfig: {
        seed: 'official-lineup',
        expectedYear: '2026',
        festivalSourceUrl,
      },
    } as CrawlSource;
    sourcesRepo.findOneBy.mockResolvedValue(notice);
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 403,
      body: '',
    });
    const officialNotice = XMF_NOTICE_HTML.replace(
      '아도(Ado), 루시(LUCY) 등 2팀',
      '아도(Ado), 루시(LUCY), 나카시마 미카(MIKA NAKASHIMA) 등 3팀',
    );
    imageStorage.readCrawlSnapshot.mockResolvedValue(
      Buffer.from(officialNotice),
    );
    dataSource.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM crawl_snapshots'))
        return Promise.resolve([
          { objectKey: 'crawl/snapshots/official-notice.txt' },
        ]);
      if (sql.includes('SELECT id, enabled'))
        return Promise.resolve([
          {
            id: 'ado-image',
            enabled: true,
            artistName: 'Ado',
            artistAlias: null,
            aliasSource: null,
            officialSiteKeys: null,
            seed: 'official-artist-gallery',
          },
          {
            id: 'mika-image',
            enabled: true,
            artistName: 'MIKA',
            artistAlias: null,
            aliasSource: null,
            officialSiteKeys: null,
            seed: 'official-artist-gallery',
          },
        ]);
      return Promise.resolve([]);
    });

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(run.error).toBe('HTTP_403');
    expect(imageStorage.readCrawlSnapshot).toHaveBeenCalledWith(
      'crawl/snapshots/official-notice.txt',
    );
    const lookup = dataSource.query.mock.calls.find(([sql]: [string]) =>
      sql.includes('FROM crawl_snapshots'),
    ) as [string, string[]];
    expect(lookup[0]).toContain("interval '48 hours'");
    expect(lookup[0]).toContain('previous."httpStatus" = 200');
    expect(lookup[0]).toContain('snapshot."expiresAt" > now()');
    expect(lookup[1]).toEqual([
      notice.id,
      notice.url,
      '2026',
      festivalSourceUrl,
    ]);
    const updates = dataSource.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes('UPDATE crawl_sources SET "parserConfig"'),
    ) as [string, string[]][];
    expect(updates.map(([, values]) => [values[0], values[2]])).toEqual([
      ['ado-image', '아도'],
    ]);
  });

  it('ignores a stale or mismatched XMF snapshot without changing aliases', async () => {
    const { service, source, sourcesRepo, dataSource, imageStorage } =
      harness();
    source.kind = 'artist-gallery';
    source.url = 'https://xmfestival.com/lineup';
    source.parserConfig = { festivalSourceUrl: 'https://other.example/fest' };
    sourcesRepo.findOneBy.mockResolvedValue({
      ...source,
      kind: 'discovery',
      url: 'https://xmfestival.com/notice',
      parserConfig: {
        seed: 'official-lineup',
        expectedYear: '2026',
        festivalSourceUrl:
          'https://ticket.melon.com/performance/index.htm?prodId=213766',
      },
    });
    await service.syncXmfAliasesFromRecentSnapshot(source);
    expect(dataSource.query).not.toHaveBeenCalled();

    source.parserConfig.festivalSourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213766';
    await service.syncXmfAliasesFromRecentSnapshot(source);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(imageStorage.readCrawlSnapshot).not.toHaveBeenCalled();
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
  it('marks a changed profile image even when the HTML is unchanged', async () => {
    const { service, source, imageStorage } = harness();
    source.kind = 'artist-image';
    source.url = 'https://artist.example.com/profile';
    jest.spyOn(service, 'checkRobots').mockResolvedValue(undefined);
    const colors = ['#ff0000', '#0000ff'];
    const bodies = await Promise.all(
      colors.map((background) =>
        sharp({
          create: { width: 8, height: 8, channels: 3, background },
        })
          .png()
          .toBuffer(),
      ),
    );
    const limitedGetImage = jest
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: bodies[0],
        contentType: 'image/png',
      })
      .mockResolvedValueOnce({
        status: 200,
        body: bodies[1],
        contentType: 'image/png',
      });
    const imageRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 'image-1' }),
      createQueryBuilder: jest.fn(() => ({
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      })),
    };
    const internals = service as unknown as {
      imageRepo: typeof imageRepo;
      limitedGetImage: typeof limitedGetImage;
      captureImages(
        source: CrawlSource,
        run: CrawlRun,
        urls: URL[],
      ): Promise<string[]>;
    };
    internals.imageRepo = imageRepo;
    internals.limitedGetImage = limitedGetImage;
    const url = new URL('https://artist.example.com/photos/profile.jpg');
    const first = { id: 'run-1', contentHash: 'same-page' } as CrawlRun;
    const second = { id: 'run-2', contentHash: 'same-page' } as CrawlRun;
    await internals.captureImages(source, first, [url]);
    await internals.captureImages(source, second, [url]);
    expect(first.contentHash).not.toBe(second.contentHash);
    expect(imageStorage.saveCrawlImage).toHaveBeenCalledTimes(2);
  });

  it('stores the image found on a configured artist profile without creating a proposal', async () => {
    const { service, source, run, runsRepo, execute } = harness();
    execute.mockRestore();
    source.kind = 'artist-image';
    source.url = 'https://artist.example.com/profile';
    source.parser = 'html-text';
    source.parserConfig = {
      artistName: 'Artist',
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213793',
      imageHint: 'profile-photo',
    };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: '<img src="/photos/profile-photo.jpg">',
    });
    const captureImages = jest
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
      .mockImplementation((_source: CrawlSource, currentRun: CrawlRun) => {
        currentRun.contentHash = 'html-and-updated-image-hash';
        return Promise.resolve(['/api/v1/admin/crawl/images/image-1']);
      });
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        contentHash: createHash('sha256')
          .update('<img src="/photos/profile-photo.jpg">')
          .digest('hex'),
      }),
    }));
    const proposalItems = jest.spyOn(service, 'proposalItems');

    await service.execute(run, source);

    expect(captureImages.mock.calls[0][2].map(String)).toEqual([
      'https://artist.example.com/photos/profile-photo.jpg',
    ]);
    expect(run.result).toBe('nochange-parsed');
    expect(source.lastChangedAt).toBeInstanceOf(Date);
    expect(proposalItems).not.toHaveBeenCalled();
  });

  it('registers official gallery artists from the current page rather than a fixed lineup', async () => {
    const { service, source, run, execute, dataSource } = harness();
    execute.mockRestore();
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('RETURNING id') ? [[], 0] : []),
    );
    source.kind = 'artist-gallery';
    source.url = 'https://xmfestival.com/lineup';
    source.parser = 'html-text';
    source.parserConfig = {
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
    };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: `<a href="${source.parserConfig.festivalSourceUrl}">예매</a>`,
    });
    const gallery = jest.spyOn(artistGallery, 'crawlArtistGallery');
    gallery.mockResolvedValue([
      {
        artistName: 'New Artist From Page',
        imageUrl: new URL('https://cdn.imweb.me/thumbnail/20261023/new.jpg'),
        officialSiteKeys: [],
      },
    ]);

    await service.execute(run, source);

    const calls = dataSource.query.mock.calls as unknown as [
      string,
      unknown[],
    ][];
    const insert = calls.find(([sql]) => sql.includes("SELECT 'artist-image'"));
    expect(insert?.[0]).toContain("SELECT 'artist-image', $1::text");
    expect(insert?.[0]).toContain("'festivalSourceUrl', $2::text");
    expect(insert?.[0]).toContain("'artistName', $3::text");
    expect(insert?.[1]).toEqual([
      'https://xmfestival.com/lineup',
      source.parserConfig.festivalSourceUrl,
      'New Artist From Page',
      '20261023/new.jpg',
      '[]',
    ]);
    expect(run.result).toBe('nochange-parsed');
    gallery.mockRestore();
  });

  it('links official notice aliases in the same run that creates gallery image sources', async () => {
    const { service, source, run, execute, dataSource, sourcesRepo } =
      harness();
    execute.mockRestore();
    const festivalSourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213766';
    source.kind = 'artist-gallery';
    source.url = 'https://xmfestival.com/lineup';
    source.parser = 'html-text';
    source.parserConfig = { festivalSourceUrl };
    const notice = {
      ...source,
      kind: 'discovery',
      url: 'https://xmfestival.com/notice',
      parserConfig: {
        seed: 'official-lineup',
        expectedYear: '2026',
        festivalSourceUrl,
      },
    } as CrawlSource;
    sourcesRepo.findOneBy.mockResolvedValue(notice);
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    const getListing = jest.spyOn(service, 'getListing');
    getListing
      .mockResolvedValueOnce({
        status: 200,
        body: `<a href="${festivalSourceUrl}">예매</a>`,
      })
      .mockResolvedValueOnce({ status: 200, body: XMF_NOTICE_HTML });
    const gallery = jest.spyOn(artistGallery, 'crawlArtistGallery');
    gallery.mockResolvedValue([
      {
        artistName: 'Ado',
        imageUrl: new URL('https://cdn.imweb.me/thumbnail/20261023/ado.jpg'),
        officialSiteKeys: [],
      },
    ]);
    dataSource.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, enabled'))
        return Promise.resolve([
          {
            id: 'ado-image-source',
            enabled: true,
            artistName: 'Ado',
            artistAlias: null,
            aliasSource: null,
            seed: 'official-artist-gallery',
          },
        ]);
      return Promise.resolve(sql.includes('RETURNING id') ? [[], 0] : []);
    });

    await service.execute(run, source);

    expect(getListing).toHaveBeenNthCalledWith(2, notice);
    expect(dataSource.query.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining('UPDATE crawl_sources SET "parserConfig"'),
          ['ado-image-source', null, '아도', festivalSourceUrl, false, true],
        ],
      ]),
    );
    expect(run.result).toBe('nochange-parsed');
    gallery.mockRestore();
  });

  it('keeps a saved gallery run successful when the optional notice request fails', async () => {
    const { service, source, run, execute, dataSource, sourcesRepo } =
      harness();
    execute.mockRestore();
    const festivalSourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213766';
    source.kind = 'artist-gallery';
    source.url = 'https://xmfestival.com/lineup';
    source.parser = 'html-text';
    source.parserConfig = { festivalSourceUrl };
    sourcesRepo.findOneBy.mockResolvedValue({
      ...source,
      kind: 'discovery',
      url: 'https://xmfestival.com/notice',
      parserConfig: {
        seed: 'official-lineup',
        expectedYear: '2026',
        festivalSourceUrl,
      },
    });
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest
      .spyOn(service, 'getListing')
      .mockResolvedValueOnce({
        status: 200,
        body: `<a href="${festivalSourceUrl}">예매</a>`,
      })
      .mockResolvedValueOnce({ status: 503, body: '' });
    const gallery = jest.spyOn(artistGallery, 'crawlArtistGallery');
    gallery.mockResolvedValue([
      {
        artistName: 'Ado',
        imageUrl: new URL('https://cdn.imweb.me/thumbnail/20261023/ado.jpg'),
        officialSiteKeys: [],
      },
    ]);
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('RETURNING id') ? [[], 0] : []),
    );
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await service.execute(run, source);

    expect(run.result).toBe('nochange-parsed');
    expect(source.status).toBe('ok');
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('XMF 공식 라인업 공지 HTTP 503'),
    );
    gallery.mockRestore();
    warning.mockRestore();
  });

  it('reconciles official Wonderlivet artist sources from a complete JSON response', async () => {
    const { service, source, run, execute, dataSource } = harness();
    execute.mockRestore();
    source.kind = 'artist-gallery';
    source.url = WONDERLIVET_LINEUP_URL;
    source.parser = 'html-text';
    source.parserConfig = { festivalSourceUrl: WONDERLIVET_FESTIVAL_URL };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        result: {
          data: {
            json: {
              dataState: 'ready',
              isComingSoon: false,
              artists: [
                {
                  name: 'Official Act',
                  performanceDay: 'DAY2',
                  isPublished: true,
                  imageUrl: `${WONDERLIVET_IMAGE_ORIGIN}/lineup/artists/production/live/day2/official-123.webp`,
                },
              ],
            },
          },
        },
      }),
    });
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('RETURNING id') ? [[], 0] : []),
    );

    await service.execute(run, source);

    const calls = dataSource.query.mock.calls as unknown as [
      string,
      unknown[],
    ][];
    const insert = calls.find(([sql]) => sql.includes("SELECT 'artist-image'"));
    expect(insert?.[1]).toEqual([
      WONDERLIVET_LINEUP_URL,
      WONDERLIVET_FESTIVAL_URL,
      'Official Act',
      '/lineup/artists/production/live/day2/official-123.webp',
    ]);
    expect(run.result).toBe('nochange-parsed');
  });

  it('preserves existing Wonderlivet artist sources on upstream JSON failure', async () => {
    const { service, source, run, execute, dataSource } = harness();
    execute.mockRestore();
    source.kind = 'artist-gallery';
    source.url = WONDERLIVET_LINEUP_URL;
    source.parser = 'html-text';
    source.parserConfig = { festivalSourceUrl: WONDERLIVET_FESTIVAL_URL };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: JSON.stringify({ error: { json: { message: 'Failed query' } } }),
    });

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    const mutations = dataSource.query.mock.calls.map(([sql]) => String(sql));
    expect(
      mutations.filter((sql) => sql.includes("kind = 'artist-image'")),
    ).toEqual([]);
  });

  it('disables only previously enabled official children absent from a complete published lineup', async () => {
    const { service, source, run, execute, dataSource } = harness();
    execute.mockRestore();
    source.kind = 'artist-gallery';
    source.url = WONDERLIVET_LINEUP_URL;
    source.parser = 'html-text';
    source.parserConfig = { festivalSourceUrl: WONDERLIVET_FESTIVAL_URL };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        result: {
          data: {
            json: {
              dataState: 'ready',
              isComingSoon: false,
              artists: [
                {
                  name: 'Former Act',
                  performanceDay: 'DAY1',
                  isPublished: false,
                  imageUrl: null,
                },
                {
                  name: 'Current Act',
                  performanceDay: 'DAY2',
                  isPublished: true,
                  imageUrl: `${WONDERLIVET_IMAGE_ORIGIN}/lineup/artists/production/live/day2/current.webp`,
                },
              ],
            },
          },
        },
      }),
    });
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('SELECT id, "parserConfig"')
          ? [
              {
                id: '00000000-0000-4000-8000-000000000001',
                artistName: 'Former Act',
              },
            ]
          : [],
      ),
    );

    await service.execute(run, source);

    const disable = (
      dataSource.query.mock.calls as unknown as [string, unknown[]][]
    ).find(([sql]) => sql.includes("'disabledBy', 'official-lineup'"));
    expect(disable?.[0]).toContain('AND enabled = true');
    expect(disable?.[1]).toEqual([
      WONDERLIVET_LINEUP_URL,
      WONDERLIVET_FESTIVAL_URL,
      [],
      ['00000000-0000-4000-8000-000000000001'],
    ]);
    expect(run.result).toBe('nochange-parsed');
  });

  it('updates a normalized name match without creating a second image owner', async () => {
    const { service, source, run, execute, dataSource } = harness();
    execute.mockRestore();
    source.kind = 'artist-gallery';
    source.url = WONDERLIVET_LINEUP_URL;
    source.parser = 'html-text';
    source.parserConfig = { festivalSourceUrl: WONDERLIVET_FESTIVAL_URL };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        result: {
          data: {
            json: {
              dataState: 'ready',
              isComingSoon: false,
              artists: [
                {
                  name: 'ACT A',
                  performanceDay: 'DAY1',
                  isPublished: true,
                  imageUrl: `${WONDERLIVET_IMAGE_ORIGIN}/lineup/artists/production/live/day1/new.webp`,
                },
              ],
            },
          },
        },
      }),
    });
    dataSource.query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('SELECT id, "parserConfig"')
          ? [
              {
                id: '00000000-0000-4000-8000-000000000002',
                artistName: 'ＡＣＴ Ａ',
              },
            ]
          : [],
      ),
    );

    await service.execute(run, source);

    const calls = dataSource.query.mock.calls as unknown as [
      string,
      unknown[],
    ][];
    expect(calls.some(([sql]) => sql.includes("SELECT 'artist-image'"))).toBe(
      false,
    );
    const update = calls.find(([sql]) => sql.includes('previousImageHint'));
    expect(update?.[1]).toEqual([
      '00000000-0000-4000-8000-000000000002',
      'ACT A',
      '/lineup/artists/production/live/day1/new.webp',
      WONDERLIVET_LINEUP_URL,
    ]);
    expect(update?.[0]).toContain(
      'COALESCE("parserConfig"->>\'previousImageHint\'',
    );
  });

  it('selects only the matching official Wonderlivet image for an artist source', async () => {
    const { service, source, run, execute, runsRepo, dataSource } = harness();
    execute.mockRestore();
    source.kind = 'artist-image';
    source.url = WONDERLIVET_LINEUP_URL;
    source.parser = 'html-text';
    source.parserConfig = {
      seed: 'official-wonderlivet-lineup',
      artistName: 'Official Act',
      festivalSourceUrl: WONDERLIVET_FESTIVAL_URL,
      imageHint: '/lineup/artists/production/live/day1/official-123.webp',
    };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        result: {
          data: {
            json: {
              dataState: 'ready',
              isComingSoon: false,
              artists: [
                {
                  name: 'Official Act',
                  performanceDay: 'DAY1',
                  isPublished: true,
                  imageUrl: `${WONDERLIVET_IMAGE_ORIGIN}/lineup/artists/production/live/day1/official-123.webp`,
                },
              ],
            },
          },
        },
      }),
    });
    const capture = jest
      .spyOn(
        service as unknown as {
          captureImages: (...args: unknown[]) => Promise<string[]>;
        },
        'captureImages',
      )
      .mockResolvedValue(['/api/v1/admin/crawl/images/image-1']);
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    }));

    await service.execute(run, source);

    expect(capture.mock.calls[0][2]).toEqual([
      new URL(
        `${WONDERLIVET_IMAGE_ORIGIN}/lineup/artists/production/live/day1/official-123.webp`,
      ),
    ]);
    expect(run.result).toBe('nochange-parsed');
    expect(
      dataSource.query.mock.calls.some(([sql]) =>
        String(sql).includes("- 'previousImageHint'"),
      ),
    ).toBe(true);
  });

  it('keeps the previous official image path when replacement capture fails', async () => {
    const { service, source, run, execute, dataSource } = harness();
    execute.mockRestore();
    source.kind = 'artist-image';
    source.url = WONDERLIVET_LINEUP_URL;
    source.parser = 'html-text';
    source.parserConfig = {
      seed: 'official-wonderlivet-lineup',
      artistName: 'Official Act',
      festivalSourceUrl: WONDERLIVET_FESTIVAL_URL,
      imageHint: '/lineup/artists/production/live/day1/new.webp',
      previousImageHint: '/lineup/artists/production/live/day1/old.webp',
    };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        result: {
          data: {
            json: {
              dataState: 'ready',
              isComingSoon: false,
              artists: [
                {
                  name: 'Official Act',
                  performanceDay: 'DAY1',
                  isPublished: true,
                  imageUrl: `${WONDERLIVET_IMAGE_ORIGIN}/lineup/artists/production/live/day1/new.webp`,
                },
              ],
            },
          },
        },
      }),
    });
    jest
      .spyOn(
        service as unknown as {
          captureImages: (...args: unknown[]) => Promise<string[]>;
        },
        'captureImages',
      )
      .mockRejectedValue(new Error('image download failed'));

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(
      dataSource.query.mock.calls.some(([sql]) =>
        String(sql).includes("- 'previousImageHint'"),
      ),
    ).toBe(false);
  });

  it('reparses an unchanged English YES24 listing after the parser update', async () => {
    const { service, source, run, runsRepo, dataSource, execute } = harness();
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
    expect(
      dataSource.query.mock.calls
        .filter(([sql]: [string]) => sql.includes('INSERT INTO crawl_sources'))
        .map(([, parameters]: [string, string[]]) => parameters[0]),
    ).toContain('https://ticket.yes24.com/English/Perf/60590');
  });

  it('reparses an unchanged CDF official post to persist performer profiles', async () => {
    const { service, source, run, runsRepo, proposalsRepo, execute } =
      harness();
    execute.mockRestore();
    source.url = 'https://www.mintpaper.co.kr/posts/4819';
    source.parserConfig = {
      seed: 'official-lineup',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
    };
    const profiles = Array.from({ length: 12 }, (_, index) => [
      `Artist ${index + 1}`,
      `artist_${index + 1}`,
    ]);
    const body = `<h1>COUNTDOWN FANTASY 2026-2027 1차 라인업 공개</h1>
      <div class="PostContent_content__test">12.31<br>
      ${profiles.map(([name, handle]) => `${name} <a href="https://www.instagram.com/${handle}/">@${handle}</a>`).join('<br>')}
      <br>and many more</div>`;
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

    await service.execute(run, source);

    expect(run.contentHash).not.toBe(oldHash);
    expect(run.result).toBe('proposed');
    const proposal = proposalsRepo.save.mock.calls[0][0] as {
      items: { after: { artists: { name: string; profileUrl: string }[] } }[];
    };
    expect(proposal.items[0].after.artists).toHaveLength(12);
    expect(proposal.items[0].after.artists[0]).toEqual({
      name: 'Artist 1',
      profileUrl: 'https://www.instagram.com/artist_1/',
    });
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

  it('registers an official Mint Paper NOL link without a duplicate festival proposal', async () => {
    const { service, source, run, dataSource, runsRepo, execute } = harness();
    execute.mockRestore();
    source.url = 'https://www.mintpaper.co.kr/posts/4821';
    source.parserConfig = {
      seed: 'official-ticket-links',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
    };
    const post = {
      title: 'CDF2026-2027 TICKET | 예매 안내, 입장 안내, 관람 안내',
      content:
        '<p>COUNTDOWN FANTASY 2026-2027 일시 : 2026년 12월 31일</p>' +
        '<a href="https://nol.yanolja.com/ticket/products/26014568">NOL</a>',
    };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { apolloState: { data: { 'Post:4821': post } } } })}</script>`,
    });
    dataSource.query.mockImplementation((sql: string) =>
      sql.includes('RETURNING id')
        ? [{ id: source.id }]
        : sql.includes('SELECT "parserConfig"')
          ? [
              {
                parserConfig: {
                  seed: 'official-ticket-link-detail',
                  festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
                },
              },
            ]
          : [],
    );
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    }));
    const proposals = jest.spyOn(service, 'proposalItems');

    await service.execute(run, source);

    expect(run.result).toBe('nochange-parsed');
    expect(proposals).not.toHaveBeenCalled();
    const calls = dataSource.query.mock.calls as unknown as [
      string,
      string[],
    ][];
    const statements = calls.filter(([sql]) => sql.includes('crawl_sources'));
    expect(
      statements.filter(([sql]) => sql.includes('INSERT INTO')),
    ).toHaveLength(1);
    expect(statements[0][1][0]).toBe(
      'https://nol.yanolja.com/ticket/products/26014568',
    );
    expect(statements[1][1][1]).toContain('official-ticket-link-detail');
    expect(statements[1][1][1]).toContain(
      'https://mintpaper.co.kr/festivals/178',
    );
    expect(statements[0][0]).toContain(
      `"parserConfig"->>'seed' = 'ticket-detail'`,
    );
    expect(statements[0][0]).toContain(
      `"parserConfig"->>'festivalSourceUrl' = $3`,
    );
    expect(statements[0][1][2]).toBe('https://mintpaper.co.kr/festivals/178');
    const verifiedUpdate = statements.find(([sql]) =>
      sql.includes("'verifiedTicketUrls'"),
    );
    expect(verifiedUpdate?.[0]).toContain('RETURNING id');
    expect(verifiedUpdate?.[1]).toEqual([
      source.id,
      '["https://nol.yanolja.com/ticket/products/26014568"]',
      'https://mintpaper.co.kr/festivals/178',
    ]);
  });

  it('fails when the official parent changes before the verified URL set is saved', async () => {
    const { service, source, dataSource } = harness();
    source.parserConfig = {
      seed: 'official-ticket-links',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
    };
    dataSource.query.mockImplementation((sql: string) =>
      sql.includes('SELECT "parserConfig"')
        ? [
            {
              parserConfig: {
                seed: 'official-ticket-link-detail',
                festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
              },
            },
          ]
        : [],
    );
    await expect(
      service.reconcileOfficialTicketLinks(source, [
        { url: 'https://nol.yanolja.com/ticket/products/26014568' },
      ]),
    ).rejects.toThrow('부모 소스 설정이 변경');
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("'verifiedTicketUrls'"),
      [
        source.id,
        '["https://nol.yanolja.com/ticket/products/26014568"]',
        'https://mintpaper.co.kr/festivals/178',
      ],
    );
  });

  it('reconciles an official NOL link even when the notice content is unchanged', async () => {
    const { service, source, run, dataSource, runsRepo, execute } = harness();
    execute.mockRestore();
    source.url = 'https://www.mintpaper.co.kr/posts/4821';
    source.parserConfig = {
      seed: 'official-ticket-links',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
    };
    const body = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { apolloState: { data: { 'Post:4821': { title: 'CDF2026-2027 TICKET | 예매 안내, 입장 안내, 관람 안내', content: '<p>COUNTDOWN FANTASY 2026-2027 일시 : 2026년 12월 31일</p><a href="https://nol.yanolja.com/ticket/products/26014568">NOL</a>' } } } } })}</script>`;
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({ status: 200, body });
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        contentHash: createHash('sha256')
          .update(body)
          .update('ticket-list:v3')
          .digest('hex'),
      }),
    }));
    dataSource.query.mockImplementation((sql: string) =>
      sql.includes('RETURNING id')
        ? [{ id: source.id }]
        : sql.includes('SELECT "parserConfig"')
          ? [
              {
                parserConfig: {
                  seed: 'official-ticket-link-detail',
                  festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
                },
              },
            ]
          : [],
    );
    const proposals = jest.spyOn(service, 'proposalItems');

    await service.execute(run, source);

    expect(run.result).toBe('unchanged');
    expect(proposals).not.toHaveBeenCalled();
    expect(
      dataSource.query.mock.calls.filter(([sql]: [string]) =>
        sql.includes('INSERT INTO crawl_sources'),
      ),
    ).toHaveLength(1);
    for (const fragment of [
      'UPDATE crawl_sources SET "parserConfig"',
      'SELECT "parserConfig" FROM crawl_sources',
    ]) {
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining(fragment),
        expect.arrayContaining([
          'https://nol.yanolja.com/ticket/products/26014568',
        ]),
      );
    }
  });

  it('fails an unchanged official notice when its NOL links disappear', async () => {
    const { service, source, run, dataSource, runsRepo, execute } = harness();
    execute.mockRestore();
    source.url = 'https://www.mintpaper.co.kr/posts/4821';
    source.parserConfig = {
      seed: 'official-ticket-links',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
    };
    const body = '<html><body>공식 공지가 변경되었습니다.</body></html>';
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({ status: 200, body });
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        contentHash: createHash('sha256')
          .update(body)
          .update('ticket-list:v3')
          .digest('hex'),
      }),
    }));

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(run.error).toBe('PARSE');
    expect(
      dataSource.query.mock.calls.some(([sql]: [string]) =>
        sql.includes('INSERT INTO crawl_sources'),
      ),
    ).toBe(false);
  });

  it('rejects an unchanged official notice with a different seed before writing', async () => {
    const { service, source, run, dataSource, runsRepo, execute } = harness();
    execute.mockRestore();
    source.url = 'https://www.mintpaper.co.kr/posts/4821';
    source.parserConfig = { seed: 'manual' };
    const body = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { apolloState: { data: { 'Post:4821': { title: 'CDF2026-2027 TICKET | 예매 안내, 입장 안내, 관람 안내', content: '<p>COUNTDOWN FANTASY 2026-2027 일시 : 2026년 12월 31일</p><a href="https://nol.yanolja.com/ticket/products/26014568">NOL</a>' } } } } })}</script>`;
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({ status: 200, body });
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        contentHash: createHash('sha256')
          .update(body)
          .update('ticket-list:v3')
          .digest('hex'),
      }),
    }));

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(run.error).toBe('PARSE');
    expect(
      dataSource.query.mock.calls.some(
        ([sql]: [string]) =>
          sql.includes('INSERT INTO crawl_sources') ||
          sql.includes('UPDATE crawl_sources SET "parserConfig"'),
      ),
    ).toBe(false);
  });

  it('preserves an existing NOL source with a different configuration', async () => {
    const { service, source, run, dataSource, runsRepo, execute } = harness();
    execute.mockRestore();
    source.url = 'https://www.mintpaper.co.kr/posts/4821';
    source.parserConfig = {
      seed: 'official-ticket-links',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
    };
    const content =
      '<p>COUNTDOWN FANTASY 2026-2027 일시 : 2026년 12월 31일</p>' +
      '<a href="https://nol.yanolja.com/ticket/products/26014568">NOL</a>';
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: `<script id="__NEXT_DATA__">${JSON.stringify({ props: { apolloState: { data: { 'Post:4821': { title: 'CDF2026-2027 TICKET | 예매 안내, 입장 안내, 관람 안내', content } } } } })}</script>`,
    });
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    }));
    dataSource.query.mockImplementation((sql: string) =>
      sql.includes('SELECT "parserConfig"')
        ? [{ parserConfig: { seed: 'manual', festivalSourceUrl: 'other' } }]
        : [],
    );
    const warning = jest.spyOn(
      (service as unknown as { logger: { warn: (message: string) => void } })
        .logger,
      'warn',
    );

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(run.error).toBe('PARSE');
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('크롤 처리 실패:'),
    );
    const update = (
      dataSource.query.mock.calls as unknown as [string, string[]][]
    ).find(([sql]) => sql.includes('UPDATE crawl_sources'));
    expect(update?.[0]).toContain(`"parserConfig"->>'seed' = 'ticket-detail'`);
    expect(update?.[0]).toContain(`"parserConfig"->>'festivalSourceUrl' = $3`);
  });

  it('does not turn a reconfigured official post source into a festival proposal', async () => {
    const { service, source, run, dataSource, runsRepo, execute } = harness();
    execute.mockRestore();
    source.url = 'https://www.mintpaper.co.kr/posts/4821';
    source.parserConfig = { seed: 'manual' };
    jest.spyOn(service, 'checkRobots').mockResolvedValue();
    jest.spyOn(service, 'getListing').mockResolvedValue({
      status: 200,
      body: `<script id="__NEXT_DATA__">${JSON.stringify({ props: { apolloState: { data: { 'Post:4821': { title: 'CDF2026-2027 TICKET | 예매 안내, 입장 안내, 관람 안내', content: '<p>COUNTDOWN FANTASY 2026-2027 일시 : 2026년 12월 31일</p><a href="https://nol.yanolja.com/ticket/products/26014568">NOL</a>' } } } } })}</script>`,
    });
    runsRepo.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    }));
    const proposals = jest.spyOn(service, 'proposalItems');

    await service.execute(run, source);

    expect(run.result).toBe('failed');
    expect(proposals).not.toHaveBeenCalled();
    expect(
      dataSource.query.mock.calls.some(([sql]: [string]) =>
        sql.includes('INSERT INTO crawl_sources'),
      ),
    ).toBe(false);
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
    dataSource.query.mockResolvedValueOnce([[{ consecutiveFailures: 3 }], 1]);

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
