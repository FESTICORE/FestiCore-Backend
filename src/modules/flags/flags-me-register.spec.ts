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
  update(where: Row, patch: Row) {
    for (const row of this.rows)
      if (this.matches(row, where)) Object.assign(row, patch);
    return Promise.resolve({ affected: 1 });
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
  let users: MemoryRepository;
  let sync: jest.Mock;
  let syncMany: jest.Mock;
  let enqueueFestival: jest.Mock;
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
    ownerPaused: false,
    ownerId: null,
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
    users = new MemoryRepository();
    users.rows.push(
      { id: 'user-1', bearerModeOff: false },
      { id: 'user-2', bearerModeOff: false },
    );
    activeUsers = new Set(['user-1', 'user-2']);
    festivals.rows.push(
      { id: 'fst_1', published: publishedPack, draft: null },
      { id: 'fst_2', published: publishedPack, draft: null },
      { id: 'fst_draft', published: null, draft: publishedPack },
    );
    sync = jest.fn().mockResolvedValue(['fst_1']);
    invalidatePacks = jest.fn().mockResolvedValue(undefined);
    syncMany = jest.fn().mockResolvedValue(['fst_2']);
    enqueueFestival = jest.fn().mockResolvedValue(undefined);
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
        if (entity === User) return users;
        if (entity === FlagFollow) return follows;
        if (entity === FlagBearerCode) return codes;
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
      { sync, syncMany, invalidatePacks } as unknown as FlagPackSyncService,
      {} as AdminAuditService,
      {} as SocialNotificationService,
      { enqueueFestival } as unknown as LiveActivityService,
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

    it('소유자가 기수 모드를 끈 깃발은 상세·대표의 현장 상태를 가리고 기수 본인에게는 보여 준다', async () => {
      flags.rows.push(
        flagRow({
          ownerPaused: true,
          status: 'active',
          zoneId: 'zone_a',
          activity: 'slam',
          statusUpdatedAt: new Date('2026-11-20T05:00:00.000Z'),
        }),
      );
      follows.rows.push({ id: 'f1', userId: 'user-1', flagId: 'flg_1' });
      pins.rows.push({ userId: 'user-1', flagId: 'flg_1' });
      const hidden = {
        flagId: 'flg_1',
        status: 'scheduled',
        zoneId: null,
        activity: null,
        updatedAt: '2026-11-10T00:00:00.000Z',
      };
      await expect(service.pinnedFlag('user-1')).resolves.toMatchObject({
        flag: { name: '푸른 깃발', status: hidden },
      });
      await expect(service.detail('flg_1')).resolves.toMatchObject({
        name: '푸른 깃발',
        status: hidden,
      });
      bearers.rows.push({ id: 'b1', userId: 'user-1', flagId: 'flg_1' });
      const live = { status: 'active', zoneId: 'zone_a', activity: 'slam' };
      await expect(service.detail('flg_1', 'user-1')).resolves.toMatchObject({
        status: live,
      });
      await expect(service.pinnedFlag('user-1')).resolves.toMatchObject({
        flag: { status: live },
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
        ownerPaused: false,
      });
      await expect(
        service.myBearerFlags('user-1', 'fst_1'),
      ).resolves.toMatchObject({ items: [{ flagId: 'flg_1' }] });
      await expect(service.myBearerFlags('nobody')).resolves.toEqual({
        items: [],
      });
    });
  });

  describe('setBearerMode', () => {
    beforeEach(() => {
      flags.rows.push(
        flagRow({ ownerId: 'user-1' }),
        flagRow({
          id: 'flg_2',
          festivalId: 'fst_2',
          ownerId: 'user-1',
          hidden: true,
        }),
        flagRow({ id: 'flg_co', ownerId: 'user-2' }),
      );
    });

    it('끄면 내 소유 깃발만 ownerPaused로 바꾸고 축제마다 라이브·팩을 갱신한다', async () => {
      await expect(service.setBearerMode('user-1', false)).resolves.toEqual({
        bearerMode: false,
      });
      expect(users.rows[0]).toMatchObject({ bearerModeOff: true });
      expect(
        flags.rows.map((row) => [row.id, row.ownerPaused, row.hidden]),
      ).toEqual([
        ['flg_1', true, false],
        ['flg_2', true, true],
        ['flg_co', false, false],
      ]);
      expect(enqueueFestival).toHaveBeenNthCalledWith(
        1,
        'fst_1',
        expect.anything(),
      );
      expect(enqueueFestival).toHaveBeenNthCalledWith(
        2,
        'fst_2',
        expect.anything(),
      );
      expect(syncMany).toHaveBeenCalledWith(
        ['flg_1', 'flg_2'],
        expect.anything(),
      );
      expect(invalidatePacks).toHaveBeenCalledWith(['fst_2']);
    });

    it('다시 켜면 ownerPaused만 풀고 관리자 숨김은 그대로 둔다', async () => {
      await service.setBearerMode('user-1', false);
      syncMany.mockClear();
      await expect(service.setBearerMode('user-1', true)).resolves.toEqual({
        bearerMode: true,
      });
      expect(users.rows[0]).toMatchObject({ bearerModeOff: false });
      expect(
        flags.rows.map((row) => [row.id, row.ownerPaused, row.hidden]),
      ).toEqual([
        ['flg_1', false, false],
        ['flg_2', false, true],
        ['flg_co', false, false],
      ]);
      expect(syncMany).toHaveBeenCalledWith(
        ['flg_1', 'flg_2'],
        expect.anything(),
      );
    });

    it('바뀐 깃발이 없으면 팩·라이브를 갱신하지 않는다', async () => {
      await expect(service.setBearerMode('user-1', true)).resolves.toEqual({
        bearerMode: true,
      });
      expect(syncMany).not.toHaveBeenCalled();
      expect(enqueueFestival).not.toHaveBeenCalled();
      expect(invalidatePacks).not.toHaveBeenCalled();
    });

    it('탈퇴 중인 사용자는 401이다', async () => {
      activeUsers.delete('user-1');
      await expect(
        service.setBearerMode('user-1', false),
      ).rejects.toMatchObject({ status: 401 });
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

    it('등록하면 기수 모드를 켜고 꺼 둔 내 다른 깃발도 다시 보이게 한다', async () => {
      users.rows[0].bearerModeOff = true;
      flags.rows.push(
        flagRow({
          id: 'flg_old',
          festivalId: 'fst_2',
          name: '예전 깃발',
          ownerId: 'user-1',
          ownerPaused: true,
        }),
      );
      const result = await service.register('user-1', 'key-1', body);
      expect(users.rows[0]).toMatchObject({ bearerModeOff: false });
      expect(flags.rows.find((row) => row.id === 'flg_old')).toMatchObject({
        ownerPaused: false,
      });
      expect(enqueueFestival).toHaveBeenCalledWith('fst_2', expect.anything());
      expect(syncMany).toHaveBeenCalledWith(['flg_old'], expect.anything());
      expect(sync).toHaveBeenCalledWith(result.flagId, expect.anything());
      expect(invalidatePacks).toHaveBeenCalledWith(['fst_2', 'fst_1']);
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
  describe('transferFestival', () => {
    const body = { fromFestivalId: 'fst_1', toFestivalId: 'fst_2' };
    beforeEach(() => {
      flags.rows.push(
        flagRow({
          ownerId: 'user-1',
          status: 'active',
          zoneId: 'zone_a',
          activity: 'sing',
          statusUpdatedAt: new Date('2026-11-20T00:00:00.000Z'),
          statusUpdatedBy: 'user-1',
          statusClientAt: new Date('2026-11-20T00:00:00.000Z'),
        }),
      );
      bearers.rows.push({
        id: 'b1',
        flagId: 'flg_1',
        festivalId: 'fst_1',
        userId: 'user-1',
        isOwner: true,
      });
      follows.rows.push({
        id: 'f1',
        userId: 'user-2',
        flagId: 'flg_1',
        festivalId: 'fst_1',
      });
      codes.rows.push(
        { codeHash: 'c1', flagId: 'flg_1', festivalId: 'fst_1', usedBy: null },
        {
          codeHash: 'c2',
          flagId: 'flg_1',
          festivalId: 'fst_1',
          usedBy: 'user-9',
        },
      );
    });

    it('같은 flagId로 축제를 옮기고 기수·팔로우·미사용 코드 축제를 함께 바꾸며 계획·존·현장 상태를 초기화한다', async () => {
      const result = await service.transferFestival(
        'flg_1',
        'user-1',
        'key-1',
        body,
      );
      expect(result).toEqual({
        flagId: 'flg_1',
        previousFestivalId: 'fst_1',
        festivalId: 'fst_2',
        flag: expect.objectContaining({
          id: 'flg_1',
          name: '푸른 깃발',
          plan: [],
          homeZoneId: null,
          followerCount: 3,
        }) as unknown,
      });
      expect(flags.rows[0]).toMatchObject({
        festivalId: 'fst_2',
        plan: [],
        homeZoneId: null,
        status: 'scheduled',
        zoneId: null,
        activity: null,
        statusUpdatedAt: null,
        statusUpdatedBy: null,
        statusClientAt: null,
      });
      expect(bearers.rows[0].festivalId).toBe('fst_2');
      expect(follows.rows[0].festivalId).toBe('fst_2');
      expect(codes.rows.map((row) => row.festivalId)).toEqual([
        'fst_2',
        'fst_1',
      ]);
      expect(sync).toHaveBeenCalledWith('flg_1', expect.anything(), 'fst_1');
      expect(enqueueFestival).toHaveBeenCalledWith('fst_1', expect.anything());
      expect(enqueueFestival).toHaveBeenCalledWith('fst_2', expect.anything());
      expect(invalidatePacks).toHaveBeenCalledWith(['fst_1']);
    });

    it('같은 멱등키의 같은 요청은 저장된 응답을 재생하고 다른 요청은 409다', async () => {
      const first = await service.transferFestival(
        'flg_1',
        'user-1',
        'key-1',
        body,
      );
      await expect(
        service.transferFestival('flg_1', 'user-1', 'key-1', body),
      ).resolves.toEqual(first);
      await expect(
        service.transferFestival('flg_1', 'user-1', 'key-1', {
          fromFestivalId: 'fst_2',
          toFestivalId: 'fst_1',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'IDEMPOTENCY_CONFLICT' },
      });
    });

    it('본문 검증: 필드 누락·추가 필드·같은 축제는 400 VALIDATION이다', async () => {
      for (const input of [
        null,
        { toFestivalId: 'fst_2' },
        { fromFestivalId: 'fst_1' },
        { ...body, name: 'x' },
        { fromFestivalId: 'fst_1', toFestivalId: 'fst_1' },
      ])
        await expect(
          service.transferFestival('flg_1', 'user-1', 'key-1', input),
        ).rejects.toMatchObject({
          status: 400,
          response: { code: 'VALIDATION' },
        });
    });

    it('기수가 아니면 403 FLAG_NOT_BEARER, 공동 기수면 403 FLAG_NOT_OWNER다', async () => {
      await expect(
        service.transferFestival('flg_1', 'user-2', 'key-1', body),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'FLAG_NOT_BEARER' },
      });
      bearers.rows.push({
        id: 'b2',
        flagId: 'flg_1',
        festivalId: 'fst_1',
        userId: 'user-2',
        isOwner: false,
      });
      await expect(
        service.transferFestival('flg_1', 'user-2', 'key-1', body),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'FLAG_NOT_OWNER' },
      });
    });

    it('공동 기수가 있으면 409 FLAG_HAS_CO_BEARERS이고 아무것도 바꾸지 않는다', async () => {
      bearers.rows.push({
        id: 'b2',
        flagId: 'flg_1',
        festivalId: 'fst_1',
        userId: 'user-2',
        isOwner: false,
      });
      await expect(
        service.transferFestival('flg_1', 'user-1', 'key-1', body),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'FLAG_HAS_CO_BEARERS' },
      });
      expect(flags.rows[0].festivalId).toBe('fst_1');
    });

    it('원본 축제가 현재 축제와 다르면 409 FESTIVAL_MISMATCH다', async () => {
      await expect(
        service.transferFestival('flg_1', 'user-1', 'key-1', {
          fromFestivalId: 'fst_9',
          toFestivalId: 'fst_2',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'FESTIVAL_MISMATCH' },
      });
    });

    it('대상 축제가 미발행·없으면 404 NOT_FOUND다', async () => {
      for (const toFestivalId of ['fst_draft', 'fst_none'])
        await expect(
          service.transferFestival('flg_1', 'user-1', 'key-1', {
            fromFestivalId: 'fst_1',
            toFestivalId,
          }),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: 'NOT_FOUND' },
        });
    });

    it('대상 축제에서 이미 기수면 BEARER_LIMIT, 같은 이름이 있으면 FLAG_NAME_TAKEN, 기수 모드 꺼짐이면 BEARER_MODE_OFF(모두 409)다', async () => {
      bearers.rows.push({
        id: 'b3',
        flagId: 'flg_other',
        festivalId: 'fst_2',
        userId: 'user-1',
        isOwner: true,
      });
      await expect(
        service.transferFestival('flg_1', 'user-1', 'key-1', body),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'BEARER_LIMIT' },
      });
      bearers.rows.pop();
      flags.rows.push(
        flagRow({ id: 'flg_2', festivalId: 'fst_2', name: '푸른 깃발' }),
      );
      await expect(
        service.transferFestival('flg_1', 'user-1', 'key-1', body),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'FLAG_NAME_TAKEN' },
      });
      flags.rows.pop();
      flags.rows[0].ownerPaused = true;
      await expect(
        service.transferFestival('flg_1', 'user-1', 'key-1', body),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'BEARER_MODE_OFF' },
      });
    });

    it('동시 요청이 고유 인덱스에 막히면 기존 409 코드로 바꾼다', async () => {
      const update = jest.spyOn(flags, 'update').mockRejectedValueOnce(
        Object.assign(new Error('duplicate'), {
          code: '23505',
          constraint: 'IDX_flags_festival_name',
        }),
      );
      await expect(
        service.transferFestival('flg_1', 'user-1', 'key-1', body),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'FLAG_NAME_TAKEN' },
      });
      update.mockRestore();
    });
  });
});
