import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Crew, CrewGather } from '../crews/crew.entity';
import { Flag } from '../flags/flag.entity';
import { ApnsService } from './apns.service';

type SocialType = 'flag.status' | 'crew.status' | 'crew.gather';
type DeliveryStatus = 'sent' | 'cancelled' | 'failed';

interface Delivery {
  id: string;
  deviceId: string;
  recipientUserId: string;
  type: SocialType;
  subjectId: string;
  actorUserId: string;
  eventKey: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  leaseUntil: Date;
  attempts: number;
}

interface Target {
  apnsToken: string | null;
  apnsEnvironment: 'sandbox' | 'production' | null;
}

const POLL_MS = 15_000;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;
const MAX_AGE_MS = 30 * 60_000;

@Injectable()
export class SocialNotificationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SocialNotificationService.name);
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

  async enqueueFlagStatus(
    manager: EntityManager,
    flag: Flag,
    actorUserId: string,
  ): Promise<void> {
    if (flag.visibility !== 'public' || flag.hidden) return;
    if (flag.status === 'resting') {
      await manager.query(
        `UPDATE "social_notification_deliveries"
        SET "status" = 'cancelled', "lastErrorCode" = 'FLAG_RESTING'
        WHERE "type" = 'flag.status' AND "subjectId" = $1 AND "status" = 'pending'`,
        [flag.id],
      );
      return;
    }
    await this.enqueueStatus(
      manager,
      'flag.status',
      flag.id,
      actorUserId,
      5,
      {
        flagId: flag.id,
        status: flag.status,
        zoneId: flag.zoneId,
        activity: flag.activity,
        actorUserId,
      },
      '"flag_follows" r',
      'r."flagId" = $1 AND r."userId" <> $2',
    );
  }

  async enqueueCrewStatus(
    manager: EntityManager,
    crew: Crew,
    actorUserId: string,
  ): Promise<void> {
    const members = await manager.query<
      Array<{ nickname: string; zoneId: string | null; state: string | null }>
    >(
      `SELECT "nickname", "zoneId", "state" FROM "crew_members" WHERE "crewId" = $1 AND "userId" = $2`,
      [crew.id, actorUserId],
    );
    const actor = members[0];
    if (!actor || crew.archivedAt) return;
    await this.enqueueStatus(
      manager,
      'crew.status',
      crew.id,
      actorUserId,
      1,
      {
        crewId: crew.id,
        actorUserId,
        nickname: actor.nickname,
        zoneId: actor.zoneId,
        state: actor.state,
      },
      '"crew_members" r',
      'r."crewId" = $1 AND r."userId" <> $2',
    );
  }

  async enqueueCrewGather(
    manager: EntityManager,
    crew: Crew,
    actorUserId: string,
    gather: CrewGather,
  ): Promise<void> {
    if (crew.archivedAt) return;
    const members = await manager.query<Array<{ nickname: string }>>(
      `SELECT "nickname" FROM "crew_members" WHERE "crewId" = $1 AND "userId" = $2`,
      [crew.id, actorUserId],
    );
    if (!members[0]) return;
    const payload = {
      crewId: crew.id,
      gatherId: gather.id,
      actorUserId,
      nickname: members[0].nickname,
      zoneId: gather.zoneId,
    };
    await manager.query(
      `INSERT INTO "social_notification_deliveries"
      ("deviceId", "recipientUserId", "type", "subjectId", "actorUserId", "eventKey", "payload", "nextAttemptAt")
      SELECT d."id", d."userId", 'crew.gather', $1, $2, $3, $4::jsonb, now()
      FROM "crew_members" r JOIN "devices" d ON d."userId" = r."userId"
      WHERE r."crewId" = $1 AND r."userId" <> $2
        AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
      ON CONFLICT ("deviceId", "eventKey") DO NOTHING`,
      [
        crew.id,
        actorUserId,
        `crew.gather:${gather.id}`,
        JSON.stringify(payload),
      ],
    );
  }

  private async enqueueStatus(
    manager: EntityManager,
    type: 'flag.status' | 'crew.status',
    subjectId: string,
    actorUserId: string,
    minutes: number,
    payload: Record<string, unknown>,
    recipientTable: string,
    recipientFilter: string,
  ): Promise<void> {
    // The caller owns the write transaction. This lock serializes updates to the same subject.
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [type, subjectId],
    );
    await manager.query(
      `UPDATE "social_notification_deliveries"
       SET "status" = 'cancelled', "lastErrorCode" = 'ACTOR_CHANGED'
       WHERE "type" = $1 AND "subjectId" = $2 AND "recipientUserId" = $3
         AND "status" = 'pending'`,
      [type, subjectId, actorUserId],
    );
    const params = [
      subjectId,
      actorUserId,
      type,
      JSON.stringify(payload),
      minutes,
    ];
    const targetSql = `SELECT d."id" AS "deviceId", d."userId" AS "recipientUserId"
      FROM ${recipientTable}
      JOIN "users" u ON u."id" = r."userId" AND u."pushOptIn" = true
      JOIN "devices" d ON d."userId" = r."userId"
        AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
      WHERE ${recipientFilter}`;
    await manager.query(
      `WITH targets AS (${targetSql})
      UPDATE "social_notification_deliveries" n
      SET "status" = 'cancelled', "lastErrorCode" = 'SUPERSEDED'
      FROM targets t
      WHERE n."deviceId" = t."deviceId" AND n."recipientUserId" = t."recipientUserId"
        AND n."type" = $3 AND n."subjectId" = $1 AND n."status" = 'pending'
        AND n."createdAt" <= now() - ($5 * interval '1 minute')`,
      params,
    );
    await manager.query(
      `WITH targets AS (${targetSql})
      UPDATE "social_notification_deliveries" n
      SET "payload" = $4::jsonb, "actorUserId" = $2
      FROM targets t
      WHERE n."deviceId" = t."deviceId" AND n."recipientUserId" = t."recipientUserId"
        AND n."type" = $3 AND n."subjectId" = $1 AND n."status" = 'pending'
        AND n."createdAt" > now() - ($5 * interval '1 minute')`,
      params,
    );
    await manager.query(
      `WITH targets AS (${targetSql})
      INSERT INTO "social_notification_deliveries"
        ("deviceId", "recipientUserId", "type", "subjectId", "actorUserId", "eventKey", "payload", "nextAttemptAt")
      SELECT t."deviceId", t."recipientUserId", $3, $1, $2,
        $3 || ':' || $1 || ':' || gen_random_uuid()::text, $4::jsonb,
        now() + ($5 * interval '1 minute')
      FROM targets t
      WHERE NOT EXISTS (
        SELECT 1 FROM "social_notification_deliveries" n
        WHERE n."deviceId" = t."deviceId" AND n."recipientUserId" = t."recipientUserId"
          AND n."type" = $3 AND n."subjectId" = $1 AND n."status" = 'pending'
          AND n."createdAt" > now() - ($5 * interval '1 minute')
      )`,
      params,
    );
  }

  async tick(): Promise<void> {
    if (this.running || !this.apns.isConfigured()) return;
    this.running = true;
    try {
      for (let i = 0; i < BATCH_SIZE; i++) {
        const job = await this.claim();
        if (!job) break;
        await this.deliver(job);
      }
    } catch {
      this.logger.error('소셜 알림 작업 처리에 실패했습니다.');
    } finally {
      this.running = false;
    }
  }

  async claim(): Promise<Delivery | null> {
    const jobs = await this.db.query<Delivery[]>(`WITH due AS (
      SELECT "id" FROM "social_notification_deliveries"
      WHERE ("status" = 'pending' AND "nextAttemptAt" <= now())
         OR ("status" = 'leased' AND "leaseUntil" <= now())
      ORDER BY "nextAttemptAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED
    ) UPDATE "social_notification_deliveries" n
      SET "status" = 'leased', "leaseUntil" = now() + interval '2 minutes'
      FROM due WHERE n."id" = due."id" RETURNING n.*`);
    return jobs[0] ?? null;
  }

  async deliver(job: Delivery, now = new Date()): Promise<void> {
    if (now.getTime() - new Date(job.createdAt).getTime() > MAX_AGE_MS) {
      await this.finish(job, 'cancelled', 'EXPIRED');
      return;
    }
    const rows = await this.db.query<Target[]>(
      `SELECT d."apnsToken", d."apnsEnvironment"
      FROM "social_notification_deliveries" n
      JOIN "devices" d ON d."id" = n."deviceId" AND d."userId" = n."recipientUserId"
      JOIN "users" u ON u."id" = n."recipientUserId"
        AND (n."type" = 'crew.gather' OR u."pushOptIn" = true)
      WHERE n."id" = $1 AND n."status" = 'leased' AND n."leaseUntil" = $2
        AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
        AND ((n."type" = 'flag.status' AND EXISTS (
          SELECT 1 FROM "flag_follows" f JOIN "flags" flag ON flag."id" = f."flagId"
          WHERE f."flagId" = n."subjectId" AND f."userId" = n."recipientUserId"
            AND flag."visibility" = 'public' AND flag."hidden" = false
            AND flag."status" <> 'resting'))
          OR (n."type" IN ('crew.status', 'crew.gather') AND EXISTS (
            SELECT 1 FROM "crew_members" m JOIN "crews" c ON c."id" = m."crewId"
            WHERE m."crewId" = n."subjectId" AND m."userId" = n."recipientUserId"
              AND c."archivedAt" IS NULL)))`,
      [job.id, job.leaseUntil],
    );
    const target = rows[0];
    if (!target?.apnsToken || !target.apnsEnvironment) {
      await this.finish(job, 'cancelled', 'TARGET_UNAVAILABLE');
      return;
    }
    let result: Awaited<ReturnType<ApnsService['sendSocialNotification']>>;
    try {
      result = await this.apns.sendSocialNotification(
        target.apnsToken,
        target.apnsEnvironment,
        { type: job.type, payload: job.payload, eventKey: job.eventKey },
      );
    } catch {
      await this.retryOrFail(job, 'APNS_ERROR');
      return;
    }
    if (result.accepted) {
      await this.finish(job, 'sent', null);
    } else if (result.permanent) {
      await this.db.query(
        `UPDATE "devices" SET "apnsToken" = NULL, "apnsEnvironment" = NULL
        WHERE "id" = $1 AND "apnsToken" = $2 AND "apnsEnvironment" = $3`,
        [job.deviceId, target.apnsToken, target.apnsEnvironment],
      );
      await this.finish(job, 'failed', result.reason ?? 'APNS_REJECTED');
    } else {
      await this.retryOrFail(job, result.reason ?? 'APNS_REJECTED');
    }
  }

  private async retryOrFail(job: Delivery, reason: string): Promise<void> {
    if (job.attempts + 1 >= MAX_ATTEMPTS) {
      await this.finish(job, 'failed', reason);
      return;
    }
    const minutes = Math.min(2 ** (job.attempts + 1), 30);
    await this.db.query(
      `UPDATE "social_notification_deliveries"
      SET "status" = 'pending', "attempts" = "attempts" + 1,
        "nextAttemptAt" = now() + ($3 * interval '1 minute'),
        "leaseUntil" = NULL, "lastErrorCode" = $4
      WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
      [job.id, job.leaseUntil, minutes, reason.slice(0, 128)],
    );
  }

  private async finish(
    job: Delivery,
    status: DeliveryStatus,
    reason: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE "social_notification_deliveries"
      SET "status" = $3, "attempts" = "attempts" + 1,
        "sentAt" = CASE WHEN $3 = 'sent' THEN now() ELSE NULL END,
        "leaseUntil" = NULL, "lastErrorCode" = $4
      WHERE "id" = $1 AND "status" = 'leased' AND "leaseUntil" = $2`,
      [job.id, job.leaseUntil, status, reason?.slice(0, 128) ?? null],
    );
  }
}
