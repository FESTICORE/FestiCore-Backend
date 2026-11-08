import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AdminAccount } from '../modules/admin/auth/admin.entity';
import { AdminFestivalService } from '../modules/admin/festival/admin-festival.service';
import { AdminFestival } from '../modules/admin/festival/festival.entity';
import { festivalSetId } from '../modules/admin/festival/festival-set-id';
import { User } from '../modules/auth/entity/user.entity';
import type { CrewState } from '../modules/crews/crew.entity';
import { CrewService } from '../modules/crews/crew.service';
import { Flag } from '../modules/flags/flag.entity';
import { FlagPackSyncService } from '../modules/flags/flag-pack-sync.service';
import { FlagsService } from '../modules/flags/flags.service';
import { ScheduleService } from '../modules/schedule/schedule.service';

/**
 * 개발 환경의 S06 존 지도 목 데이터를 서비스 경로로 넣는다.
 *
 * - 관리자 초안 PATCH(존 영역·무대 머리글·종횡비) → 발행
 * - 목 기수 사용자 → 관리자 기수 코드 발급 → 코드 청구 → 깃발 프로필 수정 → 관리자 상태 강제 변경
 * - `--member-email`의 계정: 깃발 팔로우, 목 크루원과 같은 크루 → 크루원 위치 갱신
 *
 * - `--live-today`: 오늘(KST) 진행 중인 개발 목 축제(`원더리벳 2026 (개발 목)`)를 만들거나 다시 쓰고,
 *   무대마다 지금·다음 공연, 깃발 썸네일(보관된 출연진 이미지 재사용), 개발 계정의 내 일정을 넣어
 *   S01 라이브 보드가 시안처럼 채워지게 한다.
 *
 * 운영 환경에서는 실행하지 않는다. Railway develop 컨테이너에서 실행한다.
 *   node dist/database/seed-zone-map.js --festival fst_00e0f4f1d8065a93 --member-email me@example.com
 *   node dist/database/seed-zone-map.js --live-today --member-email me@example.com
 * 같은 명령을 다시 실행하면 같은 목 사용자·깃발·크루를 다시 쓰고 존과 상태만 갱신한다.
 */

/** 시안(393x600 지도) 좌표. 지도 너비 393, 높이 600 기준 pt다. */
const MAP_WIDTH = 393;
const MAP_HEIGHT = 600;

const ZONES = [
  {
    id: 'zon_rivet_front_left',
    name: '리벳 스테이지 앞 왼쪽',
    kind: '무대 앞',
    rect: [10, 42, 174, 98],
  },
  {
    id: 'zon_rivet_center',
    name: '리벳 스테이지 중앙',
    kind: '무대 앞',
    rect: [10, 148, 108, 94],
  },
  { id: 'zon_slam', name: '슬램 존', kind: '슬램', rect: [126, 148, 58, 94] },
  {
    id: 'zon_rivet_back',
    name: '리벳 스테이지 뒤',
    kind: '무대 뒤',
    rect: [10, 250, 174, 58],
  },
  {
    id: 'zon_wonder_front',
    name: '원더 스테이지 앞',
    kind: '무대 앞',
    rect: [209, 42, 174, 98],
  },
  {
    id: 'zon_wonder_back',
    name: '원더 스테이지 뒤',
    kind: '무대 뒤',
    rect: [209, 148, 174, 90],
  },
  {
    id: 'zon_tent',
    name: 'TENT 앞',
    kind: '무대 앞',
    rect: [209, 246, 174, 62],
    landmark: 'TENT 무대',
  },
  { id: 'zon_grass', name: '잔디존', kind: '휴식', rect: [10, 338, 174, 160] },
  { id: 'zon_fnb', name: 'F&B 존', kind: '먹거리', rect: [209, 338, 174, 160] },
  {
    id: 'zon_gate',
    name: '정문',
    kind: '출입구',
    rect: [140, 510, 168, 63],
    landmark: 'GATE',
  },
] as const;

/** 무대 머리글 줄: [x, y, w] */
const STAGE_HEADERS = [
  [10, 12, 174],
  [209, 12, 174],
] as const;

type Activity = 'slam' | 'sing' | 'train' | 'calm';

const FLAGS: {
  key: string;
  name: string;
  zoneId: string;
  status: 'active' | 'resting';
  activity: Activity;
  followed: boolean;
}[] = [
  {
    key: 'horak',
    name: '호락호락',
    zoneId: 'zon_rivet_front_left',
    status: 'active',
    activity: 'slam',
    followed: true,
  },
  {
    key: 'maechang',
    name: '매창단',
    zoneId: 'zon_wonder_front',
    status: 'active',
    activity: 'sing',
    followed: true,
  },
  {
    key: 'redpants',
    name: '빨간바지',
    zoneId: 'zon_wonder_front',
    status: 'active',
    activity: 'calm',
    followed: false,
  },
  {
    key: 'center',
    name: '센터라인',
    zoneId: 'zon_rivet_center',
    status: 'active',
    activity: 'sing',
    followed: false,
  },
  {
    key: 'metal',
    name: '메탈크루',
    zoneId: 'zon_slam',
    status: 'active',
    activity: 'slam',
    followed: false,
  },
  {
    key: 'dive',
    name: '다이브앤롤',
    zoneId: 'zon_slam',
    status: 'active',
    activity: 'slam',
    followed: false,
  },
  {
    key: 'moshing',
    name: '모싱클럽',
    zoneId: 'zon_slam',
    status: 'resting',
    activity: 'slam',
    followed: false,
  },
  {
    key: 'picnic',
    name: '피크닉은락',
    zoneId: 'zon_grass',
    status: 'active',
    activity: 'calm',
    followed: false,
  },
  {
    key: 'snack',
    name: '야식원정대',
    zoneId: 'zon_fnb',
    status: 'active',
    activity: 'train',
    followed: false,
  },
];

const CREW_MEMBERS: {
  key: string;
  nickname: string;
  zoneId: string;
  state: CrewState;
}[] = [
  { key: 'junho', nickname: '준호', zoneId: 'zon_wonder_back', state: 'here' },
  { key: 'minji', nickname: '민지', zoneId: 'zon_fnb', state: 'eating' },
  { key: 'hansol', nickname: '한솔', zoneId: 'zon_gate', state: 'toilet' },
];

/** `--live-today` 개발 목 축제 */
const MOCK_FESTIVAL_NAME = '원더리벳 2026 (개발 목)';
/** 깃발 썸네일·출연진 사진으로 다시 쓸 보관 이미지가 있는 축제(WONDERLIVET 2026) */
const IMAGE_SOURCE_FESTIVAL = 'fst_00e0f4f1d8065a93';
const MOCK_STAGES = [
  {
    id: 'stg_rivet',
    name: 'RIVET STAGE',
    order: 1,
    artists: ['잔나비', '새소년', '터치드', '실리카겔', '너드커넥션', '혁오'],
  },
  {
    id: 'stg_wonder',
    name: 'WONDER STAGE',
    order: 2,
    artists: ['데이브레이크', '소란', 'LUCY', '쏜애플', '글렌체크', '페퍼톤스'],
  },
];
const MEMBER_ZONE = 'zon_rivet_front_left';

/**
 * 오늘(KST) 진행 중인 일정. 무대마다 지금 공연(시작 25분 전후)과 앞뒤 공연을 1시간 간격(50분 공연)으로 둔다.
 * 하루는 같은 날짜 안에서 18시간을 넘지 않으므로 KST 23시 15분 이후에는 지금 공연이 없다.
 */
export function liveTodayPlan(now: Date) {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const date = kst.toISOString().slice(0, 10);
  const iso = (minutes: number) => {
    const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mins = String(minutes % 60).padStart(2, '0');
    return `${date}T${hours}:${mins}:00+09:00`;
  };
  const nowMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const anchor = Math.max(0, Math.floor((nowMinutes - 25) / 5) * 5);
  const dayEnd = Math.min(24 * 60 - 1, Math.max(23 * 60, anchor + 4 * 60));
  const dayStart = Math.max(
    dayEnd - 18 * 60,
    Math.min(12 * 60, Math.max(0, anchor - 130)),
  );
  const sets = MOCK_STAGES.flatMap((stage) =>
    [-2, -1, 0, 1, 2, 3].flatMap((offset, index) => {
      const start = anchor + offset * 60;
      const end = start + 50;
      if (start < dayStart || end > dayEnd) return [];
      return [
        {
          stageId: stage.id,
          artist: stage.artists[index],
          startsAt: iso(start),
          endsAt: iso(end),
          offset,
        },
      ];
    }),
  );
  return {
    day: { date, startsAt: iso(dayStart), endsAt: iso(dayEnd) },
    stages: MOCK_STAGES.map(({ id, name, order }) => ({ id, name, order })),
    sets,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function seedZones() {
  return ZONES.map((zone, index) => {
    const [x, y, w, h] = zone.rect;
    return {
      id: zone.id,
      name: zone.name,
      kind: zone.kind,
      order: index + 1,
      x: round((x + w / 2) / MAP_WIDTH),
      y: round((y + h / 2) / MAP_HEIGHT),
      area: {
        x: round(x / MAP_WIDTH),
        y: round(y / MAP_HEIGHT),
        w: round(w / MAP_WIDTH),
        h: round(h / MAP_HEIGHT),
      },
      landmark: 'landmark' in zone ? zone.landmark : null,
    };
  });
}

export function seedMapStages(stageIds: string[]) {
  return stageIds.slice(0, STAGE_HEADERS.length).map((stageId, index) => {
    const [x, y, w] = STAGE_HEADERS[index];
    return {
      stageId,
      x: round(x / MAP_WIDTH),
      y: round(y / MAP_HEIGHT),
      w: round(w / MAP_WIDTH),
    };
  });
}

/** 409 응답 본문의 필드. 이미 만든 크루·이미 가입한 크루원을 다시 쓰는 데 쓴다. */
function conflictField(error: unknown, field: string): string | undefined {
  if (!(error instanceof HttpException) || error.getStatus() !== 409)
    return undefined;
  const body = error.getResponse();
  const value =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)[field]
      : undefined;
  return typeof value === 'string' ? value : undefined;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const liveToday = process.argv.includes('--live-today');
  const memberEmail = argument('--member-email');
  if (!liveToday && !argument('--festival'))
    throw new Error('--festival <fst_...> 또는 --live-today가 필요합니다.');
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'develop')
    throw new Error('Railway develop 환경에서만 실행합니다.');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = app.get(DataSource);
    const festivals = app.get(AdminFestivalService);
    const flagsService = app.get(FlagsService);
    const crews = app.get(CrewService);
    const ownerEmail = process.env.ADMIN_OWNER_EMAIL?.toLowerCase();
    const admin = await db.getRepository(AdminAccount).findOne({
      where: { email: ownerEmail ?? '', active: true },
    });
    if (!admin) throw new Error('활성 owner 관리자 계정을 찾을 수 없습니다.');

    const festivalRepo = db.getRepository(AdminFestival);
    const source = await festivalRepo.findOne({
      where: { id: IMAGE_SOURCE_FESTIVAL },
    });
    const images = [
      ...new Set(
        (Array.isArray(source?.published?.sets) ? source.published.sets : [])
          .map((set: { imageUrl?: unknown }) => set.imageUrl)
          .filter(
            (url): url is string =>
              typeof url === 'string' &&
              /^\/api\/v1\/festivals\/images\/[0-9a-f-]{36}\.webp$/.test(url),
          ),
      ),
    ];
    const plan = liveTodayPlan(new Date());
    let festivalId = argument('--festival') ?? '';
    if (liveToday) {
      const existing = await festivalRepo
        .createQueryBuilder('festival')
        .where(`festival.draft ->> 'name' = :name`, {
          name: MOCK_FESTIVAL_NAME,
        })
        .getOne();
      festivalId =
        existing?.id ??
        String(
          (
            (await festivals.create(
              {
                name: MOCK_FESTIVAL_NAME,
                venue: 'KINTEX 제2전시장',
                days: [plan.day],
              },
              admin.id,
            )) as Record<string, unknown>
          ).id,
        );
    }

    // 1. 존 지도(·오늘 일정) 초안 → 발행
    const draft = (await festivals.getDraft(festivalId)) as Record<
      string,
      unknown
    >;
    const stageIds = liveToday
      ? plan.stages.map((stage) => stage.id)
      : (Array.isArray(draft.stages) ? draft.stages : [])
          .map((stage: { id?: unknown }) => stage.id)
          .filter((id): id is string => typeof id === 'string');
    const sets = plan.sets.map((set, index) => ({
      stageId: set.stageId,
      artist: set.artist,
      startsAt: set.startsAt,
      endsAt: set.endsAt,
      imageUrl: images.length > 0 ? images[index % images.length] : null,
    }));
    const patched = (await festivals.patch(
      festivalId,
      {
        flagsEnabled: true,
        zones: seedZones(),
        mapAspect: round(MAP_WIDTH / MAP_HEIGHT),
        mapStages: seedMapStages(stageIds),
        ...(liveToday ? { days: [plan.day], stages: plan.stages, sets } : {}),
      },
      `"d${String(draft.draftVersion)}"`,
      admin.id,
    )) as Record<string, unknown>;
    await festivals.publish(
      festivalId,
      'S06 존 지도 개발 목 데이터',
      `"d${String(patched.draftVersion)}"`,
      admin.id,
    );

    // 2. 목 기수 사용자와 깃발
    const users = db.getRepository(User);
    const mockUser = async (key: string, nickname: string) => {
      const providerId = `seed-zone-map-${festivalId}-${key}`;
      const existing = await users.findOne({
        where: { provider: 'google', providerId },
      });
      if (existing) return existing;
      return users.save(
        users.create({
          provider: 'google',
          providerId,
          email: null,
          nickname,
          nicknameConfirmed: true,
          nicknameExplicitlySet: true,
        }),
      );
    };
    const flagRepo = db.getRepository(Flag);
    const flagIds = new Map<string, string>();
    for (const item of FLAGS) {
      const bearer = await mockUser(`flag-${item.key}`, item.name);
      let flag = await flagRepo.findOne({
        where: { festivalId, ownerId: bearer.id },
      });
      if (!flag) {
        const {
          codes: [code],
        } = await flagsService.createCodes(
          festivalId,
          { count: 1, label: 'seed-zone-map' },
          admin.id,
        );
        const claimed = await flagsService.claim(
          bearer.id,
          { code: code.code, festivalId },
          { deviceId: randomUUID(), ip: '127.0.0.1' },
        );
        flag = await flagRepo.findOneOrFail({ where: { id: claimed.flagId } });
      }
      await flagsService.patch(flag.id, bearer.id, {
        name: item.name,
        tags: [item.activity],
        homeZoneId: item.zoneId,
      });
      await flagsService.forceStatus(flag.id, admin.id, {
        status: item.status,
        zoneId: item.zoneId,
        activity: item.status === 'resting' ? 'resting' : item.activity,
      });
      // 깃발 사진 업로드 대신 보관된 출연진 이미지를 썸네일로 다시 쓴다.
      const image = images[flagIds.size % Math.max(images.length, 1)];
      if (image) {
        await flagRepo.update(flag.id, { thumbUrl: image, photoUrl: image });
        await app.get(FlagPackSyncService).sync(flag.id);
      }
      flagIds.set(item.key, flag.id);
    }

    // 3. 개발 계정의 팔로우와 크루
    let crewId: string | null = null;
    if (memberEmail) {
      const member = await users.findOne({
        where: { email: memberEmail.toLowerCase() },
      });
      if (!member) throw new Error('--member-email 계정을 찾을 수 없습니다.');
      // 축제마다 깃발 ID가 달라서 멱등 키에 축제 ID를 넣는다.
      for (const item of FLAGS.filter((flag) => flag.followed))
        await flagsService.follow(
          flagIds.get(item.key)!,
          member.id,
          `seed-zone-map-follow-${festivalId}-${item.key}`,
        );
      const owned = (await crews
        .create(member.id, { festivalId, name: '존 지도 목 크루' })
        .catch(async (error: unknown) => {
          const existing = conflictField(error, 'crewId');
          if (!existing) throw error;
          return crews.detail(existing, member.id);
        })) as { id: string; inviteCode: string | null };
      crewId = owned.id;
      for (const item of CREW_MEMBERS) {
        const mate = await mockUser(`crew-${item.key}`, item.nickname);
        if (owned.inviteCode)
          await crews
            .join(mate.id, {
              inviteCode: owned.inviteCode,
              nickname: item.nickname,
            })
            .catch((error: unknown) => {
              if (conflictField(error, 'code') !== 'CREW_ALREADY_IN')
                throw error;
            });
        await crews.status(crewId, mate.id, {
          zoneId: item.zoneId,
          state: item.state,
          clientAt: new Date().toISOString(),
        });
      }
      await crews.status(crewId, member.id, {
        zoneId: MEMBER_ZONE,
        state: 'here',
        clientAt: new Date().toISOString(),
      });
      // 내 다음 일정 카드: 무대마다 다음 공연을 내 일정에 저장한다.
      if (liveToday)
        await app.get(ScheduleService).replace(member.id, festivalId, {
          setIds: plan.sets
            .filter((set) => set.offset === 1)
            .map((set) =>
              festivalSetId({
                stageId: set.stageId,
                artist: set.artist,
                startsAt: set.startsAt,
                endsAt: set.endsAt,
              }),
            ),
          clientAt: new Date().toISOString(),
        });
    }

    // 4. 깃발 썸네일·상태까지 담아 팩 버전을 올린다.
    const latest = (await festivals.getDraft(festivalId)) as Record<
      string,
      unknown
    >;
    await festivals.publish(
      festivalId,
      '개발 목 데이터 갱신',
      `"d${String(latest.draftVersion)}"`,
      admin.id,
    );
    console.log(
      JSON.stringify({
        festivalId,
        zones: ZONES.length,
        flags: [...flagIds.values()],
        crewId,
      }),
    );
  } finally {
    await app.close();
  }
}

if (require.main === module)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
