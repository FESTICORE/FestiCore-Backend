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
  lastSeen: string;
  permalink: string;
};
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
  scope: 'shared';
  totalEvents: number | null;
  series: Point[];
  topEvents: { name: string; count: number }[];
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
          (isEmptyEnvironment(results[1]) || issuesEmpty)
        )
          totalEvents = 0;
        const succeeded =
          Number(totalEvents !== null) +
          Number(
            issuesValid ||
              (isEmptyEnvironment(results[1]) && totalEvents === 0),
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
      series: [],
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
      url.searchParams.set(
        'to_date',
        new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
      url.searchParams.set('limit', '10000');
      try {
        const raw = (await fetchAnalytics(
          url,
          `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`,
          true,
        )) as string;
        const byDate = new Map<string, number>();
        const byEvent = new Map<string, number>();
        const lines = raw.trim() ? raw.trim().split('\n') : [];
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
          // Only expose conventional static event identifiers, never arbitrary event names or event properties.
          if (
            /^[a-z][a-z0-9_.]{0,79}$/.test(event.event) &&
            !/\d{4}/.test(event.event)
          )
            byEvent.set(event.event, (byEvent.get(event.event) ?? 0) + 1);
        }
        const truncated = lines.length >= 10000;
        return {
          status: truncated ? 'partial' : 'ok',
          scope: 'shared' as const,
          totalEvents: [...byDate.values()].reduce(
            (sum, value) => sum + value,
            0,
          ),
          series: [...byDate]
            .sort()
            .map(([date, value]) => ({ date, count: value })),
          topEvents: [...byEvent]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, value]) => ({ name, count: value })),
          truncated,
        };
      } catch (error) {
        return empty(failure(error));
      }
    });
  }
}
