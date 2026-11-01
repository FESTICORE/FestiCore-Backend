import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApnsService } from './apns.service';
import { buildLiveActivityContentState } from './live-activity-content';
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
  apnsToken: string | null;
  liveActivityPushToStartToken: string | null;
  liveActivityId: string | null;
  apnsEnvironment: 'sandbox' | 'production' | null;
  name: string | null;
  days: unknown;
  publishedVersion: number;
  checklist: unknown;
  packDownloadedVersion: number | null;
  published: Record<string, unknown>;
}

const REMINDER_PREFIX = 'festival-reminder:';
const LIVE_START_PREFIX = 'live-activity-start:';

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
      SELECT "id", "published"->>'name' AS "name", "published"->'days' AS "days"
      FROM "admin_festivals"
      WHERE "published" IS NOT NULL AND "publishedVersion" > 0`);
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
             AND d."liveActivityId" IS NULL
           ON CONFLICT ("deviceId", "eventKey") DO UPDATE
             SET "scheduledAt" = EXCLUDED."scheduledAt",
                 "nextAttemptAt" = EXCLUDED."nextAttemptAt",
                 "status" = 'pending', "leaseUntil" = NULL
           WHERE "notification_deliveries"."status" = 'cancelled'
              OR ("notification_deliveries"."status" = 'pending'
                  AND "notification_deliveries"."scheduledAt" <> EXCLUDED."scheduledAt")`,
          [row.id, `${LIVE_START_PREFIX}${row.id}`, firstStart],
        );
      }
    }
  }

  /** One SQL statement claims a due job; SKIP LOCKED excludes concurrent workers. */
  async claim(): Promise<Delivery | null> {
    const jobs = await this.db.query<Delivery[]>(`
      WITH due AS (
        SELECT "id" FROM "notification_deliveries"
        WHERE (("status" = 'pending' AND "nextAttemptAt" <= now())
            OR ("status" = 'leased' AND "leaseUntil" <= now()))
        ORDER BY "nextAttemptAt", "id"
        LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE "notification_deliveries" n
      SET "status" = 'leased', "leaseUntil" = now() + interval '2 minutes'
      FROM due WHERE n."id" = due."id"
      RETURNING n."id", n."deviceId", n."festivalId", n."eventKey",
        n."scheduledAt", n."leaseUntil", n."attempts"`);
    return jobs[0] ?? null;
  }

  async deliver(job: Delivery, now = new Date()): Promise<void> {
    const liveStart = job.eventKey === `${LIVE_START_PREFIX}${job.festivalId}`;
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
      SELECT d."apnsToken", d."liveActivityPushToStartToken",
        d."liveActivityId", d."apnsEnvironment",
        f."published"->>'name' AS "name", f."published"->'days' AS "days",
        f."published"->'checklist' AS "checklist", f."published",
        f."publishedVersion" AS "publishedVersion",
        s."packDownloadedVersion" AS "packDownloadedVersion"
      FROM "notification_deliveries" n
      JOIN "devices" d ON d."id" = n."deviceId"
      JOIN "device_subscriptions" s ON s."deviceId" = n."deviceId"
        AND s."festivalId" = n."festivalId" AND s."${subscriptionFlag}" = true
        ${packUpdate ? '' : 'AND s."pinned" = true'}
      JOIN "admin_festivals" f ON f."id" = n."festivalId"
        AND f."published" IS NOT NULL AND f."publishedVersion" > 0
      WHERE n."id" = $1 AND n."status" = 'leased'
        AND n."leaseUntil" = $2`,
      [job.id, job.leaseUntil],
    );
    const target = rows[0];
    if (liveStart) {
      await this.deliverLiveActivityStart(job, target, now);
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
      await this.sendDelivery(job, () =>
        this.apns.sendReminderNotification(
          target.apnsToken!,
          target.apnsEnvironment!,
          {
            festivalId: job.festivalId,
            title: `${target.name} 준비물`,
            body: `준비물 확인했어요?${checklistSummary(target.checklist)}${hasPack ? '' : ' 지금 팩을 받아 두세요.'}`,
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

  private async deliverLiveActivityStart(
    job: Delivery,
    target: DeliveryTarget | undefined,
    now: Date,
  ): Promise<void> {
    const start = liveActivityStartAt(validDays(target?.days));
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
      target.liveActivityId
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
      member: null,
    });
    if (state.phase === 'finished') {
      await this.finish(job, 'cancelled', 'FESTIVAL_FINISHED');
      return;
    }

    // Reserve the attempt durably before APNs. A timeout or process crash may
    // mean APNs accepted the start; replaying it could create a second activity.
    const reserved = await this.db.query<Array<{ id: string }>>(
      `UPDATE "notification_deliveries" SET "status" = 'failed',
         "attempts" = "attempts" + 1, "leaseUntil" = NULL,
         "lastErrorCode" = 'OUTCOME_UNKNOWN'
       WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2
       RETURNING "id"`,
      [job.id, job.leaseUntil],
    );
    if (!reserved.length) return;

    let result: Awaited<ReturnType<ApnsService['sendLiveActivityStart']>>;
    try {
      result = await this.apns.sendLiveActivityStart(
        target.liveActivityPushToStartToken,
        target.apnsEnvironment,
        {
          festivalId: job.festivalId,
          festivalName: target.name,
          state: { ...state },
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
      `UPDATE "notification_deliveries" SET "status" = $2,
         "sentAt" = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END,
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
       SET "status" = $3, "attempts" = "attempts" + 1,
         "sentAt" = CASE WHEN $3 = 'sent' THEN now() ELSE NULL END,
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
