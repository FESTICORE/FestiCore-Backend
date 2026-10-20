import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
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
  } as Flag;
  const flags = {
    findOne: jest.fn().mockResolvedValue(flag),
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
  const sync = jest.fn().mockResolvedValue(undefined);
  const service = new FlagsService(
    {} as DataSource,
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
  );

  beforeEach(() => {
    jest.clearAllMocks();
    savedCodes.length = 0;
    festivals.findOne.mockResolvedValue({ published: { zones: [], sets: [] } });
  });

  it('encrypts generated codes at rest and returns retrievable codes to admin', async () => {
    const created = await service.createCodes('fest_1', { count: 1 });
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
