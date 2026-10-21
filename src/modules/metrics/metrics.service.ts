import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

const EVENT_NAMES = [
  'app.cold_start',
  'live.poll',
  'live.offline_banner',
  'pack.download',
  'screen.open',
  'offline.open',
  'status.update',
  'push.received',
] as const;
type EventName = (typeof EVENT_NAMES)[number];

export interface MetricEvent {
  name: EventName;
  at: string;
  festivalId?: string;
  value?: number;
  props?: Record<string, string | number | boolean>;
}

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DEVICE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FESTIVAL_ID = /^fst_[0-9a-z]{1,28}$/;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_DATE_TIME.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function validateEvents(body: unknown, now = Date.now()): MetricEvent[] {
  if (
    !object(body) ||
    Object.keys(body).length !== 1 ||
    !Array.isArray(body.events) ||
    body.events.length < 1 ||
    body.events.length > 100
  ) {
    throw new BadRequestException('events는 1~100개여야 합니다.');
  }
  if (JSON.stringify(body).length > 65_536) {
    throw new BadRequestException('메트릭 요청 본문이 너무 큽니다.');
  }
  return body.events.map((raw: unknown) => {
    if (!object(raw))
      throw new BadRequestException('메트릭 이벤트 형식이 올바르지 않습니다.');
    const keys = Object.keys(raw);
    if (
      keys.some(
        (key) => !['name', 'at', 'festivalId', 'value', 'props'].includes(key),
      ) ||
      !EVENT_NAMES.includes(raw.name as EventName) ||
      !timestamp(raw.at)
    ) {
      throw new BadRequestException('메트릭 이벤트 필드가 올바르지 않습니다.');
    }
    const at = Date.parse(raw.at);
    if (at < now - 7 * 86_400_000 || at > now + 5 * 60_000) {
      throw new BadRequestException(
        '메트릭 이벤트 시간이 허용 범위를 벗어났습니다.',
      );
    }
    if (
      raw.festivalId !== undefined &&
      (typeof raw.festivalId !== 'string' || !FESTIVAL_ID.test(raw.festivalId))
    ) {
      throw new BadRequestException('festivalId 형식이 올바르지 않습니다.');
    }
    if (
      raw.value !== undefined &&
      (typeof raw.value !== 'number' ||
        !Number.isFinite(raw.value) ||
        raw.value < 0)
    ) {
      throw new BadRequestException('value는 0 이상의 유한한 숫자여야 합니다.');
    }
    if (raw.props !== undefined) {
      if (!object(raw.props) || Object.keys(raw.props).length > 16) {
        throw new BadRequestException('props 형식이 올바르지 않습니다.');
      }
      for (const [key, value] of Object.entries(raw.props)) {
        if (
          !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ||
          /(?:token|secret|password|authorization|cookie|credential|api[_-]?key)/i.test(
            key,
          ) ||
          !(
            (typeof value === 'string' && value.length <= 256) ||
            (typeof value === 'number' && Number.isFinite(value)) ||
            typeof value === 'boolean'
          )
        ) {
          throw new BadRequestException('props 값이 올바르지 않습니다.');
        }
      }
    }
    if (
      (raw.name === 'app.cold_start' || raw.name === 'pack.download') &&
      typeof raw.value !== 'number'
    ) {
      throw new BadRequestException(`${raw.name}에는 value(ms)가 필요합니다.`);
    }
    const props = object(raw.props) ? raw.props : {};
    const pollStatus = props.status;
    if (
      raw.name === 'live.poll' &&
      pollStatus !== 200 &&
      pollStatus !== 304 &&
      pollStatus !== 'err'
    ) {
      throw new BadRequestException('live.poll에는 props.status가 필요합니다.');
    }
    if (
      (raw.name === 'screen.open' || raw.name === 'offline.open') &&
      (typeof props.screen !== 'string' || props.screen.trim().length === 0)
    ) {
      throw new BadRequestException(
        `${raw.name}에는 props.screen이 필요합니다.`,
      );
    }
    if (
      raw.name === 'status.update' &&
      ((props.kind !== 'flag' && props.kind !== 'crew') ||
        typeof props.queued !== 'boolean')
    ) {
      throw new BadRequestException(
        'status.update에는 props.kind와 props.queued가 필요합니다.',
      );
    }
    if (
      raw.name === 'push.received' &&
      (typeof props.type !== 'string' || props.type.trim().length === 0)
    ) {
      throw new BadRequestException(
        'push.received에는 props.type이 필요합니다.',
      );
    }
    return raw as unknown as MetricEvent;
  });
}

export function validateRange(
  festivalId: string | undefined,
  from: string | undefined,
  to: string | undefined,
  bucket: string | undefined,
  defaults: { from: string; to: string },
) {
  if (!festivalId || !FESTIVAL_ID.test(festivalId))
    throw new BadRequestException('festivalId가 필요합니다.');
  if (bucket !== undefined && bucket !== '1h' && bucket !== '1d')
    throw new BadRequestException('bucket은 1h 또는 1d여야 합니다.');
  const start = from ?? defaults.from;
  const end = to ?? defaults.to;
  if (!timestamp(start) || !timestamp(end))
    throw new BadRequestException(
      'from과 to는 시간대가 있는 ISO8601 시각이어야 합니다.',
    );
  const span = Date.parse(end) - Date.parse(start);
  if (span <= 0)
    throw new BadRequestException(
      '조회 종료 시각은 시작 시각보다 늦어야 합니다.',
    );
  return { start, end, bucket: bucket ?? '1h' };
}

@Injectable()
export class MetricsService {
  constructor(private readonly db: DataSource) {}

  async ingest(deviceId: string, body: unknown): Promise<void> {
    if (!DEVICE_ID.test(deviceId))
      throw new BadRequestException('X-Device-Id는 UUID v4여야 합니다.');
    const events = validateEvents(body);
    await this.db.query(
      `INSERT INTO "metric_events" ("deviceId", "festivalId", "name", "at", "value", "props")
       SELECT $1::uuid, e."festivalId", e."name", e."at"::timestamptz, e."value", COALESCE(e."props", '{}'::jsonb)
       FROM jsonb_to_recordset($2::jsonb) AS e(
         "festivalId" varchar(32), "name" varchar(32), "at" text,
         "value" double precision, "props" jsonb
       )`,
      [deviceId, JSON.stringify(events)],
    );
  }

  async report(
    festivalId: string | undefined,
    from?: string,
    to?: string,
    bucket?: string,
  ) {
    if (!festivalId || !FESTIVAL_ID.test(festivalId))
      throw new BadRequestException('festivalId가 필요합니다.');
    const [festival]: { firstStart: string | null; lastEnd: string | null }[] =
      await this.db.query(
        `SELECT "published"->'days'->0->>'startsAt' AS "firstStart",
              "published"->'days'->-1->>'endsAt' AS "lastEnd"
       FROM "admin_festivals" WHERE "id" = $1 AND "published" IS NOT NULL`,
        [festivalId],
      );
    if (!festival) throw new NotFoundException('발행된 축제가 없습니다.');
    if (!festival.firstStart || !festival.lastEnd)
      throw new BadRequestException('축제 기간이 설정되지 않았습니다.');
    const range = validateRange(festivalId, from, to, bucket, {
      from: festival.firstStart,
      to: festival.lastEnd,
    });
    const rows: Array<Record<string, unknown>> = await this.db.query(
      `WITH metrics AS (
       SELECT date_trunc($4, "at" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS "at",
              count(DISTINCT "deviceId")::int AS "activeDevices",
              count(*) FILTER (WHERE "name" = 'live.poll')::int AS "liveRequests",
              COALESCE(count(*) FILTER (WHERE "name" = 'live.poll' AND "props"->>'status' = '304')::float /
                NULLIF(count(*) FILTER (WHERE "name" = 'live.poll'), 0), 0) AS "live304Rate",
              COALESCE(count(*) FILTER (WHERE "name" = 'live.poll' AND "props"->>'status' = 'err')::float /
                NULLIF(count(*) FILTER (WHERE "name" = 'live.poll'), 0), 0) AS "liveErrorRate",
              count(*) FILTER (WHERE "name" = 'status.update')::int AS "statusUpdates",
              count(*) FILTER (WHERE "name" = 'offline.open')::int AS "offlineOpens",
              percentile_cont(0.95) WITHIN GROUP (ORDER BY "value")
                FILTER (WHERE "name" = 'app.cold_start') AS "coldStartP95Ms"
       FROM "metric_events"
       WHERE "festivalId" = $1 AND "at" >= $2::timestamptz AND "at" < $3::timestamptz
       GROUP BY 1
       ), follows AS (
         SELECT date_trunc($4, "followedAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS "at",
                count(*)::int AS "follows"
         FROM "flag_follows"
         WHERE "festivalId" = $1 AND "followedAt" >= $2::timestamptz
           AND "followedAt" < $3::timestamptz
         GROUP BY 1
       ), joins AS (
         SELECT date_trunc($4, "joinedAt" AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS "at",
                count(*)::int AS "crewJoins"
         FROM "crew_members"
         WHERE "festivalId" = $1 AND "joinedAt" >= $2::timestamptz
           AND "joinedAt" < $3::timestamptz
         GROUP BY 1
       )
       SELECT COALESCE(m."at", f."at", j."at") AS "at",
              COALESCE(m."activeDevices", 0) AS "activeDevices",
              COALESCE(m."liveRequests", 0) AS "liveRequests",
              COALESCE(m."live304Rate", 0) AS "live304Rate",
              COALESCE(m."liveErrorRate", 0) AS "liveErrorRate",
              COALESCE(m."statusUpdates", 0) AS "statusUpdates",
              COALESCE(f."follows", 0) AS "follows",
              COALESCE(j."crewJoins", 0) AS "crewJoins",
              COALESCE(m."offlineOpens", 0) AS "offlineOpens",
              m."coldStartP95Ms" AS "coldStartP95Ms"
       FROM metrics m
       FULL OUTER JOIN follows f ON m."at" = f."at"
       FULL OUTER JOIN joins j ON COALESCE(m."at", f."at") = j."at"
       ORDER BY "at"`,
      [
        festivalId,
        range.start,
        range.end,
        range.bucket === '1h' ? 'hour' : 'day',
      ],
    );
    return {
      buckets: rows.map((row) => ({
        at: (row.at as Date).toISOString(),
        activeDevices: Number(row.activeDevices),
        liveRequests: Number(row.liveRequests),
        live304Rate: Number(row.live304Rate),
        liveErrorRate: Number(row.liveErrorRate),
        statusUpdates: Number(row.statusUpdates),
        follows: Number(row.follows),
        crewJoins: Number(row.crewJoins),
        offlineOpens: Number(row.offlineOpens),
        coldStartP95Ms:
          row.coldStartP95Ms === null ? null : Number(row.coldStartP95Ms),
      })),
    };
  }
}
