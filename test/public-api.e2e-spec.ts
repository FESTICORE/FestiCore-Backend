import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { Server } from 'http';
import { AdminFestival } from '../src/modules/admin/festival/festival.entity';
import { Crew, CrewGather, CrewMember } from '../src/modules/crews/crew.entity';
import {
  Flag,
  FlagBearer,
  FlagFollow,
  FlagPin,
} from '../src/modules/flags/flag.entity';
import { PublicFestivalController } from '../src/modules/public/public-festival.controller';
import { PublicFestivalService } from '../src/modules/public/public-festival.service';
import { PublicLiveService } from '../src/modules/public/public-live.service';

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
  const dataSource = { query: jest.fn().mockResolvedValue([{ count: 1 }]) };
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
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists published festivals and sends conditional list caching', async () => {
    const first = await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=20')
      .expect(200);
    const listBody = first.body as { items: unknown[] };
    expect(listBody.items).toEqual([
      expect.objectContaining({ id: pack.id, packVersion: 7 }),
    ]);
    expect(first.headers['cache-control']).toBe('public, max-age=3600');
    expect(first.headers.date).toBeDefined();
    await request(server)
      .get('/api/v1/festivals?after=2026-10-21&limit=20')
      .set('If-None-Match', first.headers.etag)
      .expect(304);
  });

  it('serves only the published pack with exact version ETag', async () => {
    const first = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack`)
      .expect(200);
    expect(first.body).toEqual(
      expect.objectContaining({
        id: pack.id,
        name: pack.name,
        days: pack.days,
        packVersion: 7,
      }),
    );
    expect(first.headers.etag).toBe('"v7"');
    const unchanged = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack`)
      .set('If-None-Match', '"v7"')
      .expect(304);
    expect(unchanged.text).toBe('');
    await request(server).get('/api/v1/festivals/fst_unknown/pack').expect(404);
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
          },
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
      'DIRECTION_SECRET',
      'flags/private-key.webp',
    ])
      expect(serialized).not.toContain(secret);
    expect(
      (
        response.body as {
          flags: { plan: string[]; thumbUrl: string | null }[];
        }
      ).flags[0],
    ).toEqual(expect.objectContaining({ plan: [], thumbUrl: null }));
    expect((response.body as { flags: unknown[] }).flags).toHaveLength(1);
  });

  it('returns version and filters flag tags with OR semantics', async () => {
    const version = await request(server)
      .get(`/api/v1/festivals/${pack.id}/pack/version`)
      .expect(200);
    expect(version.body).toEqual({
      packVersion: 7,
      packUpdatedAt: pack.packUpdatedAt,
      etag: '"v7"',
    });
    const flags = await request(server)
      .get(`/api/v1/festivals/${pack.id}/flags?tag=slam&tag=newbie`)
      .expect(200);
    const flagsBody = flags.body as { items: { id: string }[] };
    expect(flagsBody.items).toHaveLength(1);
    expect(flagsBody.items[0].id).toBe('flg_12345678');
    await request(server)
      .get(`/api/v1/festivals/${pack.id}/flags?tag=invalid`)
      .expect(400);
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
    const body = response.body as {
      items: { id: string; photoUrl: string; thumbUrl: string }[];
    };
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

  it('paginates by first day start time then ID without skipping a same-day festival', async () => {
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
    const body = first.body as { items: { id: string }[]; nextCursor: string };
    expect(body.items[0].id).toBe('fst_12345678');
    expect(body.nextCursor).toBe(
      '2026-10-21~2026-11-20T12:00:00+09:00~fst_12345678',
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
    expect((second.body as { items: { id: string }[] }).items[0].id).toBe(
      'fst_87654321',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('festival.id > :cursorId'),
      { cursorAt: '2026-11-20T12:00:00+09:00', cursorId: 'fst_12345678' },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      "(festival.published->'days'->0->>'startsAt')::timestamptz",
      'ASC',
    );
  });

  it('orders different ISO offsets by instant and preserves the original cursor', async () => {
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
    const body = first.body as { items: { id: string }[]; nextCursor: string };
    expect(body.items[0].id).toBe('fst_12345678');
    expect(body.nextCursor).toBe(
      '2026-10-21~2026-11-20T12:00:00+09:00~fst_12345678',
    );
    queryBuilder.getMany.mockResolvedValueOnce([later]);
    await request(server)
      .get(
        `/api/v1/festivals?after=${encodeURIComponent(body.nextCursor)}&limit=1`,
      )
      .expect(200);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('CAST(:cursorAt AS timestamptz)'),
      { cursorAt: '2026-11-20T12:00:00+09:00', cursorId: 'fst_12345678' },
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
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    expect(cursor).toMatch(/^2025-01-01~/);
    queryBuilder.andWhere.mockClear();
    queryBuilder.getMany.mockResolvedValueOnce([]);
    await request(server)
      .get(`/api/v1/festivals?after=${encodeURIComponent(cursor)}&limit=1`)
      .expect(200);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("->>'date' >= :floor"),
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
    await request(server).get(url).set('If-None-Match', '"v7"').expect(304);
  });

  it('serves anonymous live state and 304 without refreshing server time', async () => {
    dataSource.query.mockResolvedValue([{ count: 1 }]);
    const device = '3f9a2c1d-2b77-4e7e-9a1b-2a0123456789';
    const first = await request(server)
      .get(`/api/v1/festivals/${pack.id}/live`)
      .set('X-Device-Id', device)
      .expect(200);
    expect((first.body as { me: null }).me).toBeNull();
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
    dataSource.query.mockResolvedValue([{ count: 1 }]);
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
    expect((personalized.body as { me: unknown }).me).toEqual({
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
    await request(server).get(url).expect(400);
    const device = '3f9a2c1d-2b77-4e7e-9a1b-2a0123456789';
    await request(server)
      .get(url)
      .set('X-Device-Id', device)
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    dataSource.query.mockResolvedValueOnce([{ count: 5 }]);
    const limited = await request(server)
      .get(url)
      .set('X-Device-Id', device)
      .expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBe(
      (limited.body as { retryAfter: number }).retryAfter,
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
