import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { AdminAuditService } from '../admin/audit/admin-audit.service';
import { User } from '../auth/entity/user.entity';
import { ImageStorageService } from '../storage/image-storage.service';
import { FlagPackSyncService } from './flag-pack-sync.service';
import {
  Flag,
  FlagBearer,
  FlagBearerCode,
  FlagClaimAttempt,
  FlagFollow,
  FlagPin,
  FlagReport,
} from './flag.entity';
import { FlagClaimThrottleService } from './flag-claim-throttle.service';
import { FlagsService } from './flags.service';

describe('FlagsService security boundaries', () => {
  const flag = {
    id: 'flg_1',
    festivalId: 'fest_1',
    name: '기본 깃발',
    ownerId: 'owner',
    visibility: 'public',
    photoKey: null,
    thumbKey: null,
    tags: ['newbie'],
    plan: [],
    planVisible: true,
    hidden: false,
  } as unknown as Flag;
  const flags = {
    findOne: jest.fn().mockResolvedValue(flag),
    find: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const festivals = {
    findOne: jest
      .fn()
      .mockResolvedValue({ published: { zones: [], sets: [] } }),
    exists: jest.fn().mockResolvedValue(true),
  };
  const bearers = {
    findOne: jest.fn().mockResolvedValue({ userId: 'owner' }),
    find: jest.fn(),
    count: jest.fn().mockResolvedValue(1),
  };
  const savedCodes: FlagBearerCode[] = [];
  const codes = {
    create: (value: FlagBearerCode) => value,
    save: jest.fn((value: FlagBearerCode) => {
      savedCodes.push(value);
      return Promise.resolve(value);
    }),
    find: jest.fn().mockImplementation(() => Promise.resolve(savedCodes)),
  };
  const users = { find: jest.fn() };
  const transactionalFlags = {
    findOne: jest.fn().mockResolvedValue(flag),
    save: jest.fn().mockImplementation((value: Flag) => Promise.resolve(value)),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === FlagBearerCode) return codes;
      if (entity === Flag) return transactionalFlags;
      throw new Error('Unexpected repository');
    }),
  };
  const db = {
    transaction: jest.fn((work: (value: typeof manager) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const sync = jest.fn().mockResolvedValue(['fest_1']);
  const invalidatePacks = jest.fn().mockResolvedValue(undefined);
  const service = new FlagsService(
    db as unknown as DataSource,
    { get: () => 'a-long-test-refresh-secret' } as unknown as ConfigService,
    flags as unknown as Repository<Flag>,
    {} as Repository<FlagFollow>,
    {} as Repository<FlagPin>,
    bearers as unknown as Repository<FlagBearer>,
    codes as unknown as Repository<FlagBearerCode>,
    {} as Repository<FlagClaimAttempt>,
    {} as FlagClaimThrottleService,
    {} as Repository<FlagReport>,
    festivals as unknown as Repository<AdminFestival>,
    users as unknown as Repository<User>,
    {} as ImageStorageService,
    { sync, invalidatePacks } as unknown as FlagPackSyncService,
    audit as unknown as AdminAuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    savedCodes.length = 0;
    flag.hidden = false;
    audit.record.mockResolvedValue(undefined);
    festivals.findOne.mockResolvedValue({ published: { zones: [], sets: [] } });
  });

  it('encrypts generated codes at rest and returns retrievable codes to admin', async () => {
    const created = await service.createCodes(
      'fest_1',
      { count: 1 },
      'admin-1',
    );
    const plaintext = created.codes[0].code;
    expect(savedCodes[0].codeCiphertext).not.toContain(plaintext);
    expect(savedCodes[0].codeHash).not.toBe(plaintext);
    expect(savedCodes[0].codeHash).not.toBe(
      createHash('sha256').update(plaintext).digest('hex'),
    );
    expect((await service.listCodes('fest_1')).items[0].code).toBe(plaintext);
    expect((await service.listCodes('fest_1')).items[0]).not.toHaveProperty(
      'codeHash',
    );
    expect(audit.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actor: 'admin-1',
        action: 'flag.bearer-codes.created',
        target: 'festival:fest_1',
        after: {
          count: 1,
          label: null,
          expiresAt: created.codes[0].expiresAt,
        },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(plaintext);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      savedCodes[0].codeCiphertext,
    );
  });

  it('returns only bearer fields and flag status from the requested festival', async () => {
    const joinedAt = new Date('2026-10-21T00:00:00.000Z');
    bearers.find.mockResolvedValueOnce([
      {
        id: 'b_1',
        festivalId: 'fest_1',
        flagId: 'flg_1',
        userId: 'user_1',
        isOwner: true,
        createdAt: joinedAt,
      },
      {
        id: 'b_2',
        festivalId: 'fest_1',
        flagId: 'other_festival_flag',
        userId: 'user_2',
        isOwner: false,
        createdAt: joinedAt,
      },
    ]);
    flags.find.mockResolvedValueOnce([
      { ...flag, status: 'active', hidden: false },
    ]);
    users.find.mockResolvedValueOnce([
      {
        id: 'user_1',
        nickname: '기수',
        email: 'secret@example.com',
        oauthRefreshToken: 'secret',
      },
      { id: 'user_2', nickname: '다른 축제 기수' },
    ]);

    await expect(service.adminBearers('fest_1')).resolves.toEqual({
      items: [
        {
          userId: 'user_1',
          nickname: '기수',
          flagId: 'flg_1',
          flagName: '기본 깃발',
          isOwner: true,
          joinedAt: '2026-10-21T00:00:00.000Z',
          hidden: false,
          status: 'active',
        },
      ],
    });
    expect(bearers.find).toHaveBeenCalledWith({
      where: { festivalId: 'fest_1' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const flagCalls = flags.find.mock.calls as unknown as Array<
      [{ where: { festivalId: string } }]
    >;
    const flagQuery = flagCalls[0][0];
    expect(flagQuery.where.festivalId).toBe('fest_1');
    expect(users.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, nickname: true },
      }),
    );
  });

  it('returns an empty list for a festival without bearers and 404 for a missing festival', async () => {
    bearers.find.mockResolvedValueOnce([]);
    await expect(service.adminBearers('fest_1')).resolves.toEqual({
      items: [],
    });
    expect(flags.find).not.toHaveBeenCalled();
    festivals.exists.mockResolvedValueOnce(false);
    await expect(service.adminBearers('missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('does not return generated codes if audit recording fails', async () => {
    audit.record.mockRejectedValueOnce(new Error('audit failed'));
    await expect(
      service.createCodes('fest_1', { count: 1 }, 'admin-1'),
    ).rejects.toThrow('audit failed');
  });

  it('records flag visibility changes before refreshing the pack', async () => {
    await expect(service.setHidden('flg_1', true, 'admin-1')).resolves.toEqual({
      flagId: 'flg_1',
      hidden: true,
    });
    expect(transactionalFlags.save).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: true }),
    );
    expect(audit.record).toHaveBeenCalledWith(manager, {
      actor: 'admin-1',
      action: 'flag.hidden',
      target: 'flag:flg_1',
      before: { hidden: false },
      after: { hidden: true },
    });
    expect(sync).toHaveBeenCalledWith('flg_1', manager);
    expect(invalidatePacks).toHaveBeenCalledWith(['fest_1']);
  });

  it('does not refresh the pack when the visibility audit fails', async () => {
    audit.record.mockRejectedValueOnce(new Error('audit failed'));
    await expect(service.setHidden('flg_1', true, 'admin-1')).rejects.toThrow(
      'audit failed',
    );
    expect(sync).not.toHaveBeenCalled();
    expect(invalidatePacks).not.toHaveBeenCalled();
  });

  it('propagates pack refresh failure from the visibility transaction', async () => {
    sync.mockRejectedValueOnce(new Error('pack failed'));
    await expect(service.setHidden('flg_1', true, 'admin-1')).rejects.toThrow(
      'pack failed',
    );
    expect(audit.record).toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalled();
    expect(invalidatePacks).not.toHaveBeenCalled();
  });

  it('rejects an invitation by a co-bearer', async () => {
    await expect(service.invite('flg_1', 'co-bearer')).rejects.toMatchObject({
      status: 403,
    });
    expect(codes.save).not.toHaveBeenCalled();
  });

  it('updates only requested profile fields and refreshes the pack', async () => {
    await service.patch('flg_1', 'owner', { bio: '새 소개' });
    expect(flags.update).toHaveBeenCalledWith(
      { id: 'flg_1' },
      { bio: '새 소개' },
    );
    expect(sync).toHaveBeenCalledWith('flg_1');
  });

  it('does not expose flags from an unpublished festival', async () => {
    festivals.findOne.mockResolvedValueOnce({ published: null });
    await expect(service.detail('flg_1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects follow when account disappears after JWT validation', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const db = {
      transaction: (
        work: (manager: { query: typeof query }) => Promise<unknown>,
      ) => work({ query }),
    } as unknown as DataSource;
    const guarded = new FlagsService(
      db,
      { get: () => 'a-long-test-refresh-secret' } as unknown as ConfigService,
      flags as unknown as Repository<Flag>,
      {} as Repository<FlagFollow>,
      {} as Repository<FlagPin>,
      bearers as unknown as Repository<FlagBearer>,
      codes as unknown as Repository<FlagBearerCode>,
      {} as Repository<FlagClaimAttempt>,
      {} as FlagClaimThrottleService,
      {} as Repository<FlagReport>,
      festivals as unknown as Repository<AdminFestival>,
      {} as Repository<User>,
      {} as ImageStorageService,
      { sync } as unknown as FlagPackSyncService,
      {} as AdminAuditService,
    );
    await expect(
      guarded.follow('flg_1', 'departed', 'key-1'),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM "users" WHERE "id" = $1 FOR UPDATE'),
      ['departed'],
    );
  });
});
