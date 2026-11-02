import { DataSource, EntityManager } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { User } from '../auth/entity/user.entity';
import { Flag, FlagIdempotency, FlagStatusEvent } from './flag.entity';
import { FlagsService } from './flags.service';

describe('깃발 상태를 바꾼 기수', () => {
  function setup() {
    const flag: Flag = Object.assign(new Flag(), {
      id: 'flg_1',
      festivalId: 'fst_1',
      visibility: 'public',
      status: 'active' as const,
      zoneId: 'zone_a',
      activity: 'slam' as const,
      statusUpdatedAt: new Date('2026-10-20T00:00:00.000Z'),
      statusUpdatedBy: 'usr_owner',
      createdAt: new Date('2026-10-20T00:00:00.000Z'),
      restartDate: null,
      followerCount: 3,
      planVisible: true,
      plan: [],
      tags: ['slam'],
      hidden: false,
      reportCount: 0,
    });
    const saveFlag = jest.fn((value: Flag) => Promise.resolve(value));
    const query = {
      setLock: jest.fn(),
      where: jest.fn(),
      getOne: jest.fn().mockResolvedValue(flag),
      getCount: jest.fn().mockResolvedValue(0),
    };
    query.setLock.mockReturnValue(query);
    query.where.mockReturnValue(query);
    const idempotency = {
      findOne: jest.fn().mockResolvedValue(null),
      create: (value: unknown) => value,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Flag)
          return { createQueryBuilder: () => query, save: saveFlag };
        if (entity === FlagStatusEvent)
          return {
            createQueryBuilder: () => query,
            save: jest.fn().mockResolvedValue(undefined),
          };
        if (entity === FlagIdempotency) return idempotency;
        if (entity === AdminFestival)
          return {
            findOne: jest
              .fn()
              .mockResolvedValue({ published: { zones: [{ id: 'zone_b' }] } }),
          };
        if (entity === User)
          return {
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 'usr_co', nickname: '민지' }),
          };
        throw new Error('unexpected repository');
      }),
    } as unknown as EntityManager;
    const service = Object.create(FlagsService.prototype) as FlagsService;
    Reflect.set(service, 'db', {
      transaction: (work: (value: EntityManager) => Promise<unknown>) =>
        work(manager),
    } as unknown as DataSource);
    Reflect.set(service, 'flags', {
      findOne: jest.fn().mockResolvedValue(flag),
    });
    Reflect.set(service, 'festivals', {
      findOne: jest.fn().mockResolvedValue({ published: { zones: [] } }),
    });
    Reflect.set(service, 'bearers', {
      findOne: jest.fn().mockResolvedValue({ userId: 'usr_co' }),
      find: jest
        .fn()
        .mockResolvedValue([{ userId: 'usr_owner' }, { userId: 'usr_co' }]),
    });
    Reflect.set(service, 'users', {
      findByIds: jest.fn().mockResolvedValue([
        { id: 'usr_owner', nickname: '로이' },
        { id: 'usr_co', nickname: '민지' },
      ]),
    });
    Reflect.set(service, 'socialNotifications', {
      enqueueFlagStatus: jest.fn().mockResolvedValue(undefined),
    });
    Reflect.set(service, 'liveActivity', {
      enqueueFestival: jest.fn().mockResolvedValue(undefined),
    });
    return { service, flag, saveFlag };
  }

  it('기수 상세는 마지막으로 바꾼 기수의 닉네임을 보여 준다', async () => {
    const { service } = setup();
    const view = await service.bearerView('flg_1', 'usr_co');
    expect(view.status.updatedBy).toEqual({
      userId: 'usr_owner',
      nickname: '로이',
    });
  });

  it('상태를 바꾸면 요청한 기수를 저장하고 응답에 담는다', async () => {
    const { service, saveFlag } = setup();
    const result = await service.status('flg_1', 'usr_co', 'key-1', {
      clientAt: new Date().toISOString(),
      zoneId: 'zone_b',
    });
    expect(saveFlag).toHaveBeenCalledWith(
      expect.objectContaining({ zoneId: 'zone_b', statusUpdatedBy: 'usr_co' }),
    );
    expect(result).toMatchObject({
      zoneId: 'zone_b',
      updatedBy: { userId: 'usr_co', nickname: '민지' },
    });
  });
});
