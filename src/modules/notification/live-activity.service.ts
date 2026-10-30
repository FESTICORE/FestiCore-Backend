import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { festivalSetId } from '../admin/festival/festival-set-id';
import { ApnsService } from './apns.service';
import {
  buildLiveActivityContentState,
  type LiveActivityCrew,
  type LiveActivityFlag,
  type LiveActivityMember,
  type LiveActivitySet,
} from './live-activity-content';

const POLL_MS = 15_000;
const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 30;

interface Job {
  deviceId: string;
  revision: string;
  leaseId: string;
  leaseUntil: Date;
}

interface RefreshIntent {
  id: string;
  deviceId: string;
  activityId: string;
  festivalId: string;
}

interface DeviceTarget {
  userId: string | null;
  liveActivityFestivalId: string | null;
  liveActivityId: string | null;
  liveActivityPushToken: string | null;
  apnsEnvironment: 'sandbox' | 'production' | null;
}

interface FestivalTarget {
  published: Record<string, unknown>;
}

export function festivalPeriod(
  days: Record<string, unknown>[],
): { start: Date; end: Date } | null {
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  if (typeof first !== 'string' || typeof last !== 'string') return null;
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  };
  if (!validDate(first) || !validDate(last) || last < first) return null;
  const start = new Date(`${first}T00:00:00+09:00`);
  const calendarEnd = Date.parse(`${last}T00:00:00+09:00`) + 86_400_000;
  const actualEnd = Math.max(
    calendarEnd,
    ...days
      .map((day) =>
        typeof day.endsAt === 'string' ? Date.parse(day.endsAt) : NaN,
      )
      .filter(Number.isFinite),
  );
  const end = new Date(actualEnd);
  return { start, end };
}

export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

export function publishedSets(
  pack: Record<string, unknown>,
  festivalId: string,
): LiveActivitySet[] {
  return records(pack.sets).flatMap((set) =>
    typeof set.stageId === 'string' &&
    typeof set.artist === 'string' &&
    typeof set.startsAt === 'string'
      ? [
          {
            id: festivalSetId(set),
            festivalId,
            stageId: set.stageId,
            artist: set.artist,
            startsAt: set.startsAt,
            endsAt: typeof set.endsAt === 'string' ? set.endsAt : null,
          },
        ]
      : [],
  );
}

function nextBoundary(
  sets: LiveActivitySet[],
  member: LiveActivityMember | null,
  days: Record<string, unknown>[],
  festival: { start: Date; end: Date },
  now: Date,
): Date | null {
  const future = [
    festival.start.getTime(),
    festival.end.getTime(),
    ...sets
      .flatMap((set) => [set.startsAt, set.endsAt])
      .filter((value): value is string => value !== null)
      .map((value) => Date.parse(value)),
  ];
  for (const day of days) {
    if (typeof day.startsAt !== 'string' || typeof day.endsAt !== 'string')
      continue;
    const start = Date.parse(day.startsAt);
    const end = Date.parse(day.endsAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      future.push(end - 60 * 60_000);
    }
  }
  if (member?.crew?.gather && !member.crew.archived) {
    future.push(Date.parse(member.crew.gather.at) + 10 * 60_000);
  }
  const next = Math.min(
    ...future.filter((time) => Number.isFinite(time) && time > now.getTime()),
  );
  return Number.isFinite(next) ? new Date(next) : null;
}

/** Committed refresh intents are materialized into one durable delivery per device. */
@Injectable()
export class LiveActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveActivityService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DataSource,
    private readonly apns: ApnsService,
  ) {}

  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueueDevice(
    deviceId: string,
    manager: EntityManager = this.db.manager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "live_activity_deliveries" ("deviceId")
      SELECT "id" FROM "devices" WHERE "id" = $1
        AND "liveActivityPushToken" IS NOT NULL
        AND "liveActivityId" IS NOT NULL
        AND "liveActivityFestivalId" IS NOT NULL
      ON CONFLICT ("deviceId") DO UPDATE SET
        "revision" = "live_activity_deliveries"."revision" + 1,
        "active" = true, "status" = 'pending', "leaseId" = NULL,
        "leaseUntil" = NULL, "nextAttemptAt" = now(), "attempts" = 0,
        "lastErrorCode" = NULL, "updatedAt" = now()`,
      [deviceId],
    );
  }

  async enqueueFestival(
    festivalId: string,
    manager: EntityManager = this.db.manager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "live_activity_refresh_intents" ("deviceId", "activityId", "festivalId")
      SELECT "id", "liveActivityId", "liveActivityFestivalId" FROM "devices" WHERE "liveActivityFestivalId" = $1
        AND "liveActivityPushToken" IS NOT NULL AND "liveActivityId" IS NOT NULL
      ORDER BY "id" FOR KEY SHARE SKIP LOCKED`,
      [festivalId],
    );
  }

  async enqueueUser(
    userId: string,
    festivalId?: string,
    manager: EntityManager = this.db.manager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "live_activity_refresh_intents" ("deviceId", "activityId", "festivalId")
      SELECT "id", "liveActivityId", "liveActivityFestivalId" FROM "devices" WHERE "userId" = $1
        AND ($2::varchar IS NULL OR "liveActivityFestivalId" = $2)
        AND "liveActivityPushToken" IS NOT NULL
        AND "liveActivityFestivalId" IS NOT NULL AND "liveActivityId" IS NOT NULL
      ORDER BY "id" FOR KEY SHARE SKIP LOCKED`,
      [userId, festivalId ?? null],
    );
  }

  async enqueueCrewMembers(
    crewId: string,
    festivalId: string,
    manager: EntityManager = this.db.manager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "live_activity_refresh_intents" ("deviceId", "activityId", "festivalId")
      SELECT d."id", d."liveActivityId", d."liveActivityFestivalId" FROM "crew_members" m
      JOIN "devices" d ON d."userId" = m."userId"
      WHERE m."crewId" = $1 AND m."festivalId" = $2
        AND d."liveActivityFestivalId" = $2
        AND d."liveActivityPushToken" IS NOT NULL
        AND d."liveActivityId" IS NOT NULL
      ORDER BY d."id" FOR KEY SHARE OF d SKIP LOCKED`,
      [crewId, festivalId],
    );
  }

  async enqueueWithdrawalImpact(
    crewIds: string[],
    festivalIds: string[],
    manager: EntityManager,
  ): Promise<void> {
    if (!crewIds.length && !festivalIds.length) return;
    await manager.query(
      `INSERT INTO "live_activity_refresh_intents" ("deviceId", "activityId", "festivalId")
      SELECT d."id", d."liveActivityId", d."liveActivityFestivalId" FROM "devices" d
      WHERE d."liveActivityPushToken" IS NOT NULL
        AND d."liveActivityId" IS NOT NULL
        AND d."liveActivityFestivalId" IS NOT NULL
        AND (
          d."liveActivityFestivalId" = ANY($2::varchar[])
          OR EXISTS (
            SELECT 1 FROM "crew_members" m
            WHERE m."userId" = d."userId"
              AND m."festivalId" = d."liveActivityFestivalId"
              AND m."crewId" = ANY($1::varchar[])
          )
        )
      ORDER BY d."id" FOR KEY SHARE OF d SKIP LOCKED`,
      [crewIds, festivalIds],
    );
  }

  async enqueueCrewRemoval(
    crewId: string,
    removedUserId: string,
    festivalId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "live_activity_refresh_intents" ("deviceId", "activityId", "festivalId")
      SELECT d."id", d."liveActivityId", d."liveActivityFestivalId" FROM "devices" d
      WHERE d."liveActivityFestivalId" = $3
        AND d."liveActivityPushToken" IS NOT NULL
        AND d."liveActivityId" IS NOT NULL
        AND (
          d."userId" = $2
          OR EXISTS (
            SELECT 1 FROM "crew_members" m
            WHERE m."crewId" = $1 AND m."festivalId" = $3
              AND m."userId" = d."userId"
          )
        )
      ORDER BY d."id" FOR KEY SHARE OF d SKIP LOCKED`,
      [crewId, removedUserId, festivalId],
    );
  }

  async stopDevice(
    deviceId: string,
    manager: EntityManager = this.db.manager,
  ): Promise<void> {
    await manager.query(
      `UPDATE "live_activity_deliveries" SET
      "revision" = "revision" + 1, "active" = false, "status" = 'idle',
      "leaseId" = NULL, "leaseUntil" = NULL, "updatedAt" = now()
      WHERE "deviceId" = $1`,
      [deviceId],
    );
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < BATCH_SIZE; i++) {
        if (!(await this.materializeRefreshIntent())) break;
      }
      if (!this.apns.isConfigured()) return;
      for (let i = 0; i < BATCH_SIZE; i++) {
        const job = await this.claim();
        if (!job) break;
        try {
          await this.deliver(job);
        } catch {
          this.logger.error('Live Activity 업데이트 발송에 실패했습니다.');
          try {
            await this.recover(job);
          } catch {
            this.logger.error(
              'Live Activity 업데이트 재시도 예약에 실패했습니다.',
            );
          }
        }
      }
    } catch {
      this.logger.error('Live Activity 업데이트 작업 처리에 실패했습니다.');
    } finally {
      this.running = false;
    }
  }

  /** An intent is removed only in the transaction that updates its delivery. */
  async materializeRefreshIntent(): Promise<boolean> {
    return this.db.transaction(async (manager) => {
      const candidates = await manager.query<
        Array<Pick<RefreshIntent, 'id' | 'deviceId'>>
      >(
        `SELECT "id", "deviceId" FROM "live_activity_refresh_intents"
         ORDER BY "id" LIMIT 1`,
      );
      const candidate = candidates[0];
      if (!candidate) return false;

      // Device deletion cascades to intents. Lock the device first so the
      // materializer never holds an intent while waiting for that deletion.
      const devices = await manager.query<
        Array<{
          liveActivityId: string | null;
          liveActivityFestivalId: string | null;
          liveActivityPushToken: string | null;
        }>
      >(
        `SELECT "liveActivityId", "liveActivityFestivalId", "liveActivityPushToken"
         FROM "devices" WHERE "id" = $1 FOR NO KEY UPDATE`,
        [candidate.deviceId],
      );
      const intents = await manager.query<RefreshIntent[]>(
        `SELECT "id", "deviceId", "activityId", "festivalId"
         FROM "live_activity_refresh_intents" WHERE "id" = $1
         FOR UPDATE SKIP LOCKED`,
        [candidate.id],
      );
      const intent = intents[0];
      if (!intent) return false;
      const device = devices[0];
      if (
        device?.liveActivityId === intent.activityId &&
        device.liveActivityFestivalId === intent.festivalId &&
        device.liveActivityPushToken
      ) {
        await manager.query(
          `INSERT INTO "live_activity_deliveries" ("deviceId") VALUES ($1)
           ON CONFLICT ("deviceId") DO UPDATE SET
             "revision" = "live_activity_deliveries"."revision" + 1,
             "active" = true, "status" = 'pending', "leaseId" = NULL,
             "leaseUntil" = NULL, "nextAttemptAt" = now(), "attempts" = 0,
             "lastErrorCode" = NULL, "updatedAt" = now()`,
          [intent.deviceId],
        );
      }
      await manager.query(
        `DELETE FROM "live_activity_refresh_intents" WHERE "id" = $1`,
        [intent.id],
      );
      return true;
    });
  }

  /** 90 seconds between reservations covers up to 30 seconds before APNs begins. */
  async claim(): Promise<Job | null> {
    const leaseId = randomUUID();
    const rows = await this.db.query<Job[]>(
      `WITH due AS (
      SELECT "deviceId" FROM "live_activity_deliveries"
      WHERE "active" = true
        AND (("status" = 'pending' AND "nextAttemptAt" <= now())
          OR ("status" = 'leased' AND "leaseUntil" <= now()))
        AND ("lastAttemptAt" IS NULL OR "lastAttemptAt" <= now() - interval '90 seconds')
      ORDER BY "nextAttemptAt", "deviceId" LIMIT 1 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE "live_activity_deliveries" q SET
        "status" = 'leased', "leaseId" = $1,
        "leaseUntil" = now() + interval '2 minutes',
        "lastAttemptAt" = now(), "updatedAt" = now()
      FROM due WHERE q."deviceId" = due."deviceId"
      RETURNING q."deviceId", q."revision", q."leaseId", q."leaseUntil"
    ) SELECT * FROM claimed`,
      [leaseId],
    );
    return rows[0] ?? null;
  }

  async deliver(job: Job): Promise<void> {
    await this.db.transaction(async (manager) => {
      // Device writes take this lock before touching the queue. Keep the same
      // order here to avoid a deadlock with registration and stop.
      const targets = await manager.query<DeviceTarget[]>(
        `SELECT "userId",
        "liveActivityFestivalId", "liveActivityId", "liveActivityPushToken",
        "apnsEnvironment" FROM "devices" WHERE "id" = $1 FOR NO KEY UPDATE`,
        [job.deviceId],
      );
      const current = await manager.query<Array<{ revision: string }>>(
        `SELECT "revision"
        FROM "live_activity_deliveries" WHERE "deviceId" = $1
          AND "revision" = $2 AND "leaseId" = $3 AND "status" = 'leased'
          AND "leaseUntil" > now() AND "active" = true FOR UPDATE`,
        [job.deviceId, job.revision, job.leaseId],
      );
      if (!current.length) return;
      const target = targets[0];
      if (
        !target?.liveActivityFestivalId ||
        !target.liveActivityId ||
        !target.liveActivityPushToken ||
        !target.apnsEnvironment
      ) {
        await this.finish(manager, job, 'idle', 'TARGET_UNAVAILABLE');
        return;
      }
      const festivals = await manager.query<FestivalTarget[]>(
        `SELECT "published"
        FROM "admin_festivals" WHERE "id" = $1 AND "published" IS NOT NULL
          AND "publishedVersion" > 0`,
        [target.liveActivityFestivalId],
      );
      if (!festivals.length) {
        await this.finish(manager, job, 'idle', 'FESTIVAL_UNAVAILABLE');
        return;
      }
      const festivalId = target.liveActivityFestivalId;
      const pack = festivals[0].published;
      const days = records(pack.days);
      const festival = festivalPeriod(days);
      if (!festival) {
        await this.finish(
          manager,
          job,
          'idle',
          'FESTIVAL_SCHEDULE_UNAVAILABLE',
        );
        return;
      }
      const flags = await manager.query<LiveActivityFlag[]>(
        `SELECT "id", "festivalId",
        "status", "visibility", "hidden", "zoneId", "activity" FROM "flags"
        WHERE "festivalId" = $1 AND "visibility" = 'public' AND "hidden" = false`,
        [festivalId],
      );
      const member = target.userId
        ? await this.member(manager, target.userId, festivalId)
        : null;
      const now = new Date();
      const sets = publishedSets(pack, festivalId);
      const state = buildLiveActivityContentState({
        festivalId,
        now,
        festivalStart: festival.start,
        festivalEnd: festival.end,
        sets,
        flagsEnabled: pack.flagsEnabled === true,
        flags,
        member,
      });
      const boundary = nextBoundary(sets, member, days, festival, now);

      // A late send could approach lease expiry and defeat crash recovery's
      // persisted 90-second reservation. Requeue instead of attempting it.
      const reservation = await manager.query<Array<{ canSend: boolean }>>(
        `SELECT clock_timestamp() <= "lastAttemptAt" + interval '30 seconds' AS "canSend"
         FROM "live_activity_deliveries" WHERE "deviceId" = $1
           AND "revision" = $2 AND "leaseId" = $3`,
        [job.deviceId, job.revision, job.leaseId],
      );
      if (!reservation[0]?.canSend) {
        await manager.query(
          `UPDATE "live_activity_deliveries" SET
          "status" = 'pending', "leaseId" = NULL, "leaseUntil" = NULL,
          "nextAttemptAt" = now(), "updatedAt" = now()
          WHERE "deviceId" = $1 AND "revision" = $2 AND "leaseId" = $3`,
          [job.deviceId, job.revision, job.leaseId],
        );
        return;
      }

      let result: Awaited<ReturnType<ApnsService['sendLiveActivityUpdate']>>;
      const finished = state.phase === 'finished';
      try {
        result = finished
          ? await this.apns.sendLiveActivityEnd(
              target.liveActivityPushToken,
              target.apnsEnvironment,
              state,
            )
          : await this.apns.sendLiveActivityUpdate(
              target.liveActivityPushToken,
              target.apnsEnvironment,
              state,
            );
      } catch {
        await this.retryOrFail(manager, job, 'APNS_ERROR');
        return;
      }
      if (result.accepted) {
        if (finished) {
          await manager.query(
            `UPDATE "devices" SET "liveActivityPushToken" = NULL
            WHERE "id" = $1 AND "liveActivityPushToken" = $2
              AND "liveActivityId" = $3`,
            [job.deviceId, target.liveActivityPushToken, target.liveActivityId],
          );
        }
        await this.finish(
          manager,
          job,
          finished || !boundary ? 'idle' : 'pending',
          null,
          boundary,
        );
      } else if (result.permanent) {
        await manager.query(
          `UPDATE "devices" SET "liveActivityPushToken" = NULL
          WHERE "id" = $1 AND "liveActivityPushToken" = $2
            AND "liveActivityId" = $3`,
          [job.deviceId, target.liveActivityPushToken, target.liveActivityId],
        );
        await this.finish(
          manager,
          job,
          'failed',
          result.reason ?? 'APNS_REJECTED',
        );
      } else {
        await this.retryOrFail(manager, job, result.reason ?? 'APNS_REJECTED');
      }
    });
  }

  private async member(
    manager: EntityManager,
    userId: string,
    festivalId: string,
  ): Promise<LiveActivityMember | null> {
    const users = await manager.query<Array<{ id: string }>>(
      'SELECT "id" FROM "users" WHERE "id" = $1',
      [userId],
    );
    if (!users.length) return null;
    const schedules = await manager.query<Array<{ setIds: unknown }>>(
      'SELECT "setIds" FROM "user_schedules" WHERE "userId" = $1 AND "festivalId" = $2',
      [userId, festivalId],
    );
    const follows = await manager.query<Array<{ flagId: string }>>(
      'SELECT "flagId" FROM "flag_follows" WHERE "userId" = $1 AND "festivalId" = $2',
      [userId, festivalId],
    );
    const pins = await manager.query<Array<{ flagId: string | null }>>(
      'SELECT "flagId" FROM "flag_pins" WHERE "userId" = $1',
      [userId],
    );
    const crews = await manager.query<
      Array<{ id: string; name: string; archivedAt: Date | null }>
    >(
      `SELECT c."id", c."name", c."archivedAt" FROM "crew_members" m
       JOIN "crews" c ON c."id" = m."crewId" AND c."festivalId" = m."festivalId"
       WHERE m."userId" = $1 AND m."festivalId" = $2`,
      [userId, festivalId],
    );
    let crew: LiveActivityCrew | null = null;
    if (crews[0]) {
      const row = crews[0];
      const members = await manager.query<
        Array<{ state: LiveActivityCrew['members'][number]['state'] }>
      >('SELECT "state" FROM "crew_members" WHERE "crewId" = $1', [row.id]);
      const gathers = await manager.query<
        Array<{ zoneId: string; createdAt: Date }>
      >(
        'SELECT "zoneId", "createdAt" FROM "crew_gathers" WHERE "crewId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
        [row.id],
      );
      crew = {
        id: row.id,
        festivalId,
        name: row.name,
        archived: row.archivedAt !== null,
        members,
        gather: gathers[0]
          ? {
              zoneId: gathers[0].zoneId,
              at: gathers[0].createdAt.toISOString(),
            }
          : null,
      };
    }
    return {
      savedSetIds: Array.isArray(schedules[0]?.setIds)
        ? schedules[0].setIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : [],
      followedFlagIds: follows.map((row) => row.flagId),
      pinnedFlagId: pins[0]?.flagId ?? null,
      crew,
    };
  }

  private async finish(
    manager: EntityManager,
    job: Job,
    status: 'idle' | 'pending' | 'failed',
    reason: string | null,
    boundary: Date | null = null,
  ): Promise<void> {
    await manager.query(
      `UPDATE "live_activity_deliveries" SET "status" = $4::varchar,
      "active" = CASE WHEN $4::varchar = 'failed' THEN false ELSE "active" END,
      "leaseId" = NULL, "leaseUntil" = NULL,
      "attempts" = CASE WHEN $5::varchar IS NULL THEN 0 ELSE "attempts" + 1 END,
      "lastErrorCode" = $5::varchar,
      "nextAttemptAt" = COALESCE($6::timestamptz, "nextAttemptAt"),
      "updatedAt" = now()
      WHERE "deviceId" = $1 AND "revision" = $2 AND "leaseId" = $3`,
      [
        job.deviceId,
        job.revision,
        job.leaseId,
        status,
        reason?.slice(0, 128) ?? null,
        boundary,
      ],
    );
  }

  private async retryOrFail(
    manager: EntityManager,
    job: Job,
    reason: string,
  ): Promise<void> {
    const rows = await manager.query<Array<{ attempts: number }>>(
      'SELECT "attempts" FROM "live_activity_deliveries" WHERE "deviceId" = $1',
      [job.deviceId],
    );
    const attempts = Number(rows[0]?.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.finish(manager, job, 'failed', reason);
      return;
    }
    const minutes = Math.min(2 ** attempts, 30);
    await manager.query(
      `UPDATE "live_activity_deliveries" SET
      "status" = 'pending', "attempts" = "attempts" + 1,
      "nextAttemptAt" = now() + ($4 * interval '1 minute'),
      "leaseId" = NULL, "leaseUntil" = NULL,
      "lastErrorCode" = $5, "updatedAt" = now()
      WHERE "deviceId" = $1 AND "revision" = $2 AND "leaseId" = $3`,
      [job.deviceId, job.revision, job.leaseId, minutes, reason.slice(0, 128)],
    );
  }

  private async recover(job: Job): Promise<void> {
    await this.db.query(
      `UPDATE "live_activity_deliveries" SET
        "status" = CASE WHEN "attempts" + 1 >= $4 THEN 'failed' ELSE 'pending' END,
        "active" = CASE WHEN "attempts" + 1 >= $4 THEN false ELSE "active" END,
        "attempts" = "attempts" + 1,
        "nextAttemptAt" = now() + interval '2 minutes',
        "leaseId" = NULL, "leaseUntil" = NULL,
        "lastErrorCode" = 'DELIVERY_ERROR', "updatedAt" = now()
        WHERE "deviceId" = $1 AND "revision" = $2 AND "leaseId" = $3
          AND "status" = 'leased'`,
      [job.deviceId, job.revision, job.leaseId, MAX_ATTEMPTS],
    );
  }
}
