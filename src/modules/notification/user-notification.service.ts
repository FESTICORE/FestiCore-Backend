import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

export type UserNotificationType =
  | 'crew.gather'
  | 'crew.status'
  | 'crew.member_joined'
  | 'flag.status'
  | 'festival.reminder'
  | 'festival.start'
  | 'pack.updated';

export interface UserNotificationEntry {
  type: UserNotificationType;
  festivalId: string | null;
  title: string;
  body: string;
  route: string | null;
  subject: Record<string, string>;
  dedupeKey: string;
}

export interface UserNotificationItem {
  id: string;
  type: string;
  festivalId: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  route: string | null;
  subject: Record<string, string>;
}

export interface Queryable {
  query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T>;
}

interface Row {
  id: string;
  type: string;
  festivalId: string | null;
  title: string;
  body: string;
  route: string | null;
  subject: Record<string, string> | null;
  createdAt: Date;
  readAt: Date | null;
  cursorAt: string;
}

export const RETENTION_DAYS = 30;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
export const MAX_IDS = 100;
const PURGE_MS = 60 * 60_000;
const PURGE_BATCH = 1000;
const FESTIVAL_ID = /^fst_[0-9a-z]{1,28}$/;
export const NOTIFICATION_ID = /^ntf_[0-9a-f]{32}$/;
const RETAINED = `"createdAt" > now() - (${RETENTION_DAYS} * interval '1 day')`;

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION', message });
}

const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function encodeCursor(row: Row): string {
  return Buffer.from(`${row.cursorAt}|${row.id}`).toString('base64url');
}

/** 커서는 DB 시각을 마이크로초까지 담아 같은 밀리초의 항목을 건너뛰지 않는다. */
function decodeCursor(value: string): { createdAt: string; id: string } {
  const [createdAt, id, extra] = Buffer.from(value, 'base64url')
    .toString('utf8')
    .split('|');
  if (
    extra !== undefined ||
    !createdAt ||
    !CURSOR_AT.test(createdAt) ||
    Number.isNaN(new Date(createdAt).getTime()) ||
    !id ||
    !NOTIFICATION_ID.test(id)
  )
    throw invalid('before 커서 형식이 올바르지 않습니다.');
  return { createdAt, id };
}

function festivalFilter(festivalId: string | undefined): string | null {
  if (festivalId === undefined || festivalId === '') return null;
  if (!FESTIVAL_ID.test(festivalId))
    throw invalid('festivalId 형식이 올바르지 않습니다.');
  return festivalId;
}

/**
 * 호출자의 트랜잭션에서 수신자별 알림함 행을 만든다.
 * replace=true면 같은 dedupeKey의 기존 행을 최신 내용으로 바꾸고 읽지 않음으로 되돌린다.
 */
export async function recordUserNotifications(
  runner: Queryable,
  userIds: readonly string[],
  entry: UserNotificationEntry,
  replace = false,
): Promise<void> {
  const recipients = [...new Set(userIds)];
  if (!recipients.length) return;
  const conflict = replace
    ? `DO UPDATE SET "type" = EXCLUDED."type", "festivalId" = EXCLUDED."festivalId",
        "title" = EXCLUDED."title", "body" = EXCLUDED."body",
        "route" = EXCLUDED."route", "subject" = EXCLUDED."subject",
        "createdAt" = now(), "readAt" = NULL`
    : 'DO NOTHING';
  await runner.query(
    `INSERT INTO "user_notifications"
      ("userId", "type", "festivalId", "title", "body", "route", "subject", "dedupeKey")
     SELECT r."userId", $2, $3, $4, $5, $6, $7::jsonb, $8
     FROM unnest($1::uuid[]) AS r("userId")
     JOIN "users" u ON u."id" = r."userId"
     ON CONFLICT ("userId", "dedupeKey") ${conflict}`,
    [
      recipients,
      entry.type,
      entry.festivalId,
      entry.title.slice(0, 120),
      entry.body.slice(0, 240),
      entry.route,
      JSON.stringify(entry.subject),
      entry.dedupeKey.slice(0, 160),
    ],
  );
}

@Injectable()
export class UserNotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserNotificationService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DataSource) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.purgeExpired(), PURGE_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list(
    userId: string,
    query: { festivalId?: string; before?: string; limit?: string },
  ): Promise<{ items: UserNotificationItem[]; nextCursor: string | null }> {
    const festivalId = festivalFilter(query.festivalId);
    const limit =
      query.limit === undefined || query.limit === ''
        ? DEFAULT_LIMIT
        : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      throw invalid(`limit은 1~${MAX_LIMIT} 사이 정수여야 합니다.`);
    const cursor = query.before ? decodeCursor(query.before) : null;
    const rows = await this.db.query<Row[]>(
      `SELECT "id", "type", "festivalId", "title", "body", "route", "subject",
         "createdAt", "readAt",
         to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
       FROM "user_notifications"
       WHERE "userId" = $1 AND ${RETAINED}
         AND ($2::varchar IS NULL OR "festivalId" = $2)
         AND ($3::timestamptz IS NULL OR ("createdAt", "id") < ($3::timestamptz, $4::varchar))
       ORDER BY "createdAt" DESC, "id" DESC
       LIMIT $5`,
      [
        userId,
        festivalId,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        type: row.type,
        festivalId: row.festivalId,
        title: row.title,
        body: row.body,
        createdAt: new Date(row.createdAt).toISOString(),
        readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
        route: row.route,
        subject: row.subject ?? {},
      })),
      nextCursor:
        rows.length > limit && page.length
          ? encodeCursor(page[page.length - 1])
          : null,
    };
  }

  async unreadCount(
    userId: string,
    rawFestivalId?: string,
  ): Promise<{ unreadCount: number }> {
    const festivalId = festivalFilter(rawFestivalId);
    const rows = await this.db.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS "count" FROM "user_notifications"
       WHERE "userId" = $1 AND "readAt" IS NULL AND ${RETAINED}
         AND ($2::varchar IS NULL OR "festivalId" = $2)`,
      [userId, festivalId],
    );
    return { unreadCount: Number(rows[0]?.count ?? 0) };
  }

  async markRead(
    userId: string,
    body: { ids?: string[]; all?: boolean; festivalId?: string },
  ): Promise<void> {
    const byIds = body.ids !== undefined;
    if (byIds === (body.all === true))
      throw invalid('ids 또는 all=true 중 하나만 보내야 합니다.');
    if (byIds) {
      if (body.festivalId !== undefined)
        throw invalid('festivalId는 all=true와 함께만 보낼 수 있습니다.');
      const ids = this.ids(body.ids);
      await this.db.query(
        `UPDATE "user_notifications" SET "readAt" = now()
         WHERE "userId" = $1 AND "readAt" IS NULL AND "id" = ANY($2::varchar[])`,
        [userId, ids],
      );
      return;
    }
    const festivalId = festivalFilter(body.festivalId);
    await this.db.query(
      `UPDATE "user_notifications" SET "readAt" = now()
       WHERE "userId" = $1 AND "readAt" IS NULL
         AND ($2::varchar IS NULL OR "festivalId" = $2)`,
      [userId, festivalId],
    );
  }

  async remove(userId: string, body: { ids?: string[] }): Promise<void> {
    const ids = this.ids(body.ids);
    await this.db.query(
      `DELETE FROM "user_notifications"
       WHERE "userId" = $1 AND "id" = ANY($2::varchar[])`,
      [userId, ids],
    );
  }

  async purgeExpired(): Promise<void> {
    try {
      await this.db.query(
        `DELETE FROM "user_notifications" WHERE "id" IN (
           SELECT "id" FROM "user_notifications"
           WHERE "createdAt" <= now() - (${RETENTION_DAYS} * interval '1 day')
           LIMIT ${PURGE_BATCH})`,
      );
    } catch {
      this.logger.error('보존 기간이 지난 알림함 항목 정리에 실패했습니다.');
    }
  }

  private ids(value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > MAX_IDS ||
      !value.every((id) => typeof id === 'string' && NOTIFICATION_ID.test(id))
    )
      throw invalid(`ids는 ntf_ 형식 ID 1~${MAX_IDS}개여야 합니다.`);
    return [...new Set(value as string[])];
  }
}
