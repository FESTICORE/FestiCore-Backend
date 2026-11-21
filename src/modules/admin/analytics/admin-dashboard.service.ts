import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { kstDate, type AnalyticsRange } from './admin-analytics.range';

export type DashboardGranularity = 'day' | 'week';

export interface DashboardPoint {
  date: string;
  count: number;
}

const DAY = 86_400_000;
const KST = 9 * 60 * 60 * 1000;

/** 비율은 0~1. 분모가 0이면 null(데이터 없음과 0%를 구분한다). */
const rate = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;

const int = (value: unknown) => Number(value ?? 0) || 0;

/** KST 날짜가 속한 주의 월요일(KST 날짜). */
export function kstWeekStart(date: string): string {
  const time = Date.parse(`${date}T00:00:00.000Z`);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - weekday * DAY).toISOString().slice(0, 10);
}

/** 기간의 모든 구간을 0으로 채운 뒤 집계 결과를 얹는다. */
export function fillBuckets(
  range: AnalyticsRange,
  granularity: DashboardGranularity,
  rows: { bucket: string; count: unknown }[],
): DashboardPoint[] {
  const keys: string[] = [];
  const last = Date.parse(`${range.to}T00:00:00.000Z`);
  for (
    let time = Date.parse(`${range.from}T00:00:00.000Z`);
    time <= last;
    time += DAY
  ) {
    const day = new Date(time).toISOString().slice(0, 10);
    const key = granularity === 'week' ? kstWeekStart(day) : day;
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  const counts = new Map(rows.map((row) => [row.bucket, int(row.count)]));
  return keys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly db: DataSource) {}

  private async count(sql: string, params: unknown[]): Promise<number> {
    const rows = await this.db.query<{ count: unknown }[]>(sql, params);
    return int(rows[0]?.count);
  }

  /** 오늘(KST) 요약과 현재 참여율. */
  async summary(now = Date.now()) {
    const today = kstDate(now);
    const start = new Date(
      Date.parse(`${today}T00:00:00.000Z`) - KST,
    ).toISOString();
    const end = new Date(Date.parse(start) + DAY).toISOString();
    const since30 = new Date(now - 30 * DAY).toISOString();
    const [
      newUsers,
      logins,
      activeDevices,
      totalUsers,
      pushOptIn,
      flagFollowers,
      crewMembers,
      notifications,
      notificationsRead,
    ] = await Promise.all([
      this.count(
        `SELECT count(*) FROM users WHERE "createdAt" >= $1 AND "createdAt" < $2`,
        [start, end],
      ),
      this.count(
        `SELECT count(*) FROM refresh_token_sessions WHERE "createdAt" >= $1 AND "createdAt" < $2`,
        [start, end],
      ),
      this.count(
        `SELECT count(DISTINCT "deviceId") FROM metric_events WHERE "receivedAt" >= $1 AND "receivedAt" < $2`,
        [start, end],
      ),
      this.count(`SELECT count(*) FROM users`, []),
      this.count(`SELECT count(*) FROM users WHERE "pushOptIn" = true`, []),
      this.count(`SELECT count(DISTINCT "userId") FROM flag_follows`, []),
      this.count(`SELECT count(DISTINCT "userId") FROM crew_members`, []),
      this.count(
        `SELECT count(*) FROM user_notifications WHERE "createdAt" >= $1`,
        [since30],
      ),
      this.count(
        `SELECT count(*) FROM user_notifications WHERE "createdAt" >= $1 AND "readAt" IS NOT NULL`,
        [since30],
      ),
    ]);
    return {
      date: today,
      newUsers,
      logins,
      activeDevices,
      totalUsers,
      engagement: {
        pushOptInRate: rate(pushOptIn, totalUsers),
        flagFollowerRate: rate(flagFollowers, totalUsers),
        crewMemberRate: rate(crewMembers, totalUsers),
        notificationReadRate: rate(notificationsRead, notifications),
        notifications30d: notifications,
      },
    };
  }

  /** 기간(KST) 동안 가입·로그인·활성 기기·깃발 팔로우 추이. */
  async trends(range: AnalyticsRange, granularity: DashboardGranularity) {
    const bucket = (column: string) =>
      granularity === 'week'
        ? `to_char(date_trunc('week', ${column} AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD')`
        : `to_char(${column} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;
    const series = (table: string, column: string, value = 'count(*)') =>
      this.db.query<{ bucket: string; count: unknown }[]>(
        `SELECT ${bucket(`"${column}"`)} AS bucket, ${value} AS count
           FROM ${table}
          WHERE "${column}" >= $1 AND "${column}" < $2
          GROUP BY 1`,
        [range.start, range.end],
      );
    const [signups, logins, activeDevices, follows] = await Promise.all([
      series('users', 'createdAt'),
      series('refresh_token_sessions', 'createdAt'),
      // 인덱스가 있는 수신 시각 기준(기기 시각 "at"에는 단독 인덱스가 없다).
      series('metric_events', 'receivedAt', 'count(DISTINCT "deviceId")'),
      series('flag_follows', 'followedAt'),
    ]);
    const fill = (rows: { bucket: string; count: unknown }[]) =>
      fillBuckets(range, granularity, rows);
    const signupSeries = fill(signups);
    return {
      from: range.from,
      to: range.to,
      granularity,
      totalSignups: signupSeries.reduce((sum, point) => sum + point.count, 0),
      signups: signupSeries,
      logins: fill(logins),
      activeDevices: fill(activeDevices),
      follows: fill(follows),
    };
  }
}
