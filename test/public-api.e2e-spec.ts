import { ForbiddenException, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { Server } from 'http';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AdminFestival } from '../src/modules/admin/festival/festival.entity';
import { DeviceAuthGuard } from '../src/modules/device/device-auth.guard';
import { DeviceService } from '../src/modules/device/device.service';
import { Crew, CrewGather, CrewMember } from '../src/modules/crews/crew.entity';
import {
  Flag,
  FlagBearer,
  FlagFollow,
  FlagPin,
} from '../src/modules/flags/flag.entity';
import { PublicFestivalController } from '../src/modules/public/public-festival.controller';
import { discoverySummaries } from '../src/modules/public/crawl-catalog';
import { PublicFestivalService } from '../src/modules/public/public-festival.service';
import { publicFestivalTestDataSource } from './public-festival-test-data-source';
import { PublicLiveService } from '../src/modules/public/public-live.service';
import { CacheService } from '../src/modules/redis/service/cache.service';

/** 목록 커서의 정렬 기준일. 서비스와 같이 서울 날짜로 오늘을 쓴다. */
function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function envelopeData<T>(body: unknown, code: string): T {
  expect(body).toBeInstanceOf(Object);
  expect(Object.keys(body as object).sort()).toEqual([
    'code',
    'data',
    'message',
  ]);
  const envelope = body as { code: unknown; data: T; message: unknown };
  expect(envelope.code).toBe(code);
  expect(typeof envelope.message).toBe('string');
  return envelope.data;
}

function successData<T>(body: unknown): T {
  return envelopeData<T>(body, 'SUCCESS');
}

function errorData<T>(body: unknown, code: string): T {
  return envelopeData<T>(body, code);
}

describe('Public festival API', () => {
  let app: INestApplication;
  let server: Server;
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const repo = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    findOne: jest.fn(),
  };
  const flagRepo = { find: jest.fn().mockResolvedValue([]) };
  const emptyRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const storedPackImageId = '00000000-0000-4000-8000-000000000001';
  let discoveryRows: { candidate: Record<string, unknown> }[] = [];
  let storedOriginImages: { originUrl: string; id: string }[] = [];
  let rateLimitCount = 1;
  let previousPackRows: { pack: Record<string, unknown> }[] = [];
  let packImageRows: Record<string, unknown>[] = [];
  const dataSource = {
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM "admin_festival_versions"'))
        return Promise.resolve(previousPackRows);
      if (sql.includes('INSERT INTO public_live_rate_limits'))
        return Promise.resolve([{ count: rateLimitCount }]);
      if (sql.includes('WITH candidates AS'))
        return Promise.resolve(discoveryRows);
      if (sql.includes('FROM crawl_images image')) {
        if (sql.includes('image.id = ANY($2::uuid[])'))
          return Promise.resolve(packImageRows);
        if (sql.includes('image.id = ANY($1::uuid[])'))
          return Promise.resolve([{ id: storedPackImageId, seed: null }]);
        if (sql.includes('image."originUrl" = ANY($1::text[])'))
          return Promise.resolve(storedOriginImages);
      }
      return Promise.resolve([]);
    }),
  };
  Object.assign(dataSource, publicFestivalTestDataSource(dataSource.query));
  const deviceAuth = {
    resolveOptionalPrincipal: jest.fn().mockResolvedValue(undefined),
  };
  const devices = {
    listSubscriptions: jest.fn().mockResolvedValue({ items: [] }),
  };
  const pack = {
    id: 'fst_12345678',
    name: 'Festival',
    venue: 'Park',
    timezone: 'Asia/Seoul',
    days: [
      {
        date: '2026-11-20',
        startsAt: '2026-11-20T12:00:00+09:00',
        endsAt: '2026-11-20T22:00:00+09:00',
      },
    ],
    flagsEnabled: true,
    thumbUrl:
      '/api/v1/festivals/images/00000000-0000-4000-8000-000000000001.webp',
    ticketLinks: [
      { label: '예스24', url: 'https://ticket.yes24.com/Perf/12345' },
    ],
    flags: [
      {
        id: 'flg_12345678',
        tags: ['slam'],
        thumbUrl: 'https://example.com/a.webp',
      },
      { id: 'flg_87654321', tags: ['calm'], thumbUrl: null },
    ],
    packVersion: 7,
    packUpdatedAt: '2026-11-18T09:00:00+09:00',
  };
  const published = { id: pack.id, published: pack, publishedVersion: 7 };

  beforeAll(async () => {
    queryBuilder.getMany.mockResolvedValue([published]);
    repo.findOne.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === pack.id ? published : null),
    );
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [PublicFestivalController],
      providers: [
        PublicFestivalService,
        PublicLiveService,
        { provide: DeviceAuthGuard, useValue: deviceAuth },
        { provide: DeviceService, useValue: devices },
        {
          provide: CacheService,
          useValue: {
            packGeneration: jest.fn().mockResolvedValue(null),
            getPack: jest.fn().mockResolvedValue(null),
            setPack: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'test-access-secret' },
        },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Flag), useValue: flagRepo },
        { provide: getRepositoryToken(FlagFollow), useValue: emptyRepo },
        { provide: getRepositoryToken(FlagPin), useValue: emptyRepo },
        { provide: getRepositoryToken(FlagBearer), useValue: emptyRepo },
        { provide: getRepositoryToken(Crew), useValue: emptyRepo },
        { provide: getRepositoryToken(CrewMember), useValue: emptyRepo },
        { provide: getRepositoryToken(CrewGather), useValue: emptyRepo },
        { provide: getRepositoryToken(AdminFestival), useValue: repo },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.setGlobalPrefix('api/v1');
    app.enableCors({ origin: ['https://festicoreadmin-dev.up.railway.app'] });
    await app.listen(0);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    discoveryRows = [];
    storedOriginImages = [];
    packImageRows = [{ id: storedPackImageId, seed: null }];
    rateLimitCount = 1;
  });

  it('lists published festivals and sends conditional list caching', async () => {
    const first = await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=20')
      .set('Origin', 'https://festicoreadmin-dev.up.railway.app')
      .expect(200);
    const listBody = successData<{ items: unknown[] }>(first.body);
    expect(listBody.items).toEqual([
      expect.objectContaining({
        id: pack.id,
        packVersion: 7,
        thumbUrl: pack.thumbUrl,
        ticketLinks: pack.ticketLinks,
      }),
    ]);
    expect(first.headers['cache-control']).toBe(
      'public, no-cache, must-revalidate',
    );
    expect(first.headers.vary).toBe('Origin, Authorization, X-Device-Id');
    expect(first.headers['access-control-allow-origin']).toBe(
      'https://festicoreadmin-dev.up.railway.app',
    );
    expect(first.headers.date).toBeDefined();
    expect(first.headers.etag).toMatch(/^"cdm1-/);
    await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=20')
      .set('If-None-Match', first.headers.etag.replace('cdm1-', ''))
      .expect(200);
    const notModified = await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=20')
      .set('Origin', 'https://festicoreadmin-dev.up.railway.app')
      .set('If-None-Match', first.headers.etag)
      .set('Cache-Control', 'no-cache')
      .expect(304);
    expect(notModified.headers['cache-control']).toBe(
      'public, no-cache, must-revalidate',
    );
    expect(notModified.headers['access-control-allow-origin']).toBe(
      'https://festicoreadmin-dev.up.railway.app',
    );
  });

  it('returns an updated list when the previous ETag no longer matches', async () => {
    queryBuilder.getMany
      .mockResolvedValueOnce([published])
      .mockResolvedValueOnce([
        published,
        {
          id: 'fst_87654321',
          published: { ...pack, id: 'fst_87654321', name: 'New Festival' },
          publishedVersion: 7,
        },
      ]);
    const first = await request(server).get('/api/v1/festivals').expect(200);
    const refreshed = await request(server)
      .get('/api/v1/festivals')
      .set('If-None-Match', first.headers.etag)
      .expect(200);
    expect(refreshed.headers.etag).not.toBe(first.headers.etag);
    expect(refreshed.headers['cache-control']).toBe(
      'public, no-cache, must-revalidate',
    );
    expect(
      successData<{ items: { name: string }[] }>(refreshed.body).items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'New Festival' }),
      ]),
    );
  });

  it('includes pinned only for an authenticated device and uses a private cache', async () => {
    deviceAuth.resolveOptionalPrincipal.mockResolvedValueOnce({
      kind: 'device',
      deviceId: 'device-a',
      tokenId: 'token-a',
    });
    devices.listSubscriptions.mockResolvedValueOnce({
      items: [{ festivalId: pack.id, pinned: true }],
    });
    const response = await request(server)
      .get('/api/v1/festivals')
      .set('X-Device-Id', 'device-a')
      .set('Authorization', 'Bearer token-a')
      .expect(200);
    const body = successData<{ items: { pinned?: boolean }[] }>(response.body);
    expect(body.items[0].pinned).toBe(true);
    expect(response.headers['cache-control']).toBe('private, max-age=60');
    expect(response.headers.vary).toBe('Origin, Authorization, X-Device-Id');
    expect(devices.listSubscriptions).toHaveBeenCalledWith(
      'device-a',
      expect.objectContaining({ kind: 'device' }),
    );
  });

  it('keeps the public list available when a device ID does not belong to the Bearer', async () => {
    deviceAuth.resolveOptionalPrincipal.mockResolvedValueOnce({
      kind: 'device',
      deviceId: 'device-a',
      tokenId: 'token-a',
    });
    devices.listSubscriptions.mockRejectedValueOnce(
      new ForbiddenException('기기 소유권을 확인할 수 없습니다.'),
    );
    const response = await request(server)
      .get('/api/v1/festivals')
      .set('X-Device-Id', 'device-b')
      .set('Authorization', 'Bearer token-a')
      .expect(200);
    expect(
      successData<{ items: { pinned?: boolean }[] }>(response.body).items[0],
    ).not.toHaveProperty('pinned');
    expect(response.headers['cache-control']).toBe(
      'public, no-cache, must-revalidate',
    );
    expect(response.headers.vary).toBe('Origin, Authorization, X-Device-Id');
  });

  it('uses a visible legacy flag image when the published pack has no thumbnail', async () => {
    queryBuilder.getMany.mockResolvedValueOnce([
      {
        ...published,
        published: { ...pack, thumbUrl: undefined },
      },
    ]);
    const response = await request(server).get('/api/v1/festivals').expect(200);
    const body = successData<{ items: { thumbUrl: string }[] }>(response.body);
    expect(body.items[0].thumbUrl).toBe('https://example.com/a.webp');
  });

  it('does not expose a hidden flag image in the list thumbnail', async () => {
    queryBuilder.getMany.mockResolvedValueOnce([
      {
        ...published,
        published: {
          ...pack,
          thumbUrl: undefined,
          flags: [
            { thumbUrl: 'https://example.com/private.webp', hidden: true },
          ],
        },
      },
    ]);
    const response = await request(server).get('/api/v1/festivals').expect(200);
    expect(
      successData<{ items: { thumbUrl: string | null }[] }>(response.body)
        .items[0].thumbUrl,
    ).toBeNull();
  });

  it('includes crawled discoveries when no festival pack has been published', async () => {
    queryBuilder.getMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const candidates = [
      {
        candidate: {
          name: '2026 대구힙합페스티벌',
          venue: '대구 엑스코',
          date: '2026.12.25 - 2026.12.26',
          url: 'https://ticket.melon.com/performance/index.htm?prodId=213665',
        },
      },
    ];
    discoveryRows = candidates;
    const first = await request(server)
      .get('/api/v1/festivals?limit=1')
      .expect(200);
    const body = successData<{ items: { id: string }[] }>(first.body);
    expect(body.items).toEqual([
      expect.objectContaining({
        name: '2026 대구힙합페스티벌',
        packVersion: 0,
        status: 'discovered',
        firstDate: '2026-12-25',
        lastDate: '2026-12-26',
        sourceUrl:
          'https://ticket.melon.com/performance/index.htm?prodId=213665',
        ticketLinks: [
          {
            label: '멜론티켓',
            url: 'https://ticket.melon.com/performance/index.htm?prodId=213665',
          },
        ],
      }),
    ]);
    const id = body.items[0].id;
    const unavailablePack = await request(server)
      .get(`/api/v1/festivals/${id}/pack`)
      .expect(404);
    expect(
      errorData<null>(unavailablePack.body, 'FESTIVAL_NOT_FOUND'),
    ).toBeNull();
    await request(server)
      .get('/api/v1/festivals?limit=1')
      .set('If-None-Match', first.headers.etag)
      .expect(304);
  });

  it('serves only the published pack with exact version ETag', async () => {
    const first = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack`)
      .expect(200);
    expect(first.headers['cache-control']).toBe(
      'public, no-cache, must-revalidate',
    );
    expect(successData(first.body)).toEqual(
      expect.objectContaining({
        id: pack.id,
        name: pack.name,
        days: pack.days,
        packVersion: 7,
        thumbUrl: pack.thumbUrl,
        ticketLinks: pack.ticketLinks,
      }),
    );
    expect(first.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack`)
      .set('If-None-Match', '"v7"')
      .expect(200);
    await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack`)
      .set('If-None-Match', '"cdm1-v7"')
      .expect(200);
    const unchanged = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack`)
      .set('If-None-Match', first.headers.etag)
      .expect(304);
    expect(unchanged.text).toBe('');
    const missing = await request(server)
      .get('/api/v1/festivals/fst_unknown/pack')
      .expect(404);
    expect(errorData<null>(missing.body, 'FESTIVAL_NOT_FOUND')).toBeNull();
  });

  it('summarizes changes between the stored and published pack versions', async () => {
    previousPackRows = [
      {
        pack: {
          ...pack,
          packVersion: 6,
          sets: [
            {
              id: 'set_removed',
              stageId: 'stg_a',
              artist: '지난 밴드',
              startsAt: '2026-11-20T12:00:00+09:00',
              endsAt: '2026-11-20T12:30:00+09:00',
            },
          ],
          directions: {
            lastShuttleAt: '2026-11-20T23:40:00+09:00',
            lastTrainAt: null,
            lastDepartures: [
              {
                date: '2026-11-20',
                shuttleAt: '2026-11-20T23:40:00+09:00',
                trainAt: null,
              },
            ],
          },
        },
      },
    ];
    const changed = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/changes?from=6`)
      .expect(200);
    expect(changed.headers['cache-control']).toBe(
      'public, no-cache, must-revalidate',
    );
    const body = successData<Record<string, unknown>>(changed.body);
    expect(body).toEqual({
      fromVersion: 6,
      toVersion: 7,
      sizeBytes: expect.any(Number) as number,
      changedSets: 1,
      lastShuttleAt: { before: '2026-11-20T23:40:00+09:00', after: null },
      lastTrainAt: null,
      lastDepartures: [
        {
          date: '2026-11-20',
          before: { shuttleAt: '2026-11-20T23:40:00+09:00', trainAt: null },
          after: null,
        },
      ],
    });
    expect(body.sizeBytes).toBeGreaterThan(0);
    const packVersion = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/version`)
      .expect(200);
    const packEtag = String(packVersion.headers.etag);
    expect(changed.headers.etag).toBe(
      `"cdm6-chg6-${packEtag.replace(/"/g, '')}"`,
    );
    const unchanged = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/changes?from=6`)
      .set('If-None-Match', changed.headers.etag)
      .expect(304);
    expect(unchanged.text).toBe('');
    await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/changes?from=5`)
      .set('If-None-Match', changed.headers.etag)
      .expect(200);

    // 같은 packVersion에서 이미지 승인 상태만 바뀌면 /pack ETag와 함께 바뀐다.
    packImageRows = [
      { id: storedPackImageId, seed: null, rightsRunId: 'run_relicensed' },
    ];
    const overlaid = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/changes?from=6`)
      .set('If-None-Match', changed.headers.etag)
      .expect(200);
    expect(successData<{ toVersion: number }>(overlaid.body).toVersion).toBe(7);
    expect(overlaid.headers.etag).not.toBe(changed.headers.etag);
    const overlaidPack = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/version`)
      .expect(200);
    expect(overlaidPack.headers.etag).not.toBe(packEtag);
    expect(overlaid.headers.etag).toBe(
      `"cdm6-chg6-${String(overlaidPack.headers.etag).replace(/"/g, '')}"`,
    );

    const latest = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/changes?from=7`)
      .expect(200);
    expect(successData<{ changedSets: number }>(latest.body).changedSets).toBe(
      0,
    );

    previousPackRows = [];
    const unknown = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/changes?from=3`)
      .expect(200);
    expect(
      successData<{ changedSets: number | null }>(unknown.body).changedSets,
    ).toBeNull();

    for (const from of ['', 'abc', '0', '1.5']) {
      const invalid = await request(server)
        .get(`/api/v1/festivals/${pack.id}/pack/changes?from=${from}`)
        .expect(400);
      expect(errorData<null>(invalid.body, 'VALIDATION')).toBeNull();
    }
    await request(server)
      .get('/api/v1/festivals/fst_unknown/pack/changes?from=1')
      .expect(404);
  });

  it('returns a discovered festival detail with stored poster and artist images', async () => {
    const candidate = {
      candidate: {
        name: 'WONDERLIVET 2026 (원더리벳 2026)',
        venue: 'KINTEX HALL 7/8/9/10',
        date: '2026.11.20 - 2026.11.22',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
        locationEvidence: {
          point: {
            latitude: 37.66469544695199,
            longitude: 126.742064181796,
            label: 'KINTEX HALL 7/8/9/10',
          },
          sourceUrl:
            'https://ticket.melon.com/performance/index.htm?prodId=213793',
          verifiedAt: '2026-10-28T11:00:00Z',
        },
        posterUrl:
          'https://cdnticket.melon.co.kr/resource/image/upload/product/poster.jpg',
        artists: [
          {
            name: 'THE ORAL CIGARETTES',
            sourceUrl: 'https://cdnimg.melon.co.kr/artist/1.jpg',
          },
        ],
      },
    };
    discoveryRows = [candidate];
    storedOriginImages = [
      {
        originUrl: candidate.candidate.posterUrl,
        id: '00000000-0000-4000-8000-000000000001',
      },
      {
        originUrl: candidate.candidate.artists[0].sourceUrl,
        id: '00000000-0000-4000-8000-000000000002',
      },
    ];
    const id = discoverySummaries([candidate])[0].id;
    const response = await request(server)
      .get(`/api/v1/festivals/${id}`)
      .expect(200);
    expect(
      successData<{ location: unknown }>(response.body).location,
    ).toMatchObject({
      latitude: 37.66469544695199,
      longitude: 126.742064181796,
      label: 'KINTEX HALL 7/8/9/10',
      source: { name: '멜론티켓' },
    });
    expect(successData<Record<string, unknown>>(response.body)).toMatchObject({
      id,
      status: 'discovered',
      thumbUrl:
        '/api/v1/festivals/images/00000000-0000-4000-8000-000000000001.webp',
      artists: [
        {
          name: 'THE ORAL CIGARETTES',
          imageUrl:
            '/api/v1/festivals/images/00000000-0000-4000-8000-000000000002.webp',
        },
      ],
      timetable: [],
    });
  });

  it('returns a published festival detail and rejects unknown IDs', async () => {
    const response = await request(server)
      .get(`/api/v1/festivals/${pack.id}`)
      .expect(200);
    expect(successData<Record<string, unknown>>(response.body)).toMatchObject({
      id: pack.id,
      packVersion: 7,
    });
    const missing = await request(server)
      .get('/api/v1/festivals/fst_unknown')
      .expect(404);
    expect(errorData<null>(missing.body, 'FESTIVAL_NOT_FOUND')).toBeNull();
  });

  it('does not expose a festival that has only an admin draft', async () => {
    repo.findOne.mockResolvedValueOnce({
      id: pack.id,
      draft: pack,
      published: null,
      publishedVersion: 0,
    });
    await request(server).get(`/api/v1/festivals/${pack.id}/pack`).expect(404);
  });

  it('projects published pack fields recursively without internal image keys', async () => {
    repo.findOne.mockResolvedValueOnce({
      ...published,
      published: {
        ...pack,
        venue: 'KINTEX HALL 7/8/9/10',
        internalSecret: 'TOP_LEVEL_SECRET',
        source: {
          name: 'Official',
          url: null,
          verifiedAt: pack.packUpdatedAt,
          apiKey: 'SOURCE_SECRET',
        },
        stages: [
          {
            id: 'stg_main',
            name: 'Main',
            order: 1,
            color: null,
            staffNote: 'STAGE_SECRET',
          },
        ],
        flags: [
          {
            id: 'flg_12345678',
            name: 'Flag',
            thumbUrl: 'flags/private-key.webp',
            thumbKey: 'IMAGE_SECRET',
            photoKey: 'PHOTO_SECRET',
            tags: ['slam', { secret: 'TAG_SECRET' }],
            planVisible: false,
            plan: ['set_one'],
            hidden: false,
          },
          {
            id: 'flg_private',
            visibility: 'private',
            photoUrl: 'https://example.com/private.webp',
          },
        ],
        directions: {
          location: {
            latitude: 37.66469544695199,
            longitude: 126.742064181796,
            label: 'KINTEX HALL 7/8/9/10',
            source: {
              name: '멜론티켓',
              url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
              verifiedAt: pack.packUpdatedAt,
              internalSecret: 'LOCATION_SOURCE_SECRET',
            },
            internalSecret: 'LOCATION_SECRET',
          },
          shuttle: {
            body: 'Shuttle',
            links: [
              {
                label: 'Map',
                url: 'https://example.com',
                secret: 'LINK_SECRET',
              },
            ],
            secret: 'SHUTTLE_SECRET',
            stopName: '정문 셔틀 정류장',
            location: {
              latitude: 37.6651,
              longitude: 126.7411,
              secret: 'STOP_LOCATION_SECRET',
            },
          },
          transit: {
            body: 'Train',
            links: [],
            stationName: '킨텍스역',
            walkMinutes: 10,
            location: { latitude: '37.66', longitude: 126.74 },
          },
          lastShuttleAt: '23:40',
          lastTrainAt: '2026-11-20T23:52:00+09:00',
          lastDepartures: [
            {
              date: '2026-11-20',
              shuttleAt: '2026-11-20T23:40:00+09:00',
              trainAt: null,
              secret: 'DEPARTURE_SECRET',
            },
          ],
          mapLinks: { naver: null, kakao: null, secret: 'MAP_SECRET' },
          source: {
            name: 'Official',
            url: null,
            verifiedAt: pack.packUpdatedAt,
            key: 'DIRECTION_SECRET',
          },
        },
      },
    });
    const response = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack`)
      .expect(200);
    const serialized = JSON.stringify(response.body);
    for (const secret of [
      'TOP_LEVEL_SECRET',
      'SOURCE_SECRET',
      'STAGE_SECRET',
      'IMAGE_SECRET',
      'PHOTO_SECRET',
      'TAG_SECRET',
      'LINK_SECRET',
      'SHUTTLE_SECRET',
      'MAP_SECRET',
      'DEPARTURE_SECRET',
      'DIRECTION_SECRET',
      'LOCATION_SECRET',
      'LOCATION_SOURCE_SECRET',
      'STOP_LOCATION_SECRET',
      'flags/private-key.webp',
    ])
      expect(serialized).not.toContain(secret);
    expect(
      successData<{
        flags: { plan: string[]; thumbUrl: string | null }[];
      }>(response.body).flags[0],
    ).toEqual(expect.objectContaining({ plan: [], thumbUrl: null }));
    expect(successData<{ flags: unknown[] }>(response.body).flags).toHaveLength(
      1,
    );
    const directions = successData<{
      directions: {
        shuttle: unknown;
        transit: unknown;
        lastDepartures: unknown;
      };
    }>(response.body).directions;
    expect(directions.shuttle).toEqual({
      body: 'Shuttle',
      links: [{ label: 'Map', url: 'https://example.com' }],
      stopName: '정문 셔틀 정류장',
      location: { latitude: 37.6651, longitude: 126.7411 },
    });
    // 형식이 다른 역 좌표는 null로 보내고 역 이름·도보 분은 그대로 둔다.
    expect(directions.transit).toEqual({
      body: 'Train',
      links: [],
      stationName: '킨텍스역',
      walkMinutes: 10,
      location: null,
    });
    expect(directions).toMatchObject({
      lastShuttleAt: null,
      lastTrainAt: '2026-11-20T23:52:00+09:00',
    });
    expect(directions.lastDepartures).toEqual([
      {
        date: '2026-11-20',
        shuttleAt: '2026-11-20T23:40:00+09:00',
        trainAt: null,
      },
    ]);
    expect(
      successData<{ directions: { location: unknown } }>(response.body)
        .directions.location,
    ).toEqual({
      latitude: 37.66469544695199,
      longitude: 126.742064181796,
      label: 'KINTEX HALL 7/8/9/10',
      source: {
        name: '멜론티켓',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
        verifiedAt: pack.packUpdatedAt,
      },
    });
  });

  it('returns version and filters flag tags with OR semantics', async () => {
    const version = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/version`)
      .expect(200);
    expect(successData(version.body)).toEqual({
      packVersion: 7,
      packUpdatedAt: pack.packUpdatedAt,
      etag: version.headers.etag,
    });
    expect(version.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/version`)
      .set('If-None-Match', version.headers.etag)
      .expect(304);
    const flags = await request(server)
      .get(`/api/v1/festivals/${pack.id}/flags?tag=slam&tag=newbie`)
      .expect(200);
    const flagsBody = successData<{ items: { id: string }[] }>(flags.body);
    expect(flagsBody.items).toHaveLength(1);
    expect(flagsBody.items[0].id).toBe('flg_12345678');
    const invalid = await request(server)
      .get(`/api/v1/festivals/${pack.id}/flags?tag=invalid`)
      .expect(400);
    expect(errorData<null>(invalid.body, 'VALIDATION')).toBeNull();
  });

  it('uses backend image proxy URLs for stored public flag photos', async () => {
    flagRepo.find.mockResolvedValueOnce([
      {
        id: 'flg_12345678',
        festivalId: pack.id,
        name: 'Public flag',
        visibility: 'public',
        hidden: false,
        photoKey: 'flags/flg_12345678/one/photo.webp',
        thumbKey: 'flags/flg_12345678/one/thumbnail.webp',
        photoUrl: 'https://old.example/photo.webp',
        thumbUrl: 'https://old.example/thumbnail.webp',
        tags: ['slam'],
        bio: null,
        followerCount: 0,
        planVisible: true,
        plan: [],
        homeZoneId: null,
      },
      {
        id: 'flg_87654321',
        festivalId: pack.id,
        visibility: 'public',
        hidden: true,
      },
    ]);
    const response = await request(server)
      .get(`/api/v1/festivals/${pack.id}/flags`)
      .expect(200);
    const body = successData<{
      items: { id: string; photoUrl: string; thumbUrl: string }[];
    }>(response.body);
    expect(body.items).toEqual([
      expect.objectContaining({
        id: 'flg_12345678',
        photoUrl: '/api/v1/flags/flg_12345678/photo',
        thumbUrl: '/api/v1/flags/flg_12345678/thumbnail',
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('flags/flg_12345678/one');
    expect(response.headers['cache-control']).toBe('public, max-age=600');
  });

  it('rejects invalid list inputs', async () => {
    await request(server).get('/api/v1/festivals?after=2026-02-30').expect(400);
    await request(server).get('/api/v1/festivals?limit=51').expect(400);
    await request(server)
      .get('/api/v1/festivals?after=2026-10-21&after=2026-10-22')
      .expect(400);
  });

  it('paginates by festival date then ID without skipping a same-day festival', async () => {
    queryBuilder.getMany.mockResolvedValueOnce([
      published,
      {
        id: 'fst_87654321',
        published: {
          ...pack,
          id: 'fst_87654321',
          days: [{ ...pack.days[0], startsAt: '2026-11-20T13:00:00+09:00' }],
        },
        publishedVersion: 7,
      },
    ]);
    const first = await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=1')
      .expect(200);
    const body = successData<{ items: { id: string }[]; nextCursor: string }>(
      first.body,
    );
    expect(body.items[0].id).toBe('fst_12345678');
    expect(body.nextCursor).toBe(
      `2026-10-21~v2~${seoulToday()}~1~2026-11-20~fst_12345678`,
    );
    queryBuilder.getMany.mockResolvedValueOnce([
      {
        id: 'fst_87654321',
        published: {
          ...pack,
          id: 'fst_87654321',
          days: [{ ...pack.days[0], startsAt: '2026-11-20T13:00:00+09:00' }],
        },
        publishedVersion: 7,
      },
    ]);
    const second = await request(server)
      .get(
        `/api/v1/festivals?after=${encodeURIComponent(body.nextCursor)}&limit=1`,
      )
      .expect(200);
    expect(
      successData<{ items: { id: string }[] }>(second.body).items[0].id,
    ).toBe('fst_87654321');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('festival.id > :cursorId'),
      { cursorBucket: 1, cursorDate: '2026-11-20', cursorId: 'fst_12345678' },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining('THEN 0 WHEN'),
      'ASC',
    );
  });

  it('lists, paginates and downloads published metadata without inventing performance times', async () => {
    const metadata = ['fst_000metadata1', 'fst_000metadata2'].map((id) => ({
      id,
      publishedVersion: 1,
      published: {
        ...pack,
        id,
        packVersion: 1,
        flagsEnabled: false,
        flags: [],
        eventPeriod: { firstDate: '2026-11-20', lastDate: '2026-11-21' },
        timetableStatus: 'unpublished',
        days: [],
        stages: [],
        sets: [],
        artists: [{ name: 'Official Band' }],
      },
    }));
    type ListPage = {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    // Same-day metadata packs sort before the published pack by ID.
    queryBuilder.getMany.mockResolvedValueOnce([...metadata, published]);
    const first = await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=1')
      .expect(200);
    const firstPage = successData<ListPage>(first.body);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({
      id: 'fst_000metadata1',
      packVersion: 1,
      firstDate: '2026-11-20',
      lastDate: '2026-11-21',
      artists: [{ name: 'Official Band', performances: [] }],
    });
    expect(firstPage.items[0]).not.toHaveProperty('startsAt');
    expect(firstPage.nextCursor).toBe(
      `2026-10-21~v2~${seoulToday()}~1~2026-11-20~fst_000metadata1`,
    );

    queryBuilder.andWhere.mockClear();
    queryBuilder.getMany.mockResolvedValueOnce([metadata[1], published]);
    const second = await request(server)
      .get(
        `/api/v1/festivals?after=${encodeURIComponent(firstPage.nextCursor!)}&limit=1`,
      )
      .expect(200);
    const secondPage = successData<ListPage>(second.body);
    expect(secondPage.items.map((item) => item.id)).toEqual([
      'fst_000metadata2',
    ]);
    expect(secondPage.nextCursor).toBe(
      `2026-10-21~v2~${seoulToday()}~1~2026-11-20~fst_000metadata2`,
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('festival.id > :cursorId'),
      {
        cursorBucket: 1,
        cursorDate: '2026-11-20',
        cursorId: 'fst_000metadata1',
      },
    );
    queryBuilder.getMany.mockResolvedValueOnce([published]);
    const third = await request(server)
      .get(
        `/api/v1/festivals?after=${encodeURIComponent(secondPage.nextCursor!)}&limit=1`,
      )
      .expect(200);
    expect(
      successData<ListPage>(third.body).items.map((item) => item.id),
    ).toEqual([pack.id]);
    expect(successData<ListPage>(third.body).nextCursor).toBeNull();

    repo.findOne.mockResolvedValueOnce(metadata[0]);
    const downloaded = await request(server)
      .get('/api/v1/festivals/fst_000metadata1/pack')
      .expect(200);
    const document = successData<Record<string, unknown>>(downloaded.body);
    expect(document).toMatchObject({
      id: 'fst_000metadata1',
      packVersion: 1,
      eventPeriod: { firstDate: '2026-11-20', lastDate: '2026-11-21' },
      timetableStatus: 'pending',
      days: [],
      stages: [],
      sets: [],
      timetable: [],
      artists: [{ name: 'Official Band', imageUrl: null }],
    });
    expect(JSON.stringify(document)).not.toContain('startsAt');
    expect(JSON.stringify(document)).not.toContain('endsAt');
    expect(downloaded.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    repo.findOne.mockResolvedValueOnce(metadata[0]);
    await request(server)
      .get('/api/v1/festivals/fst_000metadata1/pack')
      .set('If-None-Match', downloaded.headers.etag)
      .expect(304);
  });

  it('orders same-day festivals by ID regardless of start time offset', async () => {
    const later = {
      id: 'fst_87654321',
      published: {
        ...pack,
        id: 'fst_87654321',
        days: [{ ...pack.days[0], startsAt: '2026-11-20T04:00:00Z' }],
      },
      publishedVersion: 7,
    };
    queryBuilder.getMany.mockResolvedValueOnce([published, later]);
    const first = await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=1')
      .expect(200);
    const body = successData<{ items: { id: string }[]; nextCursor: string }>(
      first.body,
    );
    expect(body.items[0].id).toBe('fst_12345678');
    expect(body.nextCursor).toBe(
      `2026-10-21~v2~${seoulToday()}~1~2026-11-20~fst_12345678`,
    );
    queryBuilder.getMany.mockResolvedValueOnce([later]);
    await request(server)
      .get(
        `/api/v1/festivals?after=${encodeURIComponent(body.nextCursor)}&limit=1`,
      )
      .expect(200);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('festival.id > :cursorId'),
      { cursorBucket: 1, cursorDate: '2026-11-20', cursorId: 'fst_12345678' },
    );
  });

  it('keeps the original after date when following a cursor', async () => {
    queryBuilder.getMany.mockResolvedValueOnce([
      published,
      {
        id: 'fst_87654321',
        published: { ...pack, id: 'fst_87654321' },
        publishedVersion: 7,
      },
    ]);
    const first = await request(server)
      .get('/api/v1/festivals?after=2025-01-01&limit=1')
      .expect(200);
    const cursor = successData<{ nextCursor: string }>(first.body).nextCursor;
    expect(cursor).toMatch(/^2025-01-01~/);
    queryBuilder.andWhere.mockClear();
    queryBuilder.getMany.mockResolvedValueOnce([]);
    await request(server)
      .get(`/api/v1/festivals?after=${encodeURIComponent(cursor)}&limit=1`)
      .expect(200);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "COALESCE(festival.published->'days'->-1->>'date', festival.published->'eventPeriod'->>'lastDate') >= :floor",
      { floor: '2025-01-01' },
    );
  });

  it('bounds listing in SQL before fetching full pack JSON', async () => {
    await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=1')
      .expect(200);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'festival.published IS NOT NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'festival.publishedVersion > 0',
    );
    expect(queryBuilder.take).toHaveBeenCalledWith(2);
  });

  it('uses conditional ETags across compressed representations', async () => {
    const url = `/api/v1/festivals/${pack.id}/pack`;
    const identity = await request(server)
      .get(url)
      .set('Accept-Encoding', 'identity')
      .expect(200);
    expect(identity.headers['content-encoding']).toBeUndefined();
    const disabled = await request(server)
      .get(url)
      .set('Accept-Encoding', 'br;q=0, gzip;q=0')
      .expect(200);
    expect(disabled.headers['content-encoding']).toBeUndefined();
    await request(server).get(url).set('If-None-Match', '*').expect(304);
    await request(server)
      .get(url)
      .set('If-None-Match', identity.headers.etag)
      .expect(304);
  });

  it('serves anonymous live state and 304 without refreshing server time', async () => {
    const device = '3f9a2c1d-2b77-4e7e-9a1b-2a0123456789';
    const first = await request(server)
      .get(`/api/v1/festivals/${pack.id}/live`)
      .set('X-Device-Id', device)
      .expect(200);
    expect(successData<{ me: null }>(first.body).me).toBeNull();
    expect(first.headers['x-poll-after']).toBe('30');
    expect(first.headers['cache-control']).toBe('private, max-age=30');
    expect(dataSource.query).toHaveBeenCalledWith(
      'DELETE FROM public_live_rate_limits WHERE minute < $1',
      [expect.any(Number)],
    );
    const unchanged = await request(server)
      .get(`/api/v1/festivals/${pack.id}/live`)
      .set('X-Device-Id', device)
      .set('If-None-Match', first.headers.etag)
      .expect(304);
    expect(unchanged.text).toBe('');
    expect(unchanged.headers['x-poll-after']).toBe('30');
  });

  it('partitions personalized live responses by authorization', async () => {
    const device = '3f9a2c1d-2b77-4e7e-9a1b-2a0123456789';
    const token = app.get(JwtService).sign(
      {
        sub: 'a1234567-1234-4234-8234-123456789abc',
        provider: 'google',
        typ: 'access',
      },
      { secret: 'test-access-secret' },
    );
    const anonymous = await request(server)
      .get(`/api/v1/festivals/${pack.id}/live`)
      .set('X-Device-Id', device)
      .expect(200);
    const personalized = await request(server)
      .get(`/api/v1/festivals/${pack.id}/live`)
      .set('X-Device-Id', device)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(successData<{ me: unknown }>(personalized.body).me).toEqual({
      following: [],
      pinnedFlagId: null,
      crew: null,
      bearerOf: [],
    });
    expect(personalized.headers.etag).not.toBe(anonymous.headers.etag);
    expect(personalized.headers.vary).toContain('Authorization');
  });

  it('rejects missing device ID, invalid token, and per-device excess polls', async () => {
    const url = `/api/v1/festivals/${pack.id}/live`;
    const missingDevice = await request(server).get(url).expect(400);
    expect(errorData<null>(missingDevice.body, 'VALIDATION')).toBeNull();
    const device = '3f9a2c1d-2b77-4e7e-9a1b-2a0123456789';
    const invalidToken = await request(server)
      .get(url)
      .set('X-Device-Id', device)
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(errorData<null>(invalidToken.body, 'UNAUTHORIZED')).toBeNull();
    rateLimitCount = 5;
    const limited = await request(server)
      .get(url)
      .set('X-Device-Id', device)
      .expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBe(
      errorData<{ retryAfter: number }>(limited.body, 'RATE_LIMITED')
        .retryAfter,
    );
  });

  it('blocks new rate-limit rows when cleanup fails and retries after five minutes', async () => {
    const device = '3f9a2c1d-2b77-4e7e-9a1b-2a0123456789';
    const liveService = app.get(PublicLiveService);
    const baseMinute = Math.floor(Date.now() / 60_000) + 120;
    const at = (offset: number) => new Date((baseMinute + offset) * 60_000);
    dataSource.query.mockReset();
    dataSource.query.mockRejectedValueOnce(new Error('cleanup unavailable'));

    await expect(liveService['limit'](device, at(0))).rejects.toHaveProperty(
      'status',
      503,
    );
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    await expect(liveService['limit'](device, at(1))).rejects.toHaveProperty(
      'status',
      503,
    );
    expect(dataSource.query).toHaveBeenCalledTimes(1);

    dataSource.query.mockResolvedValue([{ count: 1 }]);
    await liveService['limit'](device, at(5));
    expect(dataSource.query).toHaveBeenCalledTimes(3);
    await liveService['limit'](device, at(6));
    expect(dataSource.query).toHaveBeenCalledTimes(4);
  });
});
