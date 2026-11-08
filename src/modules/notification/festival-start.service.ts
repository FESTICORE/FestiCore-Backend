import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ApnsService } from './apns.service';
import { buildDeeplink } from './deeplink';
import { buildLiveActivityContentState } from './live-activity-content';
import {
  recordUserNotifications,
  UserNotificationEntry,
} from './user-notification.service';
import {
  festivalPeriod,
  publishedSets,
  records,
} from './live-activity.service';

const POLL_MS = 60_000;
const BATCH_SIZE = 100;
const SEND_CONCURRENCY = 10;
const MAX_ATTEMPTS = 6;
const LATE_GRACE_MS = 2 * 60 * 60_000;

interface PublishedRow {
  id: string;
  name: string;
  days: unknown;
  sets: unknown;
}

interface SavedScheduleRow {
  userId: string;
  festivalId: string;
  setIds: unknown;
}

interface Day {
  date: string;
  startsAt: string;
}

interface Delivery {
  id: string;
  deviceId: string;
  festivalId: string;
  eventKey: string;
  scheduledAt: Date;
  leaseUntil: Date;
  attempts: number;
}

interface DeliveryTarget {
  ownerUserId: string | null;
  apnsToken: string | null;
  liveActivityPushToStartToken: string | null;
  liveActivityId: string | null;
  hasCurrentActivity: boolean;
  apnsEnvironment: 'sandbox' | 'production' | null;
  name: string | null;
  days: unknown;
  publishedVersion: number;
  checklist: unknown;
  packDownloadedVersion: number | null;
  published: Record<string, unknown>;
  savedSetIds: unknown;
  hasActiveSession: boolean;
}

interface SetReminderTarget {
  ownerUserId: string | null;
  apnsToken: string | null;
  apnsEnvironment: 'sandbox' | 'production' | null;
  notifySetReminders: boolean;
  hasActiveSession: boolean;
  name: string | null;
  published: Record<string, unknown>;
  savedSetIds: unknown;
  liveActivityStatus: string | null;
  liveActivityErrorCode: string | null;
  liveActivityScheduledAt: Date | null;
}

interface SetReminderPlan {
  festivalId: string;
  setId: string;
  scheduledAt: Date;
}

const REMINDER_PREFIX = 'festival-reminder:';
const LIVE_START_PREFIX = 'live-activity-start:';
const PERFORMANCE_START_PREFIX = 'live-activity-performance:';
const SET_REMINDER_PREFIX = 'set-reminder:';
const PERFORMANCE_LEAD_MS = 2 * 60 * 60_000;
/** 같은 시각 공연 push-to-start의 결과를 기다리는 최대 시간. 지나면 알림 푸시를 보낸다. */
const LIVE_ACTIVITY_WAIT_MS = 5 * 60_000;
const EVENT_KEY_MAX_LENGTH = 96;
/**
 * 기기에 지금 보이는 Live Activity가 없다고 볼 조건.
 * 서버가 종료했거나 APNs가 토큰을 거절하면 토큰만 지워지고 ID가 남고,
 * iOS는 활동을 최대 8시간만 유지하므로 그보다 오래된 등록도 끝난 활동으로 본다.
 */
const NO_CURRENT_ACTIVITY = `(d."liveActivityId" IS NULL
  OR d."liveActivityPushToken" IS NULL
  OR d."liveActivityRegisteredAt" IS NULL
  OR d."liveActivityRegisteredAt" <= now() - interval '8 hours')`;

function liveActivityStartAt(days: Day[]): Date | null {
  const first = [...days].sort((left, right) =>
    left.date.localeCompare(right.date),
  )[0];
  return first ? new Date(first.startsAt) : null;
}

function reminderAt(days: Day[]): Date | null {
  const firstDate = days.map((day) => day.date).sort()[0];
  if (!firstDate) return null;
  const start = new Date(`${firstDate}T09:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== firstDate
  )
    return null;
  return new Date(start.getTime() - 24 * 60 * 60_000);
}

function checklistSummary(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const labels = value
    .filter(
      (item): item is { label: string } =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as { label?: unknown }).label === 'string',
    )
    .map((item) => item.label.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 3);
  return labels.length ? ` ${labels.join(', ')} 챙기세요.` : '';
}

function stageName(
  published: Record<string, unknown>,
  stageId: string,
): string | null {
  const stage = records(published.stages).find((item) => item.id === stageId);
  const name = typeof stage?.name === 'string' ? stage.name.trim() : '';
  return name || null;
}

function setReminderBody(artist: string, stage: string | null): string {
  if (!stage) return `${artist} 공연이 2시간 후 시작돼요.`;
  const place = stage.endsWith('무대') ? stage : `${stage} 무대`;
  return `${artist} 공연이 2시간 후 ${place}에서 시작돼요.`;
}

function validDays(value: unknown): Day[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (day): day is Day =>
      day !== null &&
      typeof day === 'object' &&
      typeof (day as Day).date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test((day as Day).date) &&
      typeof (day as Day).startsAt === 'string' &&
      Number.isFinite(Date.parse((day as Day).startsAt)),
  );
}

/** Published festival days create durable jobs; each instance may safely poll the same table. */
@Injectable()
export class FestivalStartService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FestivalStartService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private warnedMissingConfig = false;

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

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.schedulePublished(now);
      if (!this.apns.isConfigured()) {
        if (!this.warnedMissingConfig) {
          this.logger.warn(
            'APNs 설정이 없어 축제 시작 알림 발송을 보류합니다.',
          );
          this.warnedMissingConfig = true;
        }
        return;
      }
      this.warnedMissingConfig = false;
      for (let i = 0; i < BATCH_SIZE; i += SEND_CONCURRENCY) {
        const outcomes = await Promise.allSettled(
          Array.from({ length: SEND_CONCURRENCY }, () => this.claim()),
        );
        const claimed: Delivery[] = [];
        for (const outcome of outcomes) {
          if (outcome.status === 'fulfilled' && outcome.value) {
            claimed.push(outcome.value);
          } else if (outcome.status === 'rejected') {
            this.logger.error('축제 시작 알림 작업 선점에 실패했습니다.');
          }
        }
        if (!claimed.length) break;
        const deliveries = await Promise.allSettled(
          claimed.map((job) => this.deliver(job, new Date())),
        );
        for (const outcome of deliveries) {
          if (outcome.status === 'rejected') {
            this.logger.error('축제 시작 알림 작업 처리에 실패했습니다.');
          }
        }
        if (claimed.length < SEND_CONCURRENCY) break;
      }
    } catch {
      this.logger.error('축제 시작 알림 스케줄러 실행에 실패했습니다.');
    } finally {
      this.running = false;
    }
  }

  async schedulePublished(now = new Date()): Promise<void> {
    const rows = await this.db.query<PublishedRow[]>(`
      SELECT "id", "published"->>'name' AS "name", "published"->'days' AS "days",
        "published"->'sets' AS "sets"
      FROM "admin_festivals"
      WHERE "published" IS NOT NULL AND "publishedVersion" > 0`);
    const eligibleSets = new Map<string, Map<string, Date>>();
    for (const row of rows) {
      const days = validDays(row.days);
      const reminder = reminderAt(days);
      if (reminder && reminder.getTime() >= now.getTime() - LATE_GRACE_MS) {
        await this.db.query(
          `INSERT INTO "notification_deliveries"
            ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
           SELECT gen_random_uuid(), s."deviceId", $1::varchar, $2::varchar, $3::timestamptz, $3::timestamptz
           FROM "device_subscriptions" s
           JOIN "devices" d ON d."id" = s."deviceId"
           WHERE s."festivalId" = $1 AND s."pinned" = true AND s."reminders" = true
             AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
           ON CONFLICT ("deviceId", "eventKey") DO UPDATE
             SET "scheduledAt" = EXCLUDED."scheduledAt",
                 "nextAttemptAt" = EXCLUDED."nextAttemptAt",
                 "status" = 'pending', "leaseUntil" = NULL
           WHERE "notification_deliveries"."status" = 'cancelled'
              OR ("notification_deliveries"."status" = 'pending'
                  AND "notification_deliveries"."scheduledAt" <> EXCLUDED."scheduledAt")`,
          [row.id, `${REMINDER_PREFIX}${row.id}`, reminder],
        );
      }
      for (const day of days) {
        const startsAt = new Date(day.startsAt);
        if (startsAt.getTime() < now.getTime() - LATE_GRACE_MS) continue;
        const eventKey = `festival-start:${row.id}:${day.date}`;
        await this.db.query(
          `INSERT INTO "notification_deliveries"
            ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
           SELECT gen_random_uuid(), s."deviceId", $1::varchar, $2::varchar, $3::timestamptz, $3::timestamptz
           FROM "device_subscriptions" s
           JOIN "devices" d ON d."id" = s."deviceId"
           WHERE s."festivalId" = $1 AND s."pinned" = true
             AND s."festivalStarts" = true
             AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
           ON CONFLICT ("deviceId", "eventKey") DO UPDATE
             SET "scheduledAt" = EXCLUDED."scheduledAt",
                 "nextAttemptAt" = EXCLUDED."nextAttemptAt",
                 "status" = 'pending', "leaseUntil" = NULL
           WHERE "notification_deliveries"."status" = 'cancelled'
              OR ("notification_deliveries"."status" = 'pending'
                  AND "notification_deliveries"."scheduledAt" <> EXCLUDED."scheduledAt")`,
          [row.id, eventKey, startsAt],
        );
      }
      const firstStart = liveActivityStartAt(days);
      if (
        row.name &&
        firstStart &&
        firstStart.getTime() >= now.getTime() - LATE_GRACE_MS
      ) {
        await this.db.query(
          `INSERT INTO "notification_deliveries"
            ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
           SELECT gen_random_uuid(), s."deviceId", $1::varchar, $2::varchar, $3::timestamptz, $3::timestamptz
           FROM "device_subscriptions" s
           JOIN "devices" d ON d."id" = s."deviceId"
           WHERE s."festivalId" = $1 AND s."pinned" = true
             AND s."festivalStarts" = true
             AND d."liveActivityPushToStartToken" IS NOT NULL
             AND d."apnsEnvironment" IS NOT NULL
             AND ${NO_CURRENT_ACTIVITY}
             AND NOT EXISTS (
               SELECT 1 FROM "user_schedules" us
               WHERE us."userId" = d."userId" AND us."festivalId" = $1
                 AND jsonb_array_length(us."setIds") > 0
             )
           ON CONFLICT ("deviceId", "eventKey") DO UPDATE
             SET "scheduledAt" = EXCLUDED."scheduledAt",
                 "nextAttemptAt" = EXCLUDED."nextAttemptAt",
                 "status" = 'pending', "leaseUntil" = NULL
           WHERE "notification_deliveries"."status" = 'cancelled'
              AND "notification_deliveries"."lastErrorCode" IS DISTINCT FROM 'ACTIVITY_ALREADY_STARTED'
              OR ("notification_deliveries"."status" = 'pending'
                  AND "notification_deliveries"."scheduledAt" <> EXCLUDED."scheduledAt")`,
          [row.id, `${LIVE_START_PREFIX}${row.id}`, firstStart],
        );
      }
      const sets = new Map<string, Date>();
      for (const set of publishedSets({ sets: row.sets }, row.id)) {
        const start = Date.parse(set.startsAt);
        if (!Number.isFinite(start) || start <= now.getTime()) continue;
        const scheduledAt = new Date(start - PERFORMANCE_LEAD_MS);
        if (scheduledAt.getTime() < now.getTime() - LATE_GRACE_MS) continue;
        sets.set(set.id, scheduledAt);
      }
      if (sets.size) eligibleSets.set(row.id, sets);
    }
    if (!eligibleSets.size) return;
    const schedules = await this.db.query<SavedScheduleRow[]>(
      `SELECT "userId", "festivalId", "setIds" FROM "user_schedules"
       WHERE "festivalId" = ANY($1::varchar[])
         AND jsonb_array_length("setIds") > 0`,
      [[...eligibleSets.keys()]],
    );
    const plans = new Map<
      string,
      { userId: string; festivalId: string; setId: string; scheduledAt: Date }
    >();
    for (const schedule of schedules) {
      const festivalSets = eligibleSets.get(schedule.festivalId);
      if (!festivalSets || !Array.isArray(schedule.setIds)) continue;
      const starts = schedule.setIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => ({ id, date: festivalSets.get(id) }))
        .filter(
          (item): item is { id: string; date: Date } => item.date !== undefined,
        )
        .sort((left, right) => left.date.getTime() - right.date.getTime());
      if (!starts.length) continue;
      const scheduledAt = starts[0].date;
      const setId = starts[0].id;
      const key = `${schedule.userId}:${schedule.festivalId}`;
      const previous = plans.get(key);
      if (!previous || scheduledAt < previous.scheduledAt)
        plans.set(key, {
          userId: schedule.userId,
          festivalId: schedule.festivalId,
          setId,
          scheduledAt,
        });
    }
    if (plans.size)
      await this.db.query(
        `INSERT INTO "notification_deliveries"
           ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
         SELECT gen_random_uuid(), d."id", p."festivalId",
           'live-activity-performance:' || p."festivalId", p."scheduledAt", p."scheduledAt"
         FROM jsonb_to_recordset($1::jsonb) AS p("userId" uuid, "festivalId" varchar, "setId" text, "scheduledAt" timestamptz)
         JOIN "devices" d ON d."userId" = p."userId"
         JOIN "user_schedules" us ON us."userId" = p."userId"
           AND us."festivalId" = p."festivalId" AND us."setIds" ? p."setId"
         WHERE d."liveActivityPushToStartToken" IS NOT NULL
           AND d."apnsEnvironment" IS NOT NULL AND ${NO_CURRENT_ACTIVITY}
         ON CONFLICT ("deviceId", "eventKey") DO UPDATE
           SET "scheduledAt" = EXCLUDED."scheduledAt",
               "nextAttemptAt" = EXCLUDED."nextAttemptAt",
               "status" = 'pending', "leaseUntil" = NULL
         WHERE "notification_deliveries"."status" = 'cancelled'
            AND "notification_deliveries"."lastErrorCode" IS DISTINCT FROM 'ACTIVITY_ALREADY_STARTED'
            OR ("notification_deliveries"."status" = 'pending'
                AND "notification_deliveries"."scheduledAt" <> EXCLUDED."scheduledAt")`,
        [JSON.stringify([...plans.values()])],
      );
    await this.scheduleSetReminders(
      [...eligibleSets].flatMap(([festivalId, sets]) =>
        [...sets].map(([setId, scheduledAt]) => ({
          festivalId,
          setId,
          scheduledAt,
        })),
      ),
      this.db,
    );
  }

  async syncUserSchedule(
    userId: string,
    festivalId: string,
    setIds: string[],
    published: Record<string, unknown>,
    manager: EntityManager,
  ): Promise<void> {
    const now = new Date();
    const selected = publishedSets(published, festivalId)
      .filter(
        (set) =>
          setIds.includes(set.id) && Date.parse(set.startsAt) > now.getTime(),
      )
      .sort(
        (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
      );
    if (!selected.length) {
      await manager.query(
        `UPDATE "notification_deliveries" n SET "status" = 'cancelled',
           "leaseUntil" = NULL, "lastErrorCode" = 'SCHEDULE_CHANGED'
         FROM "devices" d
         WHERE n."deviceId" = d."id" AND d."userId" = $1
           AND n."festivalId" = $2 AND n."eventKey" = $3
           AND n."status" IN ('pending', 'leased')`,
        [userId, festivalId, `${PERFORMANCE_START_PREFIX}${festivalId}`],
      );
    }
    if (setIds.length) {
      await manager.query(
        `UPDATE "notification_deliveries" n SET "status" = 'cancelled',
           "leaseUntil" = NULL, "lastErrorCode" = 'SCHEDULE_CHANGED'
         FROM "devices" d
         WHERE n."deviceId" = d."id" AND d."userId" = $1
           AND n."festivalId" = $2 AND n."eventKey" = $3
           AND n."status" IN ('pending', 'leased')`,
        [userId, festivalId, `${LIVE_START_PREFIX}${festivalId}`],
      );
    }
    if (selected.length) {
      const set = selected[0];
      const start = Date.parse(set.startsAt);
      const scheduledAt = new Date(start - PERFORMANCE_LEAD_MS);
      if (scheduledAt.getTime() >= now.getTime() - LATE_GRACE_MS) {
        await this.schedulePerformanceStart(
          festivalId,
          set.id,
          scheduledAt,
          manager,
          userId,
        );
      }
    }
    await manager.query(
      `UPDATE "notification_deliveries" n SET "status" = 'cancelled',
         "leaseUntil" = NULL, "lastErrorCode" = 'SCHEDULE_CHANGED'
       FROM "devices" d
       WHERE n."deviceId" = d."id" AND d."userId" = $1
         AND n."festivalId" = $2 AND starts_with(n."eventKey", $3)
         AND NOT (n."eventKey" = ANY($4::varchar[]))
         AND n."status" IN ('pending', 'leased')`,
      [
        userId,
        festivalId,
        `${SET_REMINDER_PREFIX}${festivalId}:`,
        setIds.map((id) => `${SET_REMINDER_PREFIX}${festivalId}:${id}`),
      ],
    );
    await this.scheduleSetReminders(
      selected
        .map((set) => ({
          festivalId,
          setId: set.id,
          scheduledAt: new Date(Date.parse(set.startsAt) - PERFORMANCE_LEAD_MS),
        }))
        .filter(
          (plan) => plan.scheduledAt.getTime() >= now.getTime() - LATE_GRACE_MS,
        ),
      manager,
      userId,
    );
  }

  /**
   * 저장한 공연마다 알림을 켠 로그인 기기에 공연 2시간 전 작업을 1건씩 둔다.
   * push-to-start 배너와 겹쳐 건너뛴 작업은 다시 살리지 않는다.
   */
  private async scheduleSetReminders(
    plans: SetReminderPlan[],
    executor: DataSource | EntityManager,
    userId?: string,
  ): Promise<void> {
    const rows = plans.filter(
      (plan) =>
        `${SET_REMINDER_PREFIX}${plan.festivalId}:${plan.setId}`.length <=
        EVENT_KEY_MAX_LENGTH,
    );
    if (!rows.length) return;
    await executor.query(
      `INSERT INTO "notification_deliveries"
         ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
       SELECT gen_random_uuid(), d."id", p."festivalId",
         'set-reminder:' || p."festivalId" || ':' || p."setId",
         p."scheduledAt", p."scheduledAt"
       FROM jsonb_to_recordset($1::jsonb) AS p("festivalId" varchar, "setId" text, "scheduledAt" timestamptz)
       JOIN "user_schedules" us ON us."festivalId" = p."festivalId"
         AND us."setIds" ? p."setId"
       JOIN "devices" d ON d."userId" = us."userId"
       WHERE d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
         AND d."notifySetReminders" = true
         AND ($2::uuid IS NULL OR us."userId" = $2::uuid)
         AND EXISTS (
           SELECT 1 FROM "refresh_tokens" rt
           WHERE rt."userId" = d."userId" AND rt."revokedAt" IS NULL
             AND rt."expiresAt" > now()
         )
       ON CONFLICT ("deviceId", "eventKey") DO UPDATE
         SET "scheduledAt" = EXCLUDED."scheduledAt",
             "nextAttemptAt" = EXCLUDED."nextAttemptAt",
             "status" = 'pending', "leaseUntil" = NULL
       WHERE "notification_deliveries"."status" = 'cancelled'
          AND "notification_deliveries"."lastErrorCode" IS DISTINCT FROM 'LIVE_ACTIVITY_ALERTED'
          OR ("notification_deliveries"."status" = 'pending'
              AND "notification_deliveries"."scheduledAt" <> EXCLUDED."scheduledAt")`,
      [JSON.stringify(rows), userId ?? null],
    );
  }

  private async schedulePerformanceStart(
    festivalId: string,
    setId: string,
    scheduledAt: Date,
    executor: DataSource | EntityManager,
    userId?: string,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO "notification_deliveries"
         ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
       SELECT gen_random_uuid(), d."id", $1::varchar, $2::varchar,
         $3::timestamptz, $3::timestamptz
       FROM "devices" d
       JOIN "user_schedules" us ON us."userId" = d."userId"
         AND us."festivalId" = $1
       WHERE d."liveActivityPushToStartToken" IS NOT NULL
         AND d."apnsEnvironment" IS NOT NULL AND ${NO_CURRENT_ACTIVITY}
         AND us."setIds" ? $4::text
         AND ($5::uuid IS NULL OR d."userId" = $5::uuid)
       ON CONFLICT ("deviceId", "eventKey") DO UPDATE
         SET "scheduledAt" = EXCLUDED."scheduledAt",
             "nextAttemptAt" = EXCLUDED."nextAttemptAt",
             "status" = 'pending', "leaseUntil" = NULL
       WHERE "notification_deliveries"."status" = 'cancelled'
          AND "notification_deliveries"."lastErrorCode" IS DISTINCT FROM 'ACTIVITY_ALREADY_STARTED'
          OR ("notification_deliveries"."status" = 'pending'
              AND "notification_deliveries"."scheduledAt" <> EXCLUDED."scheduledAt")`,
      [
        festivalId,
        `${PERFORMANCE_START_PREFIX}${festivalId}`,
        scheduledAt,
        setId,
        userId ?? null,
      ],
    );
  }

  /**
   * One SQL statement claims a due job; SKIP LOCKED excludes concurrent workers.
   * TypeORM Postgres는 최상위 UPDATE에 [rows, rowCount]를 돌려주므로 SELECT로 감싸 행만 받는다.
   * 리스 시각은 JS Date와 같은 밀리초로 잘라 `"leaseUntil" = $2` 비교가 맞게 한다.
   */
  async claim(): Promise<Delivery | null> {
    const jobs = await this.db.query<Delivery[]>(`
      WITH due AS (
        SELECT "id" FROM "notification_deliveries"
        WHERE (("status" = 'pending' AND "nextAttemptAt" <= now())
            OR ("status" = 'leased' AND "leaseUntil" <= now()))
        ORDER BY "nextAttemptAt", "id"
        LIMIT 1 FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE "notification_deliveries" n
        SET "status" = 'leased',
          "leaseUntil" = date_trunc('milliseconds', now() + interval '2 minutes')
        FROM due WHERE n."id" = due."id"
        RETURNING n."id", n."deviceId", n."festivalId", n."eventKey",
          n."scheduledAt", n."leaseUntil", n."attempts"
      ) SELECT * FROM claimed`);
    return jobs[0] ?? null;
  }

  async deliver(job: Delivery, now = new Date()): Promise<void> {
    if (job.eventKey.startsWith(`${SET_REMINDER_PREFIX}${job.festivalId}:`)) {
      await this.deliverSetReminder(job, now);
      return;
    }
    const performanceStart =
      job.eventKey === `${PERFORMANCE_START_PREFIX}${job.festivalId}`;
    const liveStart =
      performanceStart ||
      job.eventKey === `${LIVE_START_PREFIX}${job.festivalId}`;
    const packUpdate = job.eventKey.startsWith(
      `pack-updated:${job.festivalId}:`,
    );
    const reminder = job.eventKey === `${REMINDER_PREFIX}${job.festivalId}`;
    const subscriptionFlag = packUpdate
      ? 'packUpdates'
      : reminder
        ? 'reminders'
        : 'festivalStarts';
    const rows = await this.db.query<DeliveryTarget[]>(
      `
      SELECT d."userId" AS "ownerUserId", d."apnsToken", d."liveActivityPushToStartToken",
        d."liveActivityId", d."apnsEnvironment",
        NOT ${NO_CURRENT_ACTIVITY} AS "hasCurrentActivity",
        f."published"->>'name' AS "name", f."published"->'days' AS "days",
        f."published"->'checklist' AS "checklist", f."published",
        f."publishedVersion" AS "publishedVersion",
        us."setIds" AS "savedSetIds",
        EXISTS (
          SELECT 1 FROM "refresh_tokens" rt
          WHERE rt."userId" = d."userId" AND rt."revokedAt" IS NULL
            AND rt."expiresAt" > now()
        ) AS "hasActiveSession",
        s."packDownloadedVersion" AS "packDownloadedVersion"
      FROM "notification_deliveries" n
      JOIN "devices" d ON d."id" = n."deviceId"
        ${packUpdate ? 'AND d."notifyPackUpdates" = true' : ''}
      LEFT JOIN "user_schedules" us ON us."userId" = d."userId"
        AND us."festivalId" = n."festivalId"
      ${
        performanceStart
          ? `LEFT JOIN "device_subscriptions" s ON s."deviceId" = n."deviceId"
             AND s."festivalId" = n."festivalId"`
          : `JOIN "device_subscriptions" s ON s."deviceId" = n."deviceId"
             AND s."festivalId" = n."festivalId" AND s."${subscriptionFlag}" = true
             ${packUpdate ? '' : 'AND s."pinned" = true'}`
      }
      JOIN "admin_festivals" f ON f."id" = n."festivalId"
        AND f."published" IS NOT NULL AND f."publishedVersion" > 0
      WHERE n."id" = $1 AND n."status" = 'leased'
        AND n."leaseUntil" = $2`,
      [job.id, job.leaseUntil],
    );
    const target = rows[0];
    if (liveStart) {
      await this.deliverLiveActivityStart(job, target, now, performanceStart);
      return;
    }
    if (packUpdate) {
      const expectedVersion = Number(
        job.eventKey.slice(`pack-updated:${job.festivalId}:`.length),
      );
      if (
        !target?.apnsToken ||
        !target.apnsEnvironment ||
        !Number.isSafeInteger(expectedVersion) ||
        Number(target.publishedVersion) !== expectedVersion
      ) {
        await this.finish(job, 'cancelled', 'TARGET_UNAVAILABLE');
        return;
      }
      await this.sendDelivery(job, () =>
        this.apns.sendPackUpdated(
          target.apnsToken!,
          target.apnsEnvironment!,
          job.festivalId,
          expectedVersion,
        ),
      );
      return;
    }
    if (reminder) {
      const currentReminder = reminderAt(validDays(target?.days));
      if (
        !target?.apnsToken ||
        !target.apnsEnvironment ||
        !target.name ||
        !currentReminder ||
        currentReminder.getTime() < now.getTime() - LATE_GRACE_MS
      ) {
        await this.finish(job, 'cancelled', 'TARGET_UNAVAILABLE');
        return;
      }
      if (currentReminder.getTime() !== new Date(job.scheduledAt).getTime()) {
        await this.db.query(
          `UPDATE "notification_deliveries"
           SET "status" = 'pending', "scheduledAt" = $3, "nextAttemptAt" = $3,
             "leaseUntil" = NULL, "lastErrorCode" = NULL
           WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
          [job.id, job.leaseUntil, currentReminder],
        );
        return;
      }
      const hasPack =
        target.packDownloadedVersion !== null &&
        Number(target.packDownloadedVersion) ===
          Number(target.publishedVersion);
      const title = `${target.name} 준비물`;
      const body = `준비물 확인했어요?${checklistSummary(target.checklist)}${hasPack ? '' : ' 지금 팩을 받아 두세요.'}`;
      await this.recordInbox(job, target, {
        type: 'festival.reminder',
        festivalId: job.festivalId,
        title,
        body,
        route: hasPack ? `/festivals/${job.festivalId}/checklist` : '/',
        subject: {},
      });
      await this.sendDelivery(job, () =>
        this.apns.sendReminderNotification(
          target.apnsToken!,
          target.apnsEnvironment!,
          {
            festivalId: job.festivalId,
            title,
            body,
            eventKey: job.eventKey,
            hasPack,
          },
        ),
      );
      return;
    }
    const date = job.eventKey.slice(`festival-start:${job.festivalId}:`.length);
    const day = validDays(target?.days).find((item) => item.date === date);
    const currentStart = day && new Date(day.startsAt);
    const scheduledAt = new Date(job.scheduledAt);
    if (
      !target?.apnsToken ||
      !target.apnsEnvironment ||
      !target.name ||
      !currentStart ||
      currentStart.getTime() < now.getTime() - LATE_GRACE_MS
    ) {
      await this.finish(job, 'cancelled', 'TARGET_UNAVAILABLE');
      return;
    }
    if (currentStart.getTime() !== scheduledAt.getTime()) {
      await this.db.query(
        `UPDATE "notification_deliveries"
         SET "status" = 'pending', "scheduledAt" = $3, "nextAttemptAt" = $3,
           "leaseUntil" = NULL, "lastErrorCode" = NULL
         WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
        [job.id, job.leaseUntil, currentStart],
      );
      return;
    }
    await this.recordInbox(job, target, {
      type: 'festival.start',
      festivalId: job.festivalId,
      title: `${target.name} 시작`,
      body: '페스티벌이 시작됐어요.',
      route: `/festivals/${job.festivalId}/live`,
      subject: {},
    });
    await this.sendDelivery(job, () =>
      this.apns.sendStartNotification(
        target.apnsToken!,
        target.apnsEnvironment!,
        {
          title: `${target.name} 시작`,
          body: '페스티벌이 시작됐어요.',
          eventKey: job.eventKey,
        },
      ),
    );
  }

  /** 알림함 기록 실패가 푸시 발송을 막지 않게 한다. 같은 eventKey는 계정당 한 번만 남는다. */
  private async recordInbox(
    job: Delivery,
    target: Pick<DeliveryTarget, 'ownerUserId'>,
    entry: Omit<UserNotificationEntry, 'dedupeKey'>,
  ): Promise<void> {
    if (!target.ownerUserId) return;
    try {
      await recordUserNotifications(this.db, [target.ownerUserId], {
        ...entry,
        dedupeKey: job.eventKey,
      });
    } catch {
      this.logger.error('축제 알림의 알림함 기록에 실패했습니다.');
    }
  }

  /**
   * 발송 직전에 저장·설정·세션과 공연 시각을 다시 확인한다.
   * 같은 기기에서 같은 공연 push-to-start가 이미 배너를 띄웠으면 알림 푸시는 보내지 않는다.
   */
  private async deliverSetReminder(job: Delivery, now: Date): Promise<void> {
    const setId = job.eventKey.slice(
      `${SET_REMINDER_PREFIX}${job.festivalId}:`.length,
    );
    const rows = await this.db.query<SetReminderTarget[]>(
      `SELECT d."userId" AS "ownerUserId", d."apnsToken", d."apnsEnvironment",
         d."notifySetReminders", f."published"->>'name' AS "name", f."published",
         us."setIds" AS "savedSetIds",
         EXISTS (
           SELECT 1 FROM "refresh_tokens" rt
           WHERE rt."userId" = d."userId" AND rt."revokedAt" IS NULL
             AND rt."expiresAt" > now()
         ) AS "hasActiveSession",
         la."status" AS "liveActivityStatus",
         la."lastErrorCode" AS "liveActivityErrorCode",
         la."scheduledAt" AS "liveActivityScheduledAt"
       FROM "notification_deliveries" n
       JOIN "devices" d ON d."id" = n."deviceId"
       JOIN "admin_festivals" f ON f."id" = n."festivalId"
         AND f."published" IS NOT NULL AND f."publishedVersion" > 0
       LEFT JOIN "user_schedules" us ON us."userId" = d."userId"
         AND us."festivalId" = n."festivalId"
       LEFT JOIN "notification_deliveries" la ON la."deviceId" = n."deviceId"
         AND la."eventKey" = $3
       WHERE n."id" = $1 AND n."status" = 'leased' AND n."leaseUntil" = $2`,
      [job.id, job.leaseUntil, `${PERFORMANCE_START_PREFIX}${job.festivalId}`],
    );
    const target = rows[0];
    const saved = Array.isArray(target?.savedSetIds) ? target.savedSetIds : [];
    const sets = publishedSets(target?.published ?? {}, job.festivalId);
    const set = saved.includes(setId)
      ? sets.find((item) => item.id === setId)
      : undefined;
    const startsAt = set ? Date.parse(set.startsAt) : NaN;
    const scheduledAt = new Date(startsAt - PERFORMANCE_LEAD_MS);
    if (
      !target?.apnsToken ||
      !target.apnsEnvironment ||
      !target.notifySetReminders ||
      !target.hasActiveSession ||
      !target.name ||
      !set ||
      !Number.isFinite(startsAt) ||
      startsAt <= now.getTime() ||
      scheduledAt.getTime() < now.getTime() - LATE_GRACE_MS
    ) {
      await this.finish(job, 'cancelled', 'TARGET_UNAVAILABLE');
      return;
    }
    if (scheduledAt.getTime() !== new Date(job.scheduledAt).getTime()) {
      await this.db.query(
        `UPDATE "notification_deliveries"
         SET "status" = 'pending', "scheduledAt" = $3, "nextAttemptAt" = $3,
           "leaseUntil" = NULL, "lastErrorCode" = NULL
         WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
        [job.id, job.leaseUntil, scheduledAt],
      );
      return;
    }
    const title = target.name;
    const body = setReminderBody(
      set.artist,
      stageName(target.published, set.stageId),
    );
    const inbox = {
      type: 'festival.set_reminder' as const,
      festivalId: job.festivalId,
      title,
      body,
      route: `/festivals/${job.festivalId}/live`,
      subject: { setId },
    };
    // push-to-start는 저장한 공연 중 가장 이른 하나를 골라 같은 시각에 배너를 띄운다.
    const liveActivitySetId = sets.find(
      (item) =>
        saved.includes(item.id) && Date.parse(item.startsAt) === startsAt,
    )?.id;
    if (
      liveActivitySetId === setId &&
      target.liveActivityScheduledAt &&
      new Date(target.liveActivityScheduledAt).getTime() ===
        scheduledAt.getTime()
    ) {
      if (target.liveActivityStatus === 'sent') {
        await this.recordInbox(job, target, inbox);
        await this.finish(job, 'cancelled', 'LIVE_ACTIVITY_ALERTED');
        return;
      }
      const unresolved =
        target.liveActivityStatus === 'pending' ||
        target.liveActivityStatus === 'leased' ||
        (target.liveActivityStatus === 'failed' &&
          target.liveActivityErrorCode === 'OUTCOME_UNKNOWN');
      if (
        unresolved &&
        now.getTime() < scheduledAt.getTime() + LIVE_ACTIVITY_WAIT_MS
      ) {
        await this.db.query(
          `UPDATE "notification_deliveries"
           SET "status" = 'pending', "nextAttemptAt" = now() + interval '1 minute',
             "leaseUntil" = NULL, "lastErrorCode" = 'WAITING_LIVE_ACTIVITY'
           WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
          [job.id, job.leaseUntil],
        );
        return;
      }
    }
    await this.recordInbox(job, target, inbox);
    await this.sendDelivery(job, () =>
      this.apns.sendSetReminderNotification(
        target.apnsToken!,
        target.apnsEnvironment!,
        {
          festivalId: job.festivalId,
          setId,
          title,
          body,
          eventKey: job.eventKey,
          deeplink: buildDeeplink({
            type: 'set',
            festivalId: job.festivalId,
            setId,
          }),
          expiresAt: new Date(startsAt),
        },
      ),
    );
  }

  private async deliverLiveActivityStart(
    job: Delivery,
    target: DeliveryTarget | undefined,
    now: Date,
    performanceStart: boolean,
  ): Promise<void> {
    const saved = Array.isArray(target?.savedSetIds) ? target.savedSetIds : [];
    const selectedSet = performanceStart
      ? publishedSets(target?.published ?? {}, job.festivalId)
          .filter(
            (set) =>
              saved.includes(set.id) &&
              Date.parse(set.startsAt) > now.getTime(),
          )
          .sort(
            (left, right) =>
              Date.parse(left.startsAt) - Date.parse(right.startsAt),
          )[0]
      : null;
    const performanceAt = selectedSet ? Date.parse(selectedSet.startsAt) : NaN;
    const start = performanceStart
      ? Number.isFinite(performanceAt)
        ? new Date(performanceAt - PERFORMANCE_LEAD_MS)
        : null
      : liveActivityStartAt(validDays(target?.days));
    const period = festivalPeriod(
      records(target?.published?.days).sort((left, right) =>
        String(left.date).localeCompare(String(right.date)),
      ),
    );
    if (
      !target?.liveActivityPushToStartToken ||
      !target.apnsEnvironment ||
      !target.name ||
      !period ||
      !start ||
      start.getTime() < now.getTime() - LATE_GRACE_MS ||
      (performanceStart && !selectedSet) ||
      (performanceStart && !target.hasActiveSession) ||
      (!performanceStart &&
        Array.isArray(target.savedSetIds) &&
        target.savedSetIds.length > 0) ||
      target.hasCurrentActivity
    ) {
      await this.finish(job, 'cancelled', 'TARGET_UNAVAILABLE');
      return;
    }
    if (start.getTime() !== new Date(job.scheduledAt).getTime()) {
      await this.db.query(
        `UPDATE "notification_deliveries"
         SET "status" = 'pending', "scheduledAt" = $3, "nextAttemptAt" = $3,
           "leaseUntil" = NULL, "lastErrorCode" = NULL
         WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
        [job.id, job.leaseUntil, start],
      );
      return;
    }
    const state = buildLiveActivityContentState({
      festivalId: job.festivalId,
      now,
      festivalStart: period.start,
      festivalEnd: period.end,
      sets: publishedSets(target.published, job.festivalId),
      flagsEnabled: false,
      flags: [],
      member: selectedSet
        ? {
            savedSetIds: saved.filter(
              (id): id is string => typeof id === 'string',
            ),
            followedFlagIds: [],
            pinnedFlagId: null,
            crew: null,
          }
        : null,
    });
    if (state.phase === 'finished') {
      await this.finish(job, 'cancelled', 'FESTIVAL_FINISHED');
      return;
    }

    // Reserve the attempt durably before APNs. A timeout or process crash may
    // mean APNs accepted the start; replaying it could create a second activity.
    const reservation = await this.db.transaction(async (manager) => {
      // Serialize start reservations for the same device, including the
      // festival-day and saved-performance paths.
      await manager.query(
        'SELECT "id" FROM "devices" WHERE "id" = $1 FOR UPDATE',
        [job.deviceId],
      );
      const other = await manager.query<Array<{ id: string }>>(
        `SELECT "id" FROM "notification_deliveries"
         WHERE "deviceId" = $1 AND "festivalId" = $2 AND "id" <> $3
           AND "eventKey" IN ($4, $5)
           AND ("status" = 'sent' OR ("status" = 'failed'
             AND "lastErrorCode" = 'OUTCOME_UNKNOWN')) LIMIT 1`,
        [
          job.deviceId,
          job.festivalId,
          job.id,
          `${LIVE_START_PREFIX}${job.festivalId}`,
          `${PERFORMANCE_START_PREFIX}${job.festivalId}`,
        ],
      );
      if (other.length) return 'conflict';
      const reserved = await manager.query<Array<{ id: string }>>(
        `WITH reserved AS (
           UPDATE "notification_deliveries" SET "status" = 'failed',
             "attempts" = "attempts" + 1, "leaseUntil" = NULL,
             "lastErrorCode" = 'OUTCOME_UNKNOWN'
           WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2
           RETURNING "id"
         ) SELECT "id" FROM reserved`,
        [job.id, job.leaseUntil],
      );
      return reserved.length ? 'reserved' : 'lost';
    });
    if (reservation === 'conflict') {
      await this.finish(job, 'cancelled', 'ACTIVITY_ALREADY_STARTED');
      return;
    }
    if (reservation === 'lost') return;

    let result: Awaited<ReturnType<ApnsService['sendLiveActivityStart']>>;
    try {
      result = await this.apns.sendLiveActivityStart(
        target.liveActivityPushToStartToken,
        target.apnsEnvironment,
        {
          festivalId: job.festivalId,
          festivalName: target.name,
          state: { ...state },
          alertBody: selectedSet
            ? `${selectedSet.artist} 공연이 2시간 후 시작돼요.`
            : undefined,
        },
      );
    } catch {
      return;
    }
    if (result.accepted) {
      await this.finishLiveStart(job, 'sent', null);
      return;
    }
    if (result.permanent) {
      await this.db.query(
        `UPDATE "devices" SET "liveActivityPushToStartToken" = NULL
         WHERE "id" = $1 AND "liveActivityPushToStartToken" = $2`,
        [job.deviceId, target.liveActivityPushToStartToken],
      );
      await this.finishLiveStart(
        job,
        'failed',
        result.reason ?? 'APNS_REJECTED',
      );
      return;
    }
    const reason = result.reason ?? 'APNS_REJECTED';
    if (reason === 'APNS_NETWORK_ERROR' || reason === 'APNS_HTTP_UNKNOWN')
      return;
    if (job.attempts + 1 >= MAX_ATTEMPTS || reason === 'PayloadTooLarge') {
      await this.finishLiveStart(job, 'failed', reason);
      return;
    }
    const minutes = /^APNS_HTTP_5\d\d$/.test(reason)
      ? 15
      : Math.min(2 ** (job.attempts + 1), 60);
    await this.db.query(
      `UPDATE "notification_deliveries" SET "status" = 'pending',
         "nextAttemptAt" = now() + ($2 * interval '1 minute'),
         "lastErrorCode" = $3
       WHERE "id" = $1 AND "status" = 'failed'
         AND "lastErrorCode" = 'OUTCOME_UNKNOWN'`,
      [job.id, minutes, reason.slice(0, 128)],
    );
  }

  private async finishLiveStart(
    job: Delivery,
    status: 'sent' | 'failed',
    reason: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE "notification_deliveries" SET "status" = $2::varchar,
         "sentAt" = CASE WHEN $2::varchar = 'sent' THEN now() ELSE NULL END,
         "lastErrorCode" = $3
       WHERE "id" = $1 AND "status" = 'failed'
         AND "lastErrorCode" = 'OUTCOME_UNKNOWN'`,
      [job.id, status, reason?.slice(0, 128) ?? null],
    );
  }

  private async sendDelivery(
    job: Delivery,
    send: () => Promise<
      Awaited<ReturnType<ApnsService['sendStartNotification']>>
    >,
  ): Promise<void> {
    let result: Awaited<ReturnType<ApnsService['sendStartNotification']>>;
    try {
      result = await send();
    } catch {
      if (job.attempts + 1 >= MAX_ATTEMPTS)
        await this.finish(job, 'failed', 'APNS_ERROR');
      else await this.retry(job, 'APNS_ERROR');
      return;
    }
    if (result.accepted) {
      await this.finish(job, 'sent', null);
    } else if (
      result.reason === 'APNS_NOT_CONFIGURED' ||
      result.reason === 'APNS_CONFIGURATION_ERROR'
    ) {
      await this.retry(job, result.reason);
    } else if (result.permanent || job.attempts + 1 >= MAX_ATTEMPTS) {
      await this.finish(job, 'failed', result.reason ?? 'APNS_REJECTED');
    } else {
      await this.retry(job, result.reason ?? 'APNS_REJECTED');
    }
  }

  private async finish(
    job: Delivery,
    status: 'sent' | 'cancelled' | 'failed',
    reason: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE "notification_deliveries"
       SET "status" = $3::varchar, "attempts" = "attempts" + 1,
         "sentAt" = CASE WHEN $3::varchar = 'sent' THEN now() ELSE NULL END,
         "leaseUntil" = NULL, "lastErrorCode" = $4
       WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
      [job.id, job.leaseUntil, status, reason?.slice(0, 128) ?? null],
    );
  }

  private async retry(job: Delivery, reason: string): Promise<void> {
    const configurationError =
      reason === 'APNS_NOT_CONFIGURED' || reason === 'APNS_CONFIGURATION_ERROR';
    const serverError = /^APNS_HTTP_5\d\d$/.test(reason);
    const minutes = Math.max(
      configurationError || serverError ? 15 : 0,
      Math.min(2 ** (job.attempts + 1), 60),
    );
    await this.db.query(
      `UPDATE "notification_deliveries"
       SET "status" = 'pending', "attempts" = "attempts" + $5,
         "nextAttemptAt" = now() + ($3 * interval '1 minute'),
         "leaseUntil" = NULL, "lastErrorCode" = $4
       WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
      [
        job.id,
        job.leaseUntil,
        minutes,
        reason.slice(0, 128),
        configurationError ? 0 : 1,
      ],
    );
  }
}
