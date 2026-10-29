import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ADMIN_ROLES_KEY } from '../auth/admin-roles.decorator';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { parseAnalyticsRange } from './admin-analytics.range';
import { AdminAnalyticsService } from './admin-analytics.service';
import type { Response } from 'express';

const range = () => parseAnalyticsRange('2026-10-20', '2026-10-21');
const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as ConfigService;

describe('admin analytics', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requires viewer and rejects bad date/project before fetching', () => {
    const service = new AdminAnalyticsService(config({}));
    const controller = new AdminAnalyticsController(service);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, controller.sentry)).toEqual([
      'viewer',
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, controller.mixpanel)).toEqual([
      'viewer',
    ]);
    const response = { setHeader: jest.fn() } as unknown as Response;
    expect(() =>
      controller.sentry(response, '2026-10-20', '2026-10-21', 'other'),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.mixpanel(response, '2026-02-30', '2026-03-01'),
    ).toThrow(BadRequestException);
    expect(() => parseAnalyticsRange('2026-09-01', '2026-10-02')).toThrow(
      BadRequestException,
    );
    expect(range().start).toBe('2026-10-19T15:00:00.000Z');
    expect(range().end).toBe('2026-10-21T15:00:00.000Z');
  });

  it('returns unconfigured without external calls or fabricated zero', async () => {
    global.fetch = jest.fn();
    const service = new AdminAnalyticsService(config({}));
    await expect(service.sentry(range(), 'ios')).resolves.toMatchObject({
      status: 'unconfigured',
      totalEvents: null,
    });
    await expect(service.mixpanel(range())).resolves.toMatchObject({
      status: 'unconfigured',
      totalEvents: null,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('scopes Sentry requests and handles a rate limited subrequest as partial', async () => {
    global.fetch = jest.fn((url: URL) =>
      Promise.resolve(
        new Response(
          url.pathname.endsWith('issues/')
            ? ''
            : JSON.stringify({
                timeSeries: [
                  {
                    values: [
                      {
                        timestamp: Date.parse('2026-10-20T00:00:00Z'),
                        value: 3,
                      },
                    ],
                  },
                ],
              }),
          { status: url.pathname.endsWith('issues/') ? 429 : 200 },
        ),
      ),
    ) as typeof fetch;
    const service = new AdminAnalyticsService(
      config({
        ANALYTICS_ENVIRONMENT: 'stage',
        SENTRY_IOS_PROJECT_ID: '123',
        SENTRY_ANALYTICS_READ_TOKEN: 'read-token',
      }),
    );
    await expect(service.sentry(range(), 'ios')).resolves.toMatchObject({
      status: 'partial',
      totalEvents: 3,
      issues: [],
    });
    const calls = (global.fetch as jest.Mock).mock.calls as [URL][];
    expect(calls).toHaveLength(2);
    for (const [url] of calls) {
      expect(url.host).toBe('de.sentry.io');
      expect(url.searchParams.get('project')).toBe('123');
      expect(url.searchParams.get('environment')).toBe('stage');
    }
  });

  it('counts Mixpanel export in KST and shares concurrent requests', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(
          [
            JSON.stringify({
              event: 'app_open',
              properties: {
                time: Date.parse('2026-10-19T15:30:00Z') / 1000,
                email: 'private@example.com',
              },
            }),
            JSON.stringify({
              event: 'user@example.com',
              properties: { time: Date.parse('2026-10-20T00:00:00Z') / 1000 },
            }),
            JSON.stringify({
              event: 'app_open',
              properties: { time: Date.parse('2026-10-19T14:00:00Z') / 1000 },
            }),
          ].join('\n'),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;
    const service = new AdminAnalyticsService(
      config({
        MIXPANEL_SERVICE_ACCOUNT_USERNAME: 'reader',
        MIXPANEL_SERVICE_ACCOUNT_SECRET: 'secret',
      }),
    );
    const [first, second] = await Promise.all([
      service.mixpanel(range()),
      service.mixpanel(range()),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 'ok',
      totalEvents: 2,
      series: [{ date: '2026-10-20', count: 2 }],
      topEvents: [{ name: 'app_open', count: 1 }],
      truncated: false,
    });
    expect(JSON.stringify(first)).not.toContain('private@example.com');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
