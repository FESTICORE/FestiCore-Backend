import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { AppDataSource } from './data-source';
import { AdminFestival } from '../modules/admin/festival/festival.entity';
import { User } from '../modules/auth/entity/user.entity';
import {
  Crew,
  CrewGather,
  CrewGatherReply,
  CrewGatherResponse,
  CrewMember,
} from '../modules/crews/crew.entity';

/** 개발 DB 전용 크루 한 개. 크루원은 고정 개발 계정 순서로 채운다. */
type DevCrewSeed = {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  invite: 'valid' | 'expired';
  archived: boolean;
  gather: { going: number; ack: number } | null;
};

/** S07·S08 확인용. 고정 ID라 다시 실행하면 지우고 새로 만든다. 코드는 초대 알파벳(I·O·0·1 제외)만 쓴다. */
export const DEV_CREW_SEEDS: readonly DevCrewSeed[] = [
  {
    id: 'flg_dev_crew_five',
    name: 'DEV 다섯크루',
    inviteCode: 'DEVFVE',
    memberCount: 5,
    invite: 'valid',
    archived: false,
    gather: null,
  },
  {
    id: 'flg_dev_crew_twelve',
    name: 'DEV 열두크루',
    inviteCode: 'DEVTWL',
    memberCount: 12,
    invite: 'expired',
    archived: false,
    gather: { going: 3, ack: 2 },
  },
  {
    id: 'flg_dev_crew_archived',
    name: 'DEV 만료크루',
    inviteCode: 'DEVXPD',
    memberCount: 3,
    invite: 'expired',
    archived: true,
    gather: null,
  },
];

export const DEV_CREW_GATHER_ID = 'de000000-0000-4000-8000-00000000c0de';
const INVITE_MS = 48 * 60 * 60_000;

/** 개발 계정 n번(1부터). 실제 로그인과 겹치지 않는 providerId를 쓴다. */
export function devCrewUserId(index: number): string {
  return `de000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

/** Railway develop 환경에서 --apply를 준 경우에만 쓴다. 운영 DB는 어떤 옵션으로도 열지 않는다. */
export function assertDevelopTarget(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): void {
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'develop')
    throw new Error(
      '개발 크루 시드는 RAILWAY_ENVIRONMENT_NAME=develop 에서만 실행합니다.',
    );
  if (!argv.includes('--apply'))
    throw new Error('쓰기를 하려면 --apply를 붙여 실행합니다.');
}

function zoneIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item: unknown) =>
        item &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string'
          ? [(item as { id: string }).id]
          : [],
      )
    : [];
}

/** 마지막 공연일 다음 날까지인 축제만 크루를 쓸 수 있다(CrewService.archiveTime과 같은 기준). */
function isOpen(festival: AdminFestival, now: Date): boolean {
  const days: unknown = festival.published?.days;
  const ends = (Array.isArray(days) ? days : [])
    .map((day: unknown) =>
      Date.parse(
        typeof (day as { endsAt?: unknown })?.endsAt === 'string'
          ? (day as { endsAt: string }).endsAt
          : '',
      ),
    )
    .filter(Number.isFinite);
  return !ends.length || now.getTime() < Math.max(...ends) + 24 * 60 * 60_000;
}

async function targetFestival(
  manager: EntityManager,
  festivalId: string | undefined,
  now: Date,
): Promise<AdminFestival> {
  const festivals = await manager
    .getRepository(AdminFestival)
    .createQueryBuilder('festival')
    .where('festival.published IS NOT NULL')
    .andWhere(festivalId ? 'festival.id = :festivalId' : '1=1', { festivalId })
    .orderBy('festival.id', 'ASC')
    .getMany();
  const festival = festivals.find(
    (item) => isOpen(item, now) && zoneIds(item.published?.zones).length > 0,
  );
  if (!festival)
    throw new Error('존이 있고 아직 끝나지 않은 발행 축제를 찾지 못했습니다.');
  return festival;
}

/** 대상 축제에 개발 계정과 크루·초대 코드·진행 중인 모여를 넣는다. */
export async function seedDevCrews(
  db: DataSource,
  festivalId?: string,
  now = new Date(),
): Promise<{
  festivalId: string;
  crews: {
    id: string;
    name: string;
    memberCount: number;
    inviteCode: string;
    inviteExpiresAt: Date;
    archived: boolean;
  }[];
  gather: { id: string; crewId: string; expiresAt: Date; responses: number };
}> {
  return db.transaction(async (manager) => {
    const festival = await targetFestival(manager, festivalId, now);
    const zoneId = zoneIds(festival.published?.zones)[0];
    const crewIds = DEV_CREW_SEEDS.map((seed) => seed.id);
    const codes = DEV_CREW_SEEDS.map((seed) => seed.inviteCode);
    const crews = manager.getRepository(Crew);
    const taken = await crews.find({ where: { inviteCode: In(codes) } });
    const foreign = taken.find((crew) => !crewIds.includes(crew.id));
    if (foreign)
      throw new Error(
        `다른 크루가 시드 초대 코드를 쓰고 있습니다: ${foreign.id}`,
      );
    // 크루를 지우면 크루원·모여·응답이 함께 지워진다.
    await crews.delete({ id: In(crewIds) });

    const total = DEV_CREW_SEEDS.reduce(
      (sum, seed) => sum + seed.memberCount,
      0,
    );
    const users = manager.getRepository(User);
    for (let index = 1; index <= total; index++)
      await users.save(
        users.create({
          id: devCrewUserId(index),
          provider: 'google',
          providerId: `dev-seed-crew-${index}`,
          email: null,
          nickname: `DEV크루원${String(index).padStart(2, '0')}`,
          nicknameConfirmed: true,
          nicknameExplicitlySet: true,
          profileImageUrl: null,
        }),
      );

    const result: Awaited<ReturnType<typeof seedDevCrews>>['crews'] = [];
    let gather: Awaited<ReturnType<typeof seedDevCrews>>['gather'] | null =
      null;
    let next = 1;
    for (const seed of DEV_CREW_SEEDS) {
      const memberIds = Array.from({ length: seed.memberCount }, () =>
        devCrewUserId(next++),
      );
      const inviteExpiresAt = new Date(
        seed.invite === 'valid'
          ? now.getTime() + INVITE_MS
          : now.getTime() - 60 * 60_000,
      );
      await crews.save(
        crews.create({
          id: seed.id,
          festivalId: festival.id,
          name: seed.name,
          ownerId: memberIds[0],
          inviteCode: seed.inviteCode,
          inviteExpiresAt,
          archivedAt: seed.archived
            ? new Date(now.getTime() - 24 * 60 * 60_000)
            : null,
          lastGatherAt: seed.gather ? now : null,
        }),
      );
      const members = manager.getRepository(CrewMember);
      for (const [order, userId] of memberIds.entries())
        await members.save(
          members.create({
            crewId: seed.id,
            userId,
            festivalId: festival.id,
            nickname: `DEV크루원${userId.slice(-2)}`,
            zoneId: seed.archived ? null : zoneId,
            state: seed.archived ? null : 'here',
            statusUpdatedAt: seed.archived ? null : now,
            // 가입 순서가 크루원 목록·초대 미리보기 순서다.
            joinedAt: new Date(
              now.getTime() - (memberIds.length - order) * 60_000,
            ),
          }),
        );
      if (seed.gather) {
        await manager.getRepository(CrewGather).save(
          manager.getRepository(CrewGather).create({
            id: DEV_CREW_GATHER_ID,
            crewId: seed.id,
            byUserId: memberIds[0],
            zoneId,
            createdAt: now,
          }),
        );
        const replies: CrewGatherReply[] = [
          ...Array<CrewGatherReply>(seed.gather.going).fill('going'),
          ...Array<CrewGatherReply>(seed.gather.ack).fill('ack'),
        ];
        const responses = manager.getRepository(CrewGatherResponse);
        for (const [order, response] of replies.entries())
          await responses.save(
            responses.create({
              gatherId: DEV_CREW_GATHER_ID,
              userId: memberIds[order + 1],
              response,
              respondedAt: now,
            }),
          );
        gather = {
          id: DEV_CREW_GATHER_ID,
          crewId: seed.id,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
          responses: replies.length,
        };
      }
      result.push({
        id: seed.id,
        name: seed.name,
        memberCount: seed.memberCount,
        inviteCode: seed.inviteCode,
        inviteExpiresAt,
        archived: seed.archived,
      });
    }
    if (!gather) throw new Error('진행 중인 모여 시드가 없습니다.');
    return { festivalId: festival.id, crews: result, gather };
  });
}

if (require.main === module) {
  void (async () => {
    try {
      assertDevelopTarget(process.env, process.argv);
      await AppDataSource.initialize();
      const festivalArg = process.argv.indexOf('--festival');
      const result = await seedDevCrews(
        AppDataSource,
        festivalArg >= 0 ? process.argv[festivalArg + 1] : undefined,
      );
      console.log(JSON.stringify(result));
    } catch (error: unknown) {
      console.error(
        `개발 크루 시드 실패: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      process.exitCode = 1;
    } finally {
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
  })();
}
