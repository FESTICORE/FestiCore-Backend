import Redis from 'ioredis';
import type { DataSource, EntityManager } from 'typeorm';
import { AppDataSource } from './data-source';
import { AdminFestival } from '../modules/admin/festival/festival.entity';
import {
  Flag,
  FlagActivity,
  FlagLifecycle,
} from '../modules/flags/flag.entity';
import { isRecord } from '../modules/flags/flag-rules';
import { FlagPackSyncService } from '../modules/flags/flag-pack-sync.service';
import type { CacheService } from '../modules/redis/service/cache.service';

/** 개발 DB 전용 깃발 목 데이터 한 건. 존·셋은 대상 축제 팩에서 순서로 고른다. */
type DevFlagSeed = {
  id: string;
  name: string;
  bio: string;
  tags: string[];
  followerCount: number;
  planSize: number;
  status: FlagLifecycle;
  activity: FlagActivity | null;
  zoneIndex: number | null;
};

/** Figma S05의 '호락호락'과 쉬는 중·예정·오늘 종료 깃발. 고정 ID라 다시 실행하면 덮어쓴다. */
export const DEV_FLAG_SEEDS: readonly DevFlagSeed[] = [
  {
    id: 'flg_dev_horakhorak',
    name: '호락호락',
    bio: '처음 와도 괜찮아요. 슬램은 앞쪽, 쉬고 싶으면 뒤쪽 깃발 근처로.',
    tags: ['slam', 'sing', 'newbie'],
    followerCount: 1284,
    planSize: 4,
    status: 'active',
    activity: 'slam',
    zoneIndex: 0,
  },
  {
    id: 'flg_dev_resting',
    name: '쉼표산책',
    bio: '공연 사이에는 뒤쪽 그늘에서 쉬어 가요.',
    tags: ['calm'],
    followerCount: 312,
    planSize: 2,
    status: 'resting',
    activity: 'resting',
    zoneIndex: 1,
  },
  {
    id: 'flg_dev_scheduled',
    name: '첫곡떼창단',
    bio: '첫 곡부터 같이 불러요. 곧 출발합니다.',
    tags: ['sing', 'newbie'],
    followerCount: 87,
    planSize: 3,
    status: 'scheduled',
    activity: null,
    zoneIndex: null,
  },
  {
    id: 'flg_dev_ended',
    name: '막차기차',
    bio: '오늘 일정은 끝났어요. 내일 다시 만나요.',
    tags: ['train'],
    followerCount: 45,
    planSize: 1,
    status: 'ended',
    activity: null,
    zoneIndex: null,
  },
];

/** Railway develop 환경에서 --apply를 준 경우에만 쓴다. 운영 DB는 어떤 옵션으로도 열지 않는다. */
export function assertDevelopTarget(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): void {
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'develop')
    throw new Error(
      '개발 깃발 시드는 RAILWAY_ENVIRONMENT_NAME=develop 에서만 실행합니다.',
    );
  if (!argv.includes('--apply'))
    throw new Error('쓰기를 하려면 --apply를 붙여 실행합니다.');
}

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        isRecord(item) && typeof item.id === 'string' ? [item.id] : [],
      )
    : [];
}

async function targetFestival(
  manager: EntityManager,
  festivalId: string | undefined,
): Promise<AdminFestival> {
  const festivals = await manager
    .getRepository(AdminFestival)
    .createQueryBuilder('festival')
    .where('festival.published IS NOT NULL')
    .andWhere(festivalId ? 'festival.id = :festivalId' : '1=1', { festivalId })
    .orderBy('festival.id', 'ASC')
    .getMany();
  // 깃발을 쓰는 축제 중 존 2개·셋 4개 이상인 첫 발행 축제를 고른다.
  const festival = festivals.find(
    (item) =>
      item.published?.flagsEnabled !== false &&
      ids(item.published?.zones).length >= 2 &&
      ids(item.published?.sets).length >= 4,
  );
  if (!festival)
    throw new Error(
      '깃발을 쓰고 존 2개·셋 4개 이상인 발행 축제를 찾지 못했습니다.',
    );
  return festival;
}

/** 대상 축제에 개발 깃발을 넣고 공개 깃발 팩을 같은 트랜잭션에서 갱신한다. */
export async function seedDevFlags(
  db: DataSource,
  packSync: Pick<FlagPackSyncService, 'syncMany'>,
  festivalId?: string,
  now = new Date(),
): Promise<{ festivalId: string; flagIds: string[]; changed: string[] }> {
  return db.transaction(async (manager) => {
    const festival = await targetFestival(manager, festivalId);
    const zones = ids(festival.published?.zones);
    const sets = ids(festival.published?.sets);
    const flags = manager.getRepository(Flag);
    for (const seed of DEV_FLAG_SEEDS) {
      const sameName = await flags.findOne({
        where: { festivalId: festival.id, name: seed.name },
      });
      if (sameName && sameName.id !== seed.id)
        throw new Error(`같은 이름의 깃발이 이미 있습니다: ${seed.name}`);
      const zoneId = seed.zoneIndex === null ? null : zones[seed.zoneIndex];
      await flags.save(
        flags.create({
          id: seed.id,
          festivalId: festival.id,
          name: seed.name,
          visibility: 'public',
          thumbUrl: null,
          photoUrl: null,
          photoKey: null,
          thumbKey: null,
          tags: seed.tags,
          bio: seed.bio,
          followerCount: seed.followerCount,
          planVisible: true,
          plan: sets.slice(0, seed.planSize),
          homeZoneId: zones[0],
          zoneId,
          status: seed.status,
          activity: seed.activity,
          hidden: false,
          reportCount: 0,
          ownerId: null,
          restartDate: null,
          statusUpdatedAt: now,
          statusUpdatedBy: null,
          statusClientAt: now,
        }),
      );
    }
    const flagIds = DEV_FLAG_SEEDS.map((seed) => seed.id);
    const changed = await packSync.syncMany(flagIds, manager);
    return { festivalId: festival.id, flagIds, changed };
  });
}

if (require.main === module) {
  void (async () => {
    let redis: Redis | null = null;
    try {
      assertDevelopTarget(process.env, process.argv);
      const redisUrl = process.env.REDIS_PUBLIC_URL ?? process.env.REDIS_URL;
      redis = redisUrl ? new Redis(redisUrl, { family: 0 }) : null;
      // 시드는 Nest 없이 돌므로 팩 캐시 세대 키만 직접 올린다.
      const cache = {
        invalidatePack: async (id: string) => {
          await redis?.incr(`pack:${id}:gen`);
        },
      } as unknown as CacheService;
      await AppDataSource.initialize();
      const packSync = new FlagPackSyncService(AppDataSource, cache);
      const festivalArg = process.argv.indexOf('--festival');
      const result = await seedDevFlags(
        AppDataSource,
        packSync,
        festivalArg >= 0 ? process.argv[festivalArg + 1] : undefined,
      );
      await packSync.invalidatePacks(result.changed);
      console.log(JSON.stringify({ ...result, cacheInvalidated: !!redis }));
    } catch (error: unknown) {
      console.error(
        `개발 깃발 시드 실패: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      process.exitCode = 1;
    } finally {
      redis?.disconnect();
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
  })();
}
