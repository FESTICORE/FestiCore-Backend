import type { DataSource, EntityManager } from 'typeorm';
import { AdminFestival } from '../modules/admin/festival/festival.entity';
import { Flag } from '../modules/flags/flag.entity';
import {
  assertDevelopTarget,
  DEV_FLAG_SEEDS,
  seedDevFlags,
} from './seed-dev-flags';

describe('개발 깃발 시드', () => {
  it('develop 환경과 --apply가 모두 있어야 실행한다', () => {
    expect(() =>
      assertDevelopTarget({ RAILWAY_ENVIRONMENT_NAME: 'production' }, [
        '--apply',
      ]),
    ).toThrow('RAILWAY_ENVIRONMENT_NAME=develop');
    expect(() => assertDevelopTarget({}, ['--apply'])).toThrow(
      'RAILWAY_ENVIRONMENT_NAME=develop',
    );
    expect(() =>
      assertDevelopTarget({ RAILWAY_ENVIRONMENT_NAME: 'develop' }, []),
    ).toThrow('--apply');
    expect(() =>
      assertDevelopTarget({ RAILWAY_ENVIRONMENT_NAME: 'develop' }, ['--apply']),
    ).not.toThrow();
  });

  it('S05 호락호락과 쉬는 중·예정·종료 깃발을 발행 축제에 넣고 팩을 갱신한다', async () => {
    const festival = {
      id: 'fst_dev',
      published: {
        flagsEnabled: true,
        zones: [{ id: 'zone_front' }, { id: 'zone_back' }],
        sets: ['s1', 's2', 's3', 's4', 's5'].map((id) => ({ id })),
      },
    };
    const query = {
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      getMany: jest.fn().mockResolvedValue([festival]),
    };
    query.where.mockReturnValue(query);
    query.andWhere.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    const saved: Partial<Flag>[] = [];
    const flags = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Partial<Flag>) => value),
      save: jest.fn((value: Partial<Flag>) => {
        saved.push(value);
        return Promise.resolve(value);
      }),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === AdminFestival)
          return { createQueryBuilder: () => query };
        if (entity === Flag) return flags;
        throw new Error('unexpected repository');
      }),
    } as unknown as EntityManager;
    const db = {
      transaction: (work: (manager: EntityManager) => Promise<unknown>) =>
        work(manager),
    } as unknown as DataSource;
    const syncMany = jest.fn().mockResolvedValue(['fst_dev']);
    const now = new Date('2026-11-08T03:00:00.000Z');

    const result = await seedDevFlags(db, { syncMany }, undefined, now);

    expect(result).toEqual({
      festivalId: 'fst_dev',
      flagIds: DEV_FLAG_SEEDS.map((seed) => seed.id),
      changed: ['fst_dev'],
    });
    expect(saved[0]).toMatchObject({
      name: '호락호락',
      bio: '처음 와도 괜찮아요. 슬램은 앞쪽, 쉬고 싶으면 뒤쪽 깃발 근처로.',
      tags: ['slam', 'sing', 'newbie'],
      followerCount: 1284,
      plan: ['s1', 's2', 's3', 's4'],
      status: 'active',
      activity: 'slam',
      zoneId: 'zone_front',
    });
    expect(saved.map((flag) => flag.status)).toEqual([
      'active',
      'resting',
      'scheduled',
      'ended',
    ]);
    expect(saved[1]).toMatchObject({
      activity: 'resting',
      zoneId: 'zone_back',
    });
    expect(saved[3]).toMatchObject({ zoneId: null, statusUpdatedAt: now });
    // 이름과 소개는 깃발 프로필 검증 범위(이름 2..20자, 소개 60자 이하) 안에 있다.
    for (const seed of DEV_FLAG_SEEDS) {
      expect([...seed.name].length).toBeGreaterThanOrEqual(2);
      expect([...seed.name].length).toBeLessThanOrEqual(20);
      expect([...seed.bio].length).toBeLessThanOrEqual(60);
    }
    expect(syncMany).toHaveBeenCalledWith(
      DEV_FLAG_SEEDS.map((seed) => seed.id),
      manager,
    );
  });

  it('다른 ID의 같은 이름 깃발이 있으면 덮어쓰지 않고 멈춘다', async () => {
    const query = {
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'fst_dev',
          published: {
            zones: [{ id: 'z1' }, { id: 'z2' }],
            sets: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
          },
        },
      ]),
    };
    query.where.mockReturnValue(query);
    query.andWhere.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    const save = jest.fn();
    const manager = {
      getRepository: (entity: unknown) =>
        entity === AdminFestival
          ? { createQueryBuilder: () => query }
          : {
              findOne: jest.fn().mockResolvedValue({ id: 'flg_real' }),
              save,
            },
    } as unknown as EntityManager;
    const db = {
      transaction: (work: (manager: EntityManager) => Promise<unknown>) =>
        work(manager),
    } as unknown as DataSource;

    await expect(
      seedDevFlags(db, { syncMany: jest.fn() }, undefined),
    ).rejects.toThrow('같은 이름의 깃발이 이미 있습니다: 호락호락');
    expect(save).not.toHaveBeenCalled();
  });
});
