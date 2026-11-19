import Redis from 'ioredis';
import { brotliCompressSync } from 'zlib';
import type { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import {
  AdminFestival,
  AdminFestivalVersion,
  type FestivalDocument,
} from '../modules/admin/festival/festival.entity';
import { validateDraft } from '../modules/admin/festival/festival-validation';
import { isRecord } from '../modules/flags/flag-rules';

export type PackDetailSeedMode = 'preview' | 'apply';

/** 시안 Pack B의 준비물. 모바일 티켓·신분증은 운영팀 필수 항목이다. */
export const DEV_CHECKLIST: readonly {
  id: string;
  label: string;
  required: boolean;
  note: string | null;
}[] = [
  { id: 'chk_dev_ticket', label: '모바일 티켓', required: true, note: null },
  { id: 'chk_dev_id', label: '신분증', required: true, note: null },
  { id: 'chk_dev_earplugs', label: '귀마개', required: false, note: null },
  { id: 'chk_dev_socks', label: '여분 양말', required: false, note: null },
  { id: 'chk_dev_cash', label: '현금 조금', required: false, note: null },
  { id: 'chk_dev_battery', label: '보조배터리', required: false, note: null },
  { id: 'chk_dev_raincoat', label: '우비', required: false, note: null },
];

/** 시안 Pack B의 반입 금지 */
export const DEV_RULES: readonly string[] = [
  '유리병',
  '캔',
  '셀카봉',
  '접이식 의자',
  '드론',
  '우산(장우산)',
];

/** 마지막 공연 종료 뒤 마지막 셔틀·막차까지의 분. 시안 Pack A(23:00 종료 → 23:40·23:52)와 같다. */
const SHUTTLE_AFTER_END_MINUTES = 40;
const TRAIN_AFTER_END_MINUTES = 52;

/**
 * develop 환경에서만 연다. `--apply`가 없으면 바꿀 축제만 보여 주는 미리보기다.
 * 운영 DB는 어떤 옵션으로도 열지 않는다.
 */
export function seedMode(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): PackDetailSeedMode {
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'develop')
    throw new Error(
      '개발 팩 상세 시드는 RAILWAY_ENVIRONMENT_NAME=develop 에서만 실행합니다.',
    );
  return argv.includes('--apply') ? 'apply' : 'preview';
}

const filled = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  value !== '' &&
  !(Array.isArray(value) && value.length === 0);

/** 가는 길·준비물·반입 금지 중 하나라도 값이 있으면 관리자가 넣은 것으로 보고 건드리지 않는다. 출처·장소 좌표는 보지 않는다. */
export function hasPackDetail(
  document: FestivalDocument | null | undefined,
): boolean {
  if (!document) return false;
  const directions = isRecord(document.directions) ? document.directions : {};
  const mapLinks = isRecord(directions.mapLinks) ? directions.mapLinks : {};
  return (
    [
      directions.shuttle,
      directions.transit,
      directions.parking,
      directions.memo,
      directions.lastShuttleAt,
      directions.lastTrainAt,
      directions.lastDepartures,
      mapLinks.naver,
      mapLinks.kakao,
    ].some(filled) ||
    filled(document.checklist) ||
    filled(document.rules)
  );
}

/** 오프셋 포함 ISO8601. 축제 시간대(Asia/Seoul)로 적는다. */
function seoulIso(milliseconds: number): string {
  const local = new Date(milliseconds + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  return `${local}:00+09:00`;
}

/** 개최일 중 가장 늦은 종료 시각. 시간을 모르는 초안이면 null이다. */
function lastEndsAt(document: FestivalDocument): number | null {
  const ends = (Array.isArray(document.days) ? document.days : [])
    .filter(isRecord)
    .map((day) =>
      typeof day.endsAt === 'string' ? Date.parse(day.endsAt) : NaN,
    )
    .filter((value) => !Number.isNaN(value));
  return ends.length ? Math.max(...ends) : null;
}

/** 비어 있는 팩 상세를 시안 값으로 채운다. 출처·장소 좌표 같은 기존 가는 길 필드는 그대로 둔다. */
export function withDevPackDetail(
  document: FestivalDocument,
): FestivalDocument {
  const directions = isRecord(document.directions) ? document.directions : {};
  const venue = typeof document.venue === 'string' ? document.venue : '';
  const query = encodeURIComponent(venue);
  const end = lastEndsAt(document);
  return {
    ...document,
    directions: {
      ...directions,
      shuttle: {
        body: '가까운 역과 행사장 정문 셔틀 정류장 사이를 15분 간격으로 운행해요.',
        links: [],
        stopName: '정문 셔틀 정류장',
        location: null,
      },
      transit: {
        body: '공연이 끝나면 역이 붐벼요. 막차 시각을 미리 확인하세요.',
        links: [],
        stationName: null,
        walkMinutes: null,
        location: null,
      },
      parking: {
        body: '행사장 주차장은 유료이고 공연 날에는 일찍 차요. 대중교통을 권해요.',
        links: [],
      },
      memo: '헤드라이너가 끝나면 셔틀 줄이 30분 넘게 길어져요. 막차 시각을 꼭 확인하세요.',
      lastShuttleAt:
        end === null
          ? null
          : seoulIso(end + SHUTTLE_AFTER_END_MINUTES * 60 * 1000),
      lastTrainAt:
        end === null
          ? null
          : seoulIso(end + TRAIN_AFTER_END_MINUTES * 60 * 1000),
      mapLinks: venue
        ? {
            naver: `https://map.naver.com/p/search/${query}`,
            kakao: `https://map.kakao.com/link/search/${query}`,
          }
        : { naver: null, kakao: null },
    },
    checklist: DEV_CHECKLIST.map((item) => ({ ...item })),
    rules: [...DEV_RULES],
  };
}

/** 시드가 새로 만든 검증 오류만 막는다. 원래 문서에 있던 오류는 이 시드의 범위가 아니다. */
function assertNoNewErrors(
  before: FestivalDocument,
  after: FestivalDocument,
  forPublish: boolean,
  id: string,
) {
  const existing = new Set(validateDraft(before, forPublish));
  const added = validateDraft(after, forPublish).filter(
    (error) => !existing.has(error),
  );
  if (added.length)
    throw new Error(`${id} 팩 상세 시드 검증 실패: ${added.join(', ')}`);
}

/**
 * 발행 축제 중 가는 길·준비물·반입 금지가 모두 빈 곳만 시안 값으로 채운다.
 * 초안과 발행본에 같이 넣고, 실제로 바뀐 축제만 팩 버전을 올린다. 다시 실행하면 값이 있어 건너뛴다.
 */
export async function seedDevPackDetails(
  db: DataSource,
  mode: PackDetailSeedMode,
  now = new Date(),
): Promise<{ mode: PackDetailSeedMode; changed: string[]; skipped: string[] }> {
  return db.transaction(async (manager) => {
    const festivals = manager.getRepository(AdminFestival);
    const rows = await festivals
      .createQueryBuilder('festival')
      .setLock('pessimistic_write')
      .where('festival.published IS NOT NULL')
      .orderBy('festival.id', 'ASC')
      .getMany();
    const changed: string[] = [];
    const skipped: string[] = [];
    for (const festival of rows) {
      const published = festival.published;
      if (
        !published ||
        hasPackDetail(published) ||
        hasPackDetail(festival.draft)
      ) {
        skipped.push(festival.id);
        continue;
      }
      const draft = withDevPackDetail(festival.draft);
      const next = withDevPackDetail(published);
      assertNoNewErrors(festival.draft, draft, false, festival.id);
      assertNoNewErrors(published, next, true, festival.id);
      changed.push(festival.id);
      if (mode === 'preview') continue;

      const packVersion = festival.publishedVersion + 1;
      const pack = {
        ...next,
        packVersion,
        packUpdatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      const serialized = JSON.stringify(pack);
      if (brotliCompressSync(Buffer.from(serialized)).length > 200 * 1024)
        throw new Error(`${festival.id} 압축된 팩이 200KB를 초과합니다.`);
      festival.draft = draft;
      festival.draftVersion += 1;
      festival.published = pack;
      festival.publishedVersion = packVersion;
      await manager.getRepository(AdminFestivalVersion).save({
        festivalId: festival.id,
        packVersion,
        pack,
        publishedBy: null,
        note: 'Dev pack detail seed',
        sizeBytes: Buffer.byteLength(serialized),
      });
      await festivals.save(festival);
    }
    return { mode, changed, skipped };
  });
}

if (require.main === module) {
  void (async () => {
    let redis: Redis | null = null;
    try {
      const mode = seedMode(process.env, process.argv);
      await AppDataSource.initialize();
      const result = await seedDevPackDetails(AppDataSource, mode);
      // 시드는 Nest 없이 돌므로 바뀐 축제의 팩 캐시 세대 키만 직접 올린다.
      const redisUrl = process.env.REDIS_PUBLIC_URL ?? process.env.REDIS_URL;
      if (mode === 'apply' && result.changed.length && redisUrl) {
        redis = new Redis(redisUrl, { family: 0 });
        for (const festivalId of result.changed)
          await redis.incr(`pack:${festivalId}:gen`);
      }
      console.log(JSON.stringify({ ...result, cacheInvalidated: !!redis }));
    } catch (error: unknown) {
      console.error(
        `개발 팩 상세 시드 실패: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      process.exitCode = 1;
    } finally {
      redis?.disconnect();
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
  })();
}
