import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

export interface AdminAuditInput {
  actor: string | null;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
}

export interface AdminAuditRow {
  at: Date;
  actor: string | null;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
}

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseDate(value: string | undefined, name: string): Date | null {
  if (value === undefined) return null;
  const match = ISO_DATE_TIME.exec(value);
  const dateOnly = value.slice(0, 10);
  const normalized = new Date(`${dateOnly}T00:00:00.000Z`);
  if (
    !match ||
    !Number.isFinite(Date.parse(value)) ||
    Number.isNaN(normalized.getTime()) ||
    normalized.toISOString().slice(0, 10) !== dateOnly
  ) {
    throw new BadRequestException(
      `${name}은 시간대가 포함된 ISO8601 시각이어야 합니다.`,
    );
  }
  return new Date(value);
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 50;
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(value)) {
    throw new BadRequestException('limit는 1~100의 정수여야 합니다.');
  }
  return Number(value);
}

function parseOffset(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^(?:0|[1-9][0-9]{0,3}|10000)$/.test(value)) {
    throw new BadRequestException('offset은 0~10000의 정수여야 합니다.');
  }
  return Number(value);
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly dataSource: DataSource) {}

  async record(manager: EntityManager, input: AdminAuditInput): Promise<void> {
    if (
      (input.actor !== null &&
        (input.actor.length === 0 || input.actor.length > 128)) ||
      input.action.length === 0 ||
      input.action.length > 100 ||
      input.target.length === 0 ||
      input.target.length > 200
    ) {
      throw new BadRequestException('감사 기록 필드가 올바르지 않습니다.');
    }
    await manager.query(
      `INSERT INTO "admin_audit" ("actor", "action", "target", "before", "after")
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        input.actor,
        input.action,
        input.target,
        JSON.stringify(input.before ?? null),
        JSON.stringify(input.after ?? null),
      ],
    );
  }

  async list(
    actor?: string,
    from?: string,
    to?: string,
    limit?: string,
    offset?: string,
  ) {
    if (actor !== undefined && (actor.length === 0 || actor.length > 128)) {
      throw new BadRequestException('actor 형식이 올바르지 않습니다.');
    }
    const fromDate = parseDate(from, 'from');
    const toDate = parseDate(to, 'to');
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('from은 to보다 늦을 수 없습니다.');
    }
    const count = parseLimit(limit);
    const skip = parseOffset(offset);
    const rows: AdminAuditRow[] = await this.dataSource.query(
      `SELECT "at", "actor", "action", "target", "before", "after"
       FROM "admin_audit"
       WHERE ($1::varchar IS NULL OR "actor" = $1)
         AND ($2::timestamptz IS NULL OR "at" >= $2)
         AND ($3::timestamptz IS NULL OR "at" <= $3)
       ORDER BY "at" DESC, "id" DESC
       LIMIT $4 OFFSET $5`,
      [actor ?? null, fromDate, toDate, count, skip],
    );
    return { items: rows };
  }
}
