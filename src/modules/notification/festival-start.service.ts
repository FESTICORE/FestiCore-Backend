import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApnsService } from './apns.service';

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
  apnsEnvironment: 'sandbox' | 'production' | null;
  name: string | null;
  days: unknown;
  publishedVersion: number;
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
            this.logger.error(
              '축제 시작 알림 작업 선점에 실패했습니다.',
              outcome.reason instanceof Error
                ? outcome.reason.stack
                : String(outcome.reason),
            );
          }
        }
        if (!claimed.length) break;
        const deliveries = await Promise.allSettled(
          claimed.map((job) => this.deliver(job, new Date())),
        );
        for (const outcome of deliveries) {
          if (outcome.status === 'rejected') {
            this.logger.error(
              '축제 시작 알림 작업 처리에 실패했습니다.',
              outcome.reason instanceof Error
                ? outcome.reason.stack
                : String(outcome.reason),
            );
          }
        }
        if (claimed.length < SEND_CONCURRENCY) break;
      }
    } catch (error) {
      this.logger.error(
        '축제 시작 알림 스케줄러 실행에 실패했습니다.',
        error instanceof Error ? error.stack : String(error),
      );
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
      for (const day of validDays(row.days)) {
        const startsAt = new Date(day.startsAt);
        if (startsAt.getTime() < now.getTime() - LATE_GRACE_MS) continue;
        const eventKey = `festival-start:${row.id}:${day.date}`;
        await this.db.query(
          `INSERT INTO "notification_deliveries"
            ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
           SELECT gen_random_uuid(), s."deviceId", $1, $2, $3::timestamptz, $3::timestamptz
           FROM "device_subscriptions" s
           JOIN "devices" d ON d."id" = s."deviceId"
           WHERE s."festivalId" = $1 AND s."festivalStarts" = true
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
    const packUpdate = job.eventKey.startsWith(
      `pack-updated:${job.festivalId}:`,
    );
    const rows = await this.db.query<DeliveryTarget[]>(
      `
      SELECT d."apnsToken", d."apnsEnvironment",
        f."published"->>'name' AS "name", f."published"->'days' AS "days",
        f."publishedVersion" AS "publishedVersion"
      FROM "notification_deliveries" n
      JOIN "devices" d ON d."id" = n."deviceId"
      JOIN "device_subscriptions" s ON s."deviceId" = n."deviceId"
        AND s."festivalId" = n."festivalId" AND s."${packUpdate ? 'packUpdates' : 'festivalStarts'}" = true
      JOIN "admin_festivals" f ON f."id" = n."festivalId"
        AND f."published" IS NOT NULL AND f."publishedVersion" > 0
      WHERE n."id" = $1 AND n."status" = 'leased'
        AND n."leaseUntil" = $2`,
      [job.id, job.leaseUntil],
    );
    const target = rows[0];
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
