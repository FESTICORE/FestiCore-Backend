import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { AdminAuditService } from '../admin/audit/admin-audit.service';
import { User } from '../auth/entity/user.entity';
import { ImageStorageService } from '../storage/image-storage.service';
import { FlagPackSyncService } from './flag-pack-sync.service';
import { SocialNotificationService } from '../notification/social-notification.service';
import { LiveActivityService } from '../notification/live-activity.service';
import {
  Flag,
  FlagBearer,
  FlagBearerCode,
  FlagClaimAttempt,
  FlagFollow,
  FlagIdempotency,
  FlagPin,
  FlagReport,
} from './flag.entity';
import { FlagClaimThrottleService } from './flag-claim-throttle.service';
import { FlagsService } from './flags.service';

type Row = Record<string, unknown>;

/** where 조건의 일반 값과 In() 연산자만 흉내 내는 인메모리 저장소. */
class MemoryRepository {
  rows: Row[] = [];
  constructor(private readonly key = 'id') {}
  private matches(row: Row, where: Row) {
    return Object.entries(where).every(([field, expected]) => {
      const operator = expected as { _type?: string; _value?: unknown[] };
      if (operator?._type === 'in')
        return (operator._value ?? []).includes(row[field]);
      return row[field] === expected;
    });
  }
  create(value: Row) {
    return { ...value };
  }
  save(value: Row) {
    value[this.key] ??= `${this.key}_${this.rows.length + 1}`;
    value.createdAt ??= new Date('2026-11-10T00:00:00.000Z');
    const index = this.rows.findIndex(
      (row) => row[this.key] === value[this.key],
    );
    if (index >= 0) this.rows[index] = value;
    else this.rows.push(value);
    return Promise.resolve(value);
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
  find(options: { where: Row; order?: Row }) {
    const rows = this.rows.filter((row) => this.matches(row, options.where));
    if (options.order?.createdAt === 'DESC')
      rows.sort(
        (a, b) =>
          (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
      );
    return Promise.resolve(rows);
  }
}

describe('FlagsService 내 대표 깃발·기수 깃발·코드 없는 기수 등록', () => {
  let flags: MemoryRepository;
  let follows: MemoryRepository;
  let pins: MemoryRepository;
  let bearers: MemoryRepository;
  let festivals: MemoryRepository;
  let idempotency: MemoryRepository;
  let codes: MemoryRepository;
  let sync: jest.Mock;
  let invalidatePacks: jest.Mock;
  let service: FlagsService;
  let activeUsers: Set<string>;

  const publishedPack = {
    zones: [{ id: 'zone_a' }],
    sets: [{ id: 'set_1' }],
  };
  const flagRow = (overrides: Row = {}): Row => ({
    id: 'flg_1',
    festivalId: 'fst_1',
    name: '푸른 깃발',
    visibility: 'public',
    thumbUrl: null,
    photoUrl: null,
    photoKey: null,
    thumbKey: null,
    tags: ['sing'],
    bio: null,
    followerCount: 3,
    planVisible: false,
    plan: ['set_1'],
    homeZoneId: 'zone_a',
    status: 'scheduled',
    zoneId: null,
    activity: null,
    hidden: false,
    statusUpdatedAt: null,
    createdAt: new Date('2026-11-10T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    flags = new MemoryRepository();
    follows = new MemoryRepository();
    pins = new MemoryRepository('userId');
    bearers = new MemoryRepository();
    festivals = new MemoryRepository();
    idempotency = new MemoryRepository();
    codes = new MemoryRepository('codeHash');
    activeUsers = new Set(['user-1', 'user-2']);
    festivals.rows.push(
      { id: 'fst_1', published: publishedPack, draft: null },
      { id: 'fst_2', published: publishedPack, draft: null },
      { id: 'fst_draft', published: null, draft: publishedPack },
    );
    sync = jest.fn().mockResolvedValue(['fst_1']);
    invalidatePacks = jest.fn().mockResolvedValue(undefined);
    const manager = {
      query: jest.fn((sql: string, params: string[]) =>
        Promise.resolve(
          sql.includes('FROM "users"') && !activeUsers.has(params[0])
            ? []
            : [{ id: params[0] }],
        ),
      ),
      getRepository: (entity: unknown) => {
        if (entity === Flag) return flags;
        if (entity === FlagBearer) return bearers;
        if (entity === FlagIdempotency) return idempotency;
        if (entity === AdminFestival) return festivals;
        throw new Error('Unexpected repository');
      },
    };
    const db = {
      transaction: (work: (value: typeof manager) => Promise<unknown>) =>
        work(manager),
    };
    service = new FlagsService(
      db as unknown as DataSource,
      { get: () => 'a-long-test-refresh-secret' } as unknown as ConfigService,
      flags as unknown as Repository<Flag>,
      follows as unknown as Repository<FlagFollow>,
      pins as unknown as Repository<FlagPin>,
      bearers as unknown as Repository<FlagBearer>,
      codes as unknown as Repository<FlagBearerCode>,
      {} as Repository<FlagClaimAttempt>,
      {} as FlagClaimThrottleService,
      {} as Repository<FlagReport>,
      festivals as unknown as Repository<AdminFestival>,
      {} as Repository<User>,
      {} as ImageStorageService,
      { sync, invalidatePacks } as unknown as FlagPackSyncService,
      {} as AdminAuditService,
      {} as SocialNotificationService,
      {} as LiveActivityService,
    );
  });

  describe('pinnedFlag', () => {
    it('대표 깃발을 공개 상세 필드와 festivalId로 돌려주고 비공개 계획은 가린다', async () => {
      flags.rows.push(flagRow());
      follows.rows.push({ id: 'f1', userId: 'user-1', flagId: 'flg_1' });
      pins.rows.push({ userId: 'user-1', flagId: 'flg_1' });
      await expect(service.pinnedFlag('user-1')).resolves.toEqual({
        pinnedFlagId: 'flg_1',
        flag: {
          id: 'flg_1',
          name: '푸른 깃발',
          thumbUrl: null,
          photoUrl: null,
          tags: ['sing'],
          bio: null,
          followerCount: 3,
          planVisible: false,
          plan: [],
          homeZoneId: 'zone_a',
          festivalId: 'fst_1',
          status: expect.objectContaining({
            flagId: 'flg_1',
            status: 'scheduled',
          }) as unknown,
          isFollowing: true,
          isBearer: false,
          isPinned: true,
          hidden: false,
        },
      });
    });

    it('대표 깃발이 없으면 200 응답용 null 값을 준다', async () => {
      await expect(service.pinnedFlag('user-1')).resolves.toEqual({
        pinnedFlagId: null,
        flag: null,
      });
      pins.rows.push({ userId: 'user-1', flagId: null });
      await expect(service.pinnedFlag('user-1')).resolves.toEqual({
        pinnedFlagId: null,
        flag: null,
      });
    });

    it('다른 사용자의 대표 깃발을 내 응답에 넣지 않는다', async () => {
      flags.rows.push(flagRow());
      follows.rows.push({ id: 'f1', userId: 'user-2', flagId: 'flg_1' });
      pins.rows.push({ userId: 'user-2', flagId: 'flg_1' });
      await expect(service.pinnedFlag('user-1')).resolves.toEqual({
        pinnedFlagId: null,
        flag: null,
      });
    });

    it('팔로우가 끊겼거나 숨김·미발행 깃발이면 대표로 보지 않는다', async () => {
      pins.rows.push({ userId: 'user-1', flagId: 'flg_1' });
      flags.rows.push(flagRow({ hidden: true }));
      await expect(service.pinnedFlag('user-1')).resolves.toMatchObject({
        flag: null,
      });
      follows.rows.push({ id: 'f1', userId: 'user-1', flagId: 'flg_1' });
      await expect(service.pinnedFlag('user-1')).resolves.toMatchObject({
        flag: null,
      });
      flags.rows[0] = flagRow({ festivalId: 'fst_draft' });
      await expect(service.pinnedFlag('user-1')).resolves.toMatchObject({
        flag: null,
      });
    });

    it('숨김 깃발이라도 내가 기수면 hidden=true로 보여 준다', async () => {
      flags.rows.push(flagRow({ hidden: true }));
      follows.rows.push({ id: 'f1', userId: 'user-1', flagId: 'flg_1' });
      pins.rows.push({ userId: 'user-1', flagId: 'flg_1' });
      bearers.rows.push({ id: 'b1', userId: 'user-1', flagId: 'flg_1' });
      await expect(service.pinnedFlag('user-1')).resolves.toMatchObject({
        pinnedFlagId: 'flg_1',
        flag: { isBearer: true, hidden: true },
      });
    });
  });

  describe('myBearerFlags', () => {
    it('내 기수 깃발만 최근순으로, 발행 축제만 돌려주고 기수 시점 계획을 포함한다', async () => {
      flags.rows.push(
        flagRow(),
        flagRow({ id: 'flg_2', festivalId: 'fst_2', name: '두 번째' }),
        flagRow({ id: 'flg_3', festivalId: 'fst_draft' }),
        flagRow({ id: 'flg_other', name: '남의 깃발' }),
      );
      bearers.rows.push(
        {
          id: 'b1',
          userId: 'user-1',
          flagId: 'flg_1',
          festivalId: 'fst_1',
          isOwner: true,
          createdAt: new Date('2026-11-01T00:00:00.000Z'),
        },
        {
          id: 'b2',
          userId: 'user-1',
          flagId: 'flg_2',
          festivalId: 'fst_2',
          isOwner: false,
          createdAt: new Date('2026-11-02T00:00:00.000Z'),
        },
        {
          id: 'b3',
          userId: 'user-1',
          flagId: 'flg_3',
          festivalId: 'fst_draft',
          isOwner: true,
          createdAt: new Date('2026-11-03T00:00:00.000Z'),
        },
        {
          id: 'b4',
          userId: 'user-2',
          flagId: 'flg_other',
          festivalId: 'fst_1',
          isOwner: true,
          createdAt: new Date('2026-11-04T00:00:00.000Z'),
        },
      );
      const result = await service.myBearerFlags('user-1');
      expect(result.items.map((item) => item.flagId)).toEqual([
        'flg_2',
        'flg_1',
      ]);
      expect(result.items[1]).toMatchObject({
        festivalId: 'fst_1',
        isOwner: true,
        joinedAt: '2026-11-01T00:00:00.000Z',
        flag: { id: 'flg_1', plan: ['set_1'], planVisible: false },
        status: { flagId: 'flg_1', status: 'scheduled' },
        hidden: false,
      });
      await expect(
        service.myBearerFlags('user-1', 'fst_1'),
      ).resolves.toMatchObject({ items: [{ flagId: 'flg_1' }] });
      await expect(service.myBearerFlags('nobody')).resolves.toEqual({
        items: [],
      });
    });
  });

  describe('register', () => {
    const body = {
      festivalId: 'fst_1',
      name: '새 깃발',
      bio: '함께해요',
      tags: ['sing', 'newbie'],
      homeZoneId: 'zone_a',
      plan: ['set_1'],
    };

    it('코드 없이 깃발을 만들고 원래 기수로 등록하며 코드 레코드는 만들지 않는다', async () => {
      const result = await service.register('user-1', 'key-1', body);
      expect(result).toMatchObject({
        isNew: true,
        coBearers: ['user-1'],
        flag: {
          name: '새 깃발',
          bio: '함께해요',
          tags: ['sing', 'newbie'],
          homeZoneId: 'zone_a',
          plan: ['set_1'],
          followerCount: 0,
        },
      });
      expect(result.flagId).toMatch(/^flg_[0-9a-f]{10}$/);
      expect(flags.rows[0]).toMatchObject({
        id: result.flagId,
        festivalId: 'fst_1',
        ownerId: 'user-1',
        visibility: 'public',
        status: 'scheduled',
        hidden: false,
      });
      expect(bearers.rows).toEqual([
        expect.objectContaining({
          flagId: result.flagId,
          festivalId: 'fst_1',
          userId: 'user-1',
          isOwner: true,
        }),
      ]);
      expect(codes.rows).toHaveLength(0);
      expect(sync).toHaveBeenCalledWith(result.flagId, expect.anything());
      expect(invalidatePacks).toHaveBeenCalledWith(['fst_1']);
    });

    it('태그를 생략하면 claim과 같은 기본 태그를 쓴다', async () => {
      const result = await service.register('user-1', 'key-1', {
        festivalId: 'fst_1',
        name: '기본 태그',
      });
      expect(result).toMatchObject({ flag: { tags: ['newbie'], plan: [] } });
    });

    it('같은 멱등키의 같은 요청은 저장된 응답을 재생하고 다른 요청은 409다', async () => {
      const first = await service.register('user-1', 'key-1', body);
      await expect(service.register('user-1', 'key-1', body)).resolves.toEqual(
        first,
      );
      expect(flags.rows).toHaveLength(1);
      await expect(
        service.register('user-1', 'key-1', { ...body, name: '다른 이름' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'IDEMPOTENCY_CONFLICT' },
      });
    });

    it('이 축제에서 이미 기수면 409 BEARER_LIMIT이고 다른 축제는 허용한다', async () => {
      bearers.rows.push({
        id: 'b1',
        userId: 'user-1',
        flagId: 'flg_old',
        festivalId: 'fst_1',
        isOwner: false,
      });
      await expect(
        service.register('user-1', 'key-1', body),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'BEARER_LIMIT' },
      });
      expect(flags.rows).toHaveLength(0);
      await expect(
        service.register('user-1', 'key-2', {
          ...body,
          festivalId: 'fst_2',
        }),
      ).resolves.toMatchObject({ isNew: true });
    });

    it('같은 축제에 같은 이름이 있으면 409 FLAG_NAME_TAKEN이다', async () => {
      flags.rows.push(flagRow({ name: '새 깃발' }));
      await expect(
        service.register('user-2', 'key-1', body),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'FLAG_NAME_TAKEN' },
      });
    });

    it('미발행·없는 축제는 404다', async () => {
      for (const festivalId of ['fst_draft', 'missing'])
        await expect(
          service.register('user-1', 'key-1', { ...body, festivalId }),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: 'NOT_FOUND' },
        });
      expect(flags.rows).toHaveLength(0);
    });

    it('기존 깃발 이름·프로필 규칙과 발행 팩 참조를 검증한다', async () => {
      const invalid: unknown[] = [
        null,
        { name: '이름만' },
        { festivalId: 'fst_1' },
        { festivalId: 'fst_1', name: '한' },
        { festivalId: 'fst_1', name: '가'.repeat(21) },
        { festivalId: 'fst_1', name: '소개', bio: '가'.repeat(61) },
        { festivalId: 'fst_1', name: '태그', tags: ['unknown'] },
        { festivalId: 'fst_1', name: '태그', tags: [] },
        { festivalId: 'fst_1', name: '사진', photoUrl: 'https://x.test/a' },
        { festivalId: 'fst_1', name: '계획', plan: ['set_missing'] },
      ];
      for (const input of invalid)
        await expect(
          service.register('user-1', 'key-1', input),
        ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.register('user-1', 'key-1', {
          festivalId: 'fst_1',
          name: '존 없음',
          homeZoneId: 'zone_missing',
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'ZONE_NOT_FOUND' },
      });
      expect(flags.rows).toHaveLength(0);
    });

    it('동시 요청이 고유 인덱스에 막히면 기존 409 코드로 바꾼다', async () => {
      const save = jest.spyOn(bearers, 'save').mockRejectedValueOnce(
        Object.assign(new Error('duplicate'), {
          code: '23505',
          constraint: 'IDX_flag_bearers_user_festival',
        }),
      );
      await expect(
        service.register('user-1', 'key-1', body),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'BEARER_LIMIT' },
      });
      save.mockRestore();
    });

    it('탈퇴 중인 사용자는 401이다', async () => {
      activeUsers.delete('user-1');
      await expect(
        service.register('user-1', 'key-1', body),
      ).rejects.toMatchObject({ status: 401 });
    });
  });
});
