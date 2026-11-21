import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsFetchError, fetchAnalytics } from './admin-analytics.fetch';
import { AnalyticsRange, kstDate } from './admin-analytics.range';

type Status = 'unconfigured' | 'ok' | 'error' | 'rate_limited' | 'partial';
type Point = { date: string; count: number };
type SentryIssue = {
  id: string;
  title: string;
  count: number;
  userCount: number | null;
  level: SentryLevel | null;
  firstSeen: string | null;
  lastSeen: string;
  permalink: string;
};
type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';
const sentryLevels: readonly string[] = [
  'fatal',
  'error',
  'warning',
  'info',
  'debug',
];
type SentryResult = {
  status: Status;
  scope: string;
  project: 'ios' | 'backend';
  totalEvents: number | null;
  series: Point[];
  issues: SentryIssue[];
};
type MixpanelResult = {
  status: Status;
  reason?: 'unauthorized' | 'forbidden' | 'incomplete_export';
  scope: 'shared';
  totalEvents: number | null;
  /** 기간 안 고유 distinct_id 수. 식별자 자체는 내려주지 않는다. */
  uniqueUsers: number | null;
  series: Point[];
  userSeries: Point[];
  topEvents: { name: string; count: number; users: number; series: Point[] }[];
  truncated: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): number | null => {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};
const failure = (error: unknown): Status =>
  error instanceof AnalyticsFetchError && error.kind === 'rate_limited'
    ? 'rate_limited'
    : 'error';
const isEmptyEnvironment = (result: PromiseSettledResult<unknown>): boolean =>
  result.status === 'rejected' &&
  result.reason instanceof AnalyticsFetchError &&
  result.reason.kind === 'empty_environment';
const isEmptyIssues = (result: PromiseSettledResult<unknown>): boolean =>
  result.status === 'rejected' &&
  result.reason instanceof AnalyticsFetchError &&
  result.reason.kind === 'empty_issues';

@Injectable()
export class AdminAnalyticsService {
  private readonly cache = new Map<
    string,
    { expires: number; value: SentryResult | MixpanelResult }
  >();
  private readonly inFlight = new Map<
    string,
    Promise<SentryResult | MixpanelResult>
  >();

  constructor(private readonly config: ConfigService) {}

  private cached<T extends SentryResult | MixpanelResult>(
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const saved = this.cache.get(key);
    if (saved && saved.expires > Date.now())
      return Promise.resolve(saved.value as T);
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const work = load()
      .then((value) => {
        this.cache.set(key, {
          value,
          expires: Date.now() + (value.status === 'ok' ? 60_000 : 10_000),
        });
        if (this.cache.size > 100) {
          const oldest: unknown = this.cache.keys().next().value;
          if (typeof oldest === 'string') this.cache.delete(oldest);
        }
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  sentry(
    range: AnalyticsRange,
    project: 'ios' | 'backend',
  ): Promise<SentryResult> {
    const environment = this.config.get<string>('ANALYTICS_ENVIRONMENT');
    const projectId = this.config.get<string>(
      project === 'ios' ? 'SENTRY_IOS_PROJECT_ID' : 'SENTRY_BACKEND_PROJECT_ID',
    );
    const token = this.config.get<string>('SENTRY_ANALYTICS_READ_TOKEN');
    const scope =
      environment === 'stage' || environment === 'production'
        ? environment
        : 'unconfigured';
    const empty = (status: Status): SentryResult => ({
      status,
      scope,
      project,
      totalEvents: null,
      series: [],
      issues: [],
    });
    if (
      scope === 'unconfigured' ||
      !projectId ||
      !/^\d+$/.test(projectId) ||
      !token
    )
      return Promise.resolve(empty('unconfigured'));
    return this.cached(
      `sentry:${scope}:${projectId}:${range.from}:${range.to}`,
      async () => {
        const base = 'https://de.sentry.io/api/0/organizations/festicore/';
        const params = new URLSearchParams({
          project: projectId,
          environment: scope,
          start: range.start,
          end: range.end,
        });
        const timeseries = new URL(`events-timeseries/?${params}`, base);
        timeseries.searchParams.set('dataset', 'errors');
        timeseries.searchParams.set('yAxis', 'count()');
        timeseries.searchParams.set('interval', '3600');
        const issuesUrl = new URL(`issues/?${params}`, base);
        issuesUrl.searchParams.set('query', '');
        issuesUrl.searchParams.set('sort', 'freq');
        issuesUrl.searchParams.set('per_page', '10');
        const results = await Promise.allSettled([
          fetchAnalytics(timeseries, `Bearer ${token}`),
          fetchAnalytics(issuesUrl, `Bearer ${token}`),
        ]);
        const series: Point[] = [];
        let totalEvents: number | null = null;
        let incomplete = false;
        const issues: SentryIssue[] = [];
        if (results[0].status === 'fulfilled') {
          const data = results[0].value;
          const axes = isObject(data) ? data.timeSeries : null;
          if (
            Array.isArray(axes) &&
            axes.length === 1 &&
            isObject(axes[0]) &&
            Array.isArray(axes[0].values)
          ) {
            const byDate = new Map<string, number>();
            let valid = true;
            for (const point of axes[0].values as unknown[]) {
              if (
                !isObject(point) ||
                typeof point.timestamp !== 'number' ||
                count(point.value) === null
              ) {
                valid = false;
                break;
              }
              if (point.incomplete === true) incomplete = true;
              const day = kstDate(point.timestamp);
              if (day >= range.from && day <= range.to)
                byDate.set(day, (byDate.get(day) ?? 0) + count(point.value)!);
            }
            if (valid) {
              totalEvents = [...byDate.values()].reduce(
                (sum, value) => sum + value,
                0,
              );
              series.push(
                ...[...byDate]
                  .sort()
                  .map(([date, value]) => ({ date, count: value })),
              );
            }
          }
        }
        if (
          results[1].status === 'fulfilled' &&
          Array.isArray(results[1].value)
        ) {
          for (const row of results[1].value.slice(0, 10) as unknown[]) {
            if (
              !isObject(row) ||
              typeof row.id !== 'string' ||
              !/^\d+$/.test(row.id) ||
              count(row.count) === null ||
              typeof row.lastSeen !== 'string'
            )
              continue;
            issues.push({
              id: row.id,
              title: 'Sentry issue',
              count: count(row.count)!,
              userCount: count(row.userCount),
              level:
                typeof row.level === 'string' &&
                sentryLevels.includes(row.level)
                  ? (row.level as SentryLevel)
                  : null,
              firstSeen:
                typeof row.firstSeen === 'string' &&
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(row.firstSeen) &&
                Number.isFinite(Date.parse(row.firstSeen))
                  ? new Date(row.firstSeen).toISOString()
                  : null,
              lastSeen: row.lastSeen,
              permalink: `https://festicore.sentry.io/issues/${row.id}/`,
            });
          }
        }
        const issuesValid =
          results[1].status === 'fulfilled' && Array.isArray(results[1].value);
        const issuesEmpty =
          results[1].status === 'fulfilled' &&
          Array.isArray(results[1].value) &&
          results[1].value.length === 0;
        if (
          isEmptyEnvironment(results[0]) &&
          (isEmptyEnvironment(results[1]) ||
            isEmptyIssues(results[1]) ||
            issuesEmpty)
        )
          totalEvents = 0;
        const succeeded =
          Number(totalEvents !== null) +
          Number(
            issuesValid ||
              ((isEmptyEnvironment(results[1]) || isEmptyIssues(results[1])) &&
                isEmptyEnvironment(results[0]) &&
                totalEvents === 0),
          );
        if (succeeded === 2)
          return {
            status: incomplete ? 'partial' : 'ok',
            scope,
            project,
            totalEvents,
            series,
            issues,
          };
        if (succeeded === 1)
          return {
            status: 'partial',
            scope,
            project,
            totalEvents,
            series,
            issues,
          };
        const rejected = results.find((r) => r.status === 'rejected');
        return empty(
          rejected?.status === 'rejected' ? failure(rejected.reason) : 'error',
        );
      },
    );
  }

  mixpanel(range: AnalyticsRange): Promise<MixpanelResult> {
    const username = this.config.get<string>(
      'MIXPANEL_SERVICE_ACCOUNT_USERNAME',
    );
    const secret = this.config.get<string>('MIXPANEL_SERVICE_ACCOUNT_SECRET');
    const empty = (status: Status): MixpanelResult => ({
      status,
      scope: 'shared',
      totalEvents: null,
      uniqueUsers: null,
      series: [],
      userSeries: [],
      topEvents: [],
      truncated: false,
    });
    if (!username || !secret) return Promise.resolve(empty('unconfigured'));
    return this.cached(`mixpanel:${range.from}:${range.to}`, async () => {
      const url = new URL('https://data.mixpanel.com/api/2.0/export');
      url.searchParams.set('project_id', '4078612');
      // Mixpanel may interpret export dates in UTC; include neighbouring dates and filter timestamps to KST below.
      url.searchParams.set(
        'from_date',
        new Date(Date.parse(`${range.from}T00:00:00Z`) - 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
      // Mixpanel은 오늘(UTC) 이후의 to_date를 400으로 거절하므로 다음 날 보정은 오늘까지만 한다.
      const todayUtc = new Date().toISOString().slice(0, 10);
      const nextDay = new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      url.searchParams.set('to_date', nextDay > todayUtc ? todayUtc : nextDay);
      url.searchParams.set('limit', '10000');
      try {
        const raw = (await fetchAnalytics(
          url,
          `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`,
          true,
        )) as string;
        const byDate = new Map<string, number>();
        const byEvent = new Map<string, number>();
        const users = new Set<string>();
        const usersByDate = new Map<string, Set<string>>();
        const eventDates = new Map<string, Map<string, number>>();
        const eventUsers = new Map<string, Set<string>>();
        const lines = raw.trim() ? raw.trim().split('\n') : [];
        if (lines.some((line) => line.trim() === 'terminated early'))
          throw new AnalyticsFetchError('incomplete_export');
        for (const line of lines) {
          const event = JSON.parse(line) as unknown;
          if (
            !isObject(event) ||
            !isObject(event.properties) ||
            typeof event.event !== 'string' ||
            typeof event.properties.time !== 'number'
          )
            throw new Error('invalid export');
          const date = kstDate(event.properties.time * 1000);
          if (date < range.from || date > range.to) continue;
          byDate.set(date, (byDate.get(date) ?? 0) + 1);
          const user =
            typeof event.properties.distinct_id === 'string' &&
            event.properties.distinct_id
              ? event.properties.distinct_id
              : null;
          if (user) {
            users.add(user);
            const daily = usersByDate.get(date) ?? new Set<string>();
            daily.add(user);
            usersByDate.set(date, daily);
          }
          // Only expose conventional static event identifiers, never arbitrary event names or event properties.
          if (
            /^[a-z][a-z0-9_.]{0,79}$/.test(event.event) &&
            !/\d{4}/.test(event.event)
          ) {
            byEvent.set(event.event, (byEvent.get(event.event) ?? 0) + 1);
            const dates =
              eventDates.get(event.event) ?? new Map<string, number>();
            dates.set(date, (dates.get(date) ?? 0) + 1);
            eventDates.set(event.event, dates);
            if (user) {
              const seen = eventUsers.get(event.event) ?? new Set<string>();
              seen.add(user);
              eventUsers.set(event.event, seen);
            }
          }
        }
        const truncated = lines.length >= 10000;
        return {
          status: truncated ? 'partial' : 'ok',
          scope: 'shared' as const,
          totalEvents: [...byDate.values()].reduce(
            (sum, value) => sum + value,
            0,
          ),
          uniqueUsers: users.size,
          series: [...byDate]
            .sort()
            .map(([date, value]) => ({ date, count: value })),
          userSeries: [...usersByDate]
            .sort()
            .map(([date, value]) => ({ date, count: value.size })),
          topEvents: [...byEvent]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, value]) => ({
              name,
              count: value,
              users: eventUsers.get(name)?.size ?? 0,
              series: [...(eventDates.get(name) ?? [])]
                .sort()
                .map(([date, total]) => ({ date, count: total })),
            })),
          truncated,
        };
      } catch (error) {
        const result = empty(failure(error));
        if (
          error instanceof AnalyticsFetchError &&
          (error.kind === 'unauthorized' ||
            error.kind === 'forbidden' ||
            error.kind === 'incomplete_export')
        ) {
          result.reason = error.kind;
        }
        return result;
      }
    });
  }
}
