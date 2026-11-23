import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { Server } from 'http';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AdminFestival } from '../src/modules/admin/festival/festival.entity';
import { AdminAuditService } from '../src/modules/admin/audit/admin-audit.service';
import { User } from '../src/modules/auth/entity/user.entity';
import { Crew, CrewGather, CrewMember } from '../src/modules/crews/crew.entity';
import { DeviceAuthGuard } from '../src/modules/device/device-auth.guard';
import { DeviceService } from '../src/modules/device/device.service';
import {
  Flag,
  FlagBearer,
  FlagBearerCode,
  FlagClaimAttempt,
  FlagFollow,
  FlagPin,
  FlagReport,
} from '../src/modules/flags/flag.entity';
import { FlagClaimThrottleService } from '../src/modules/flags/flag-claim-throttle.service';
import { FlagPackSyncService } from '../src/modules/flags/flag-pack-sync.service';
import {
  FlagsController,
  MyFlagsController,
} from '../src/modules/flags/flags.controller';
import { FlagsService } from '../src/modules/flags/flags.service';
import { LiveActivityService } from '../src/modules/notification/live-activity.service';
import { SocialNotificationService } from '../src/modules/notification/social-notification.service';
import { PublicFestivalController } from '../src/modules/public/public-festival.controller';
import { PublicFestivalService } from '../src/modules/public/public-festival.service';
import { PublicLiveService } from '../src/modules/public/public-live.service';
import { CacheService } from '../src/modules/redis/service/cache.service';
import { ImageStorageService } from '../src/modules/storage/image-storage.service';

type Row = Record<string, unknown>;

/** where의 일반 값과 In · Not 연산자만 흉내 내는 공유 인메모리 저장소. */
class MemoryRepository {
  constructor(readonly rows: Row[] = []) {}
  private matches(row: Row, where: Row = {}) {
    return Object.entries(where).every(([field, expected]) => {
      const operator = expected as { _type?: string; _value?: unknown };
      if (operator?._type === 'in')
        return (operator._value as unknown[]).includes(row[field]);
      if (operator?._type === 'not') return row[field] !== operator._value;
      return row[field] === expected;
    });
  }
  find(options: { where?: Row } = {}) {
    return Promise.resolve(
      this.rows.filter((row) => this.matches(row, options.where)),
    );
  }
  findOne(options: { where: Row }) {
    return Promise.resolve(
      this.rows.find((row) => this.matches(row, options.where)) ?? null,
    );
  }
  exists(options: { where: Row }) {
    return Promise.resolve(
      this.rows.some((row) => this.matches(row, options.where)),
    );
  }
  update(where: Row, patch: Row) {
    for (const row of this.rows)
      if (this.matches(row, where)) Object.assign(row, patch);
    return Promise.resolve({ affected: 1 });
  }
}

describe('기수 모드 끄기 · 다시 켜기 흐름 (e2e)', () => {
  const userId = 'a1234567-1234-4234-8234-123456789abc';
  const device = '3f9a2c1d-2b77-4e7e-9a1b-2a0123456789';
  let app: INestApplication;
  let server: Server;
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
    flags: [{ id: 'flg_mine0001', name: '내 깃발', tags: ['slam'] }],
    packVersion: 7,
    packUpdatedAt: '2026-11-18T09:00:00+09:00',
  };
  const festivals = new MemoryRepository([
    { id: pack.id, published: pack, publishedVersion: 7 },
  ]);
  const flags = new MemoryRepository([
    {
      id: 'flg_mine0001',
      festivalId: pack.id,
      name: '내 깃발',
      visibility: 'public',
      thumbUrl: null,
      photoUrl: null,
      photoKey: null,
      thumbKey: null,
      tags: ['slam'],
      bio: null,
      followerCount: 1,
      planVisible: true,
      plan: [],
      homeZoneId: null,
      status: 'active',
      zoneId: 'zone_a',
      activity: 'slam',
      hidden: false,
      ownerPaused: false,
      ownerId: userId,
      statusUpdatedAt: new Date('2026-11-20T05:00:00.000Z'),
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      updatedAt: new Date('2026-11-20T05:00:00.000Z'),
    },
  ]);
  const users = new MemoryRepository([{ id: userId, bearerModeOff: false }]);
  // 팬은 내 깃발을 팔로우하고 대표로 지정했다.
  const fan = 'b1234567-1234-4234-8234-123456789abc';
  const follows = new MemoryRepository([
    { id: 'f1', userId: fan, flagId: 'flg_mine0001', festivalId: pack.id },
  ]);
  const pins = new MemoryRepository([{ userId: fan, flagId: 'flg_mine0001' }]);
  const bearers = new MemoryRepository([
    {
      id: 'b1',
      flagId: 'flg_mine0001',
      festivalId: pack.id,
      userId,
      isOwner: true,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    },
  ]);
  const empty = new MemoryRepository();
  const repositories = new Map<unknown, MemoryRepository>([
    [Flag, flags],
    [User, users],
    [AdminFestival, festivals],
    [FlagFollow, follows],
    [FlagPin, pins],
    [FlagBearer, bearers],
  ]);
  const query = jest.fn((sql: string, params?: unknown[]) => {
    if (sql.includes('INSERT INTO public_live_rate_limits'))
      return Promise.resolve([{ count: 1 }]);
    if (sql.includes('FROM "users"') && sql.includes('FOR UPDATE'))
      return Promise.resolve([{ id: params?.[0] }]);
    return Promise.resolve([]);
  });
  const manager = {
    query,
    getRepository: (entity: unknown) => repositories.get(entity) ?? empty,
  };
  const dataSource = {
    query,
    transaction: (
      first: string | ((value: typeof manager) => unknown),
      second?: (value: typeof manager) => unknown,
    ) => (typeof first === 'function' ? first : second!)(manager),
  };
  const packSync = {
    syncMany: jest.fn().mockResolvedValue([]),
    sync: jest.fn().mockResolvedValue([]),
    invalidatePacks: jest.fn().mockResolvedValue(undefined),
  };
  const liveActivity = {
    enqueueFestival: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [
        PublicFestivalController,
        FlagsController,
        MyFlagsController,
      ],
      providers: [
        PublicFestivalService,
        PublicLiveService,
        FlagsService,
        { provide: DeviceAuthGuard, useValue: { canActivate: () => true } },
        {
          provide: DeviceService,
          useValue: { listSubscriptions: jest.fn() },
        },
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
        { provide: getRepositoryToken(Flag), useValue: flags },
        { provide: getRepositoryToken(FlagFollow), useValue: follows },
        { provide: getRepositoryToken(FlagPin), useValue: pins },
        { provide: getRepositoryToken(FlagBearer), useValue: bearers },
        { provide: getRepositoryToken(FlagBearerCode), useValue: empty },
        { provide: getRepositoryToken(FlagClaimAttempt), useValue: empty },
        { provide: getRepositoryToken(FlagReport), useValue: empty },
        { provide: getRepositoryToken(AdminFestival), useValue: festivals },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Crew), useValue: empty },
        { provide: getRepositoryToken(CrewMember), useValue: empty },
        { provide: getRepositoryToken(CrewGather), useValue: empty },
        { provide: FlagClaimThrottleService, useValue: {} },
        { provide: ImageStorageService, useValue: {} },
        { provide: FlagPackSyncService, useValue: packSync },
        { provide: AdminAuditService, useValue: {} },
        { provide: SocialNotificationService, useValue: {} },
        { provide: LiveActivityService, useValue: liveActivity },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // 인증 가드 대신 X-Test-User 헤더로 요청 사용자를 정한다.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const id = req.headers['x-test-user'];
      if (typeof id === 'string')
        (req as Request & { user: unknown }).user = {
          userId: id,
          provider: 'google',
        };
      next();
    });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  const data = <T>(body: unknown) => (body as { data: T }).data;
  const listed = async () =>
    data<{ items: { id: string }[] }>(
      (
        await request(server)
          .get(`/api/v1/festivals/${pack.id}/flags`)
          .expect(200)
      ).body,
    ).items.map((item) => item.id);
  const live = async () =>
    data<{ activeFlags: { flagId: string }[] }>(
      (
        await request(server)
          .get(`/api/v1/festivals/${pack.id}/live`)
          .set('X-Device-Id', device)
          .expect(200)
      ).body,
    ).activeFlags.map((item) => item.flagId);
  const setMode = (enabled: boolean) =>
    request(server)
      .put('/api/v1/me/bearer-mode')
      .set('X-Test-User', userId)
      .send({ enabled })
      .expect(200);
  const hiddenStatus = {
    flagId: 'flg_mine0001',
    status: 'scheduled',
    zoneId: null,
    activity: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  const liveStatus = {
    flagId: 'flg_mine0001',
    status: 'active',
    zoneId: 'zone_a',
    activity: 'slam',
    updatedAt: '2026-11-20T05:00:00.000Z',
  };

  it('끄면 목록·라이브에서 빠지고 상세·대표는 열리되 상태를 가리며, 다시 켜면 돌아온다', async () => {
    expect(await listed()).toEqual(['flg_mine0001']);
    expect(await live()).toEqual(['flg_mine0001']);

    expect(data((await setMode(false)).body)).toEqual({ bearerMode: false });
    expect(flags.rows[0]).toMatchObject({ ownerPaused: true, hidden: false });
    expect(await listed()).toEqual([]);
    expect(await live()).toEqual([]);

    const detail = await request(server)
      .get('/api/v1/flags/flg_mine0001')
      .expect(200);
    expect(data(detail.body)).toMatchObject({
      name: '내 깃발',
      followerCount: 1,
      status: hiddenStatus,
    });
    const pinned = await request(server)
      .get('/api/v1/me/pinned-flag')
      .set('X-Test-User', fan)
      .expect(200);
    expect(data(pinned.body)).toMatchObject({
      pinnedFlagId: 'flg_mine0001',
      flag: { status: hiddenStatus, isBearer: false },
    });
    // 기수 본인 시점에서는 가리지 않는다.
    const token = app
      .get(JwtService)
      .sign(
        { sub: userId, provider: 'google', typ: 'access' },
        { secret: 'test-access-secret' },
      );
    const mine = await request(server)
      .get('/api/v1/flags/flg_mine0001')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(data(mine.body)).toMatchObject({
      isBearer: true,
      status: liveStatus,
    });
    const bearerList = await request(server)
      .get('/api/v1/me/bearer-flags')
      .set('X-Test-User', userId)
      .expect(200);
    expect(data(bearerList.body)).toMatchObject({
      items: [{ ownerPaused: true, status: liveStatus }],
    });

    expect(data((await setMode(true)).body)).toEqual({ bearerMode: true });
    expect(flags.rows[0]).toMatchObject({ ownerPaused: false });
    expect(await listed()).toEqual(['flg_mine0001']);
    expect(await live()).toEqual(['flg_mine0001']);
    const reopened = await request(server)
      .get('/api/v1/flags/flg_mine0001')
      .expect(200);
    expect(data(reopened.body)).toMatchObject({ status: liveStatus });
  });
});
