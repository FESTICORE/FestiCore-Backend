import type { DataSource, EntityManager } from 'typeorm';
import { AdminFestival } from '../modules/admin/festival/festival.entity';
import { User } from '../modules/auth/entity/user.entity';
import {
  Crew,
  CrewGather,
  CrewGatherResponse,
  CrewMember,
} from '../modules/crews/crew.entity';
import {
  assertDevelopTarget,
  DEV_CREW_GATHER_ID,
  DEV_CREW_SEEDS,
  seedDevCrews,
} from './seed-dev-crews';

function repository(rows: Record<string, unknown>[]) {
  return {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn((value: Record<string, unknown>) => {
      rows.push(value);
      return Promise.resolve(value);
    }),
  };
}

function setup(festivals: Partial<AdminFestival>[]) {
  const query = {
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(festivals),
  };
  query.where.mockReturnValue(query);
  query.andWhere.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  const rows = {
    users: [] as Record<string, unknown>[],
    crews: [] as Record<string, unknown>[],
    members: [] as Record<string, unknown>[],
    gathers: [] as Record<string, unknown>[],
    responses: [] as Record<string, unknown>[],
  };
  const repositories = new Map<unknown, ReturnType<typeof repository>>([
    [User, repository(rows.users)],
    [Crew, repository(rows.crews)],
    [CrewMember, repository(rows.members)],
    [CrewGather, repository(rows.gathers)],
    [CrewGatherResponse, repository(rows.responses)],
  ]);
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === AdminFestival) return { createQueryBuilder: () => query };
      const found = repositories.get(entity);
      if (!found) throw new Error('unexpected repository');
      return found;
    }),
  };
  const db = {
    transaction: jest.fn((work: (manager: EntityManager) => unknown) =>
      work(manager as unknown as EntityManager),
    ),
  } as unknown as DataSource;
  return { db, rows, crews: repositories.get(Crew)! };
}

const now = new Date('2026-11-13T03:00:00.000Z');
const openFestival = {
  id: 'fst_dev',
  published: {
    days: [{ endsAt: '2026-11-14T12:00:00.000Z' }],
    zones: [{ id: 'zon_front' }, { id: 'zon_back' }],
  },
} as unknown as Partial<AdminFestival>;

describe('개발 크루 시드', () => {
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

  it('5명·12명 크루, 만료 크루, 유효·만료 초대 코드와 진행 중인 모여를 만든다', async () => {
    const { db, rows, crews } = setup([
      {
        id: 'fst_ended',
        published: {
          days: [{ endsAt: '2026-01-01T12:00:00.000Z' }],
          zones: [{ id: 'zon_old' }],
        },
      },
      openFestival,
    ]);
    const result = await seedDevCrews(db, undefined, now);

    expect(result.festivalId).toBe('fst_dev');
    expect(crews.delete).toHaveBeenCalledTimes(1);
    expect(rows.users).toHaveLength(20);
    expect(
      rows.users.every((user) => String(user.nickname).startsWith('DEV크루원')),
    ).toBe(true);
    const counts = DEV_CREW_SEEDS.map(
      (seed) => rows.members.filter((row) => row.crewId === seed.id).length,
    );
    expect(counts).toEqual([5, 12, 3]);
    const [five, twelve, archived] = rows.crews as unknown as Crew[];
    expect(five.inviteExpiresAt.getTime()).toBeGreaterThan(now.getTime());
    expect(twelve.inviteExpiresAt.getTime()).toBeLessThan(now.getTime());
    expect(archived.archivedAt).not.toBeNull();
    expect(five.archivedAt).toBeNull();
    expect(rows.gathers).toEqual([
      expect.objectContaining({
        id: DEV_CREW_GATHER_ID,
        crewId: twelve.id,
        byUserId: twelve.ownerId,
        zoneId: 'zon_front',
        createdAt: now,
      }),
    ]);
    expect(rows.responses.map((row) => row.response)).toEqual([
      'going',
      'going',
      'going',
      'ack',
      'ack',
    ]);
    // 모여를 보낸 크루장은 응답하지 않는다.
    expect(rows.responses.map((row) => row.userId)).not.toContain(
      twelve.ownerId,
    );
    expect(result.gather.responses).toBe(5);
    // 크루원은 모두 다른 개발 계정이라 축제별 1크루 제약을 지킨다.
    expect(new Set(rows.members.map((row) => row.userId)).size).toBe(20);
  });

  it('다른 크루가 시드 초대 코드를 쓰면 쓰지 않고 멈춘다', async () => {
    const { db, crews, rows } = setup([openFestival]);
    crews.find.mockResolvedValueOnce([
      { id: 'flg_real', inviteCode: 'DEVFVE' },
    ]);
    await expect(seedDevCrews(db, undefined, now)).rejects.toThrow(
      '시드 초대 코드',
    );
    expect(crews.delete).not.toHaveBeenCalled();
    expect(rows.users).toHaveLength(0);
  });

  it('끝난 축제만 있으면 실패한다', async () => {
    const { db } = setup([
      {
        id: 'fst_ended',
        published: {
          days: [{ endsAt: '2026-01-01T12:00:00.000Z' }],
          zones: [{ id: 'zon_old' }],
        },
      },
    ]);
    await expect(seedDevCrews(db, undefined, now)).rejects.toThrow(
      '아직 끝나지 않은 발행 축제',
    );
  });
});
