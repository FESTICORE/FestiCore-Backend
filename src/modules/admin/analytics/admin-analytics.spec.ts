import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ADMIN_ROLES_KEY } from '../auth/admin-roles.decorator';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { parseAnalyticsRange } from './admin-analytics.range';
import {
  AdminAnalyticsService,
  parseFunnelSteps,
} from './admin-analytics.service';
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

  it('Sentry 환경이 아직 없다는 404만 실제 0건으로 표시한다', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ detail: 'Unknown environments selected' }),
          {
            status: 404,
          },
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
    await expect(service.sentry(range(), 'ios')).resolves.toEqual({
      status: 'ok',
      scope: 'stage',
      project: 'ios',
      totalEvents: 0,
      series: [],
      issues: [],
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('시간대 조회가 환경 없음이고 이슈 조회가 빈 배열이면 0건으로 표시한다', async () => {
    global.fetch = jest.fn((url: URL) =>
      Promise.resolve(
        url.pathname.endsWith('issues/')
          ? new Response('[]', { status: 200 })
          : new Response(
              JSON.stringify({ detail: 'Unknown environments selected' }),
              { status: 404 },
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
      status: 'ok',
      totalEvents: 0,
      series: [],
      issues: [],
    });
  });

  it('빈 환경의 시간대 404와 이슈 목록 404를 실제 0건으로 표시한다', async () => {
    global.fetch = jest.fn((url: URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            detail: url.pathname.endsWith('issues/')
              ? 'The requested resource does not exist'
              : 'Unknown environments selected',
          }),
          { status: 404 },
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
      status: 'ok',
      totalEvents: 0,
      series: [],
      issues: [],
    });
  });

  it('정상 시간대 조회와 이슈 목록 404만으로는 완전한 결과로 표시하지 않는다', async () => {
    global.fetch = jest.fn((url: URL) =>
      Promise.resolve(
        url.pathname.endsWith('issues/')
          ? new Response(
              JSON.stringify({
                detail: 'The requested resource does not exist',
              }),
              { status: 404 },
            )
          : new Response(JSON.stringify({ timeSeries: [{ values: [] }] }), {
              status: 200,
            }),
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
      totalEvents: 0,
      issues: [],
    });
  });

  it.each([
    { status: 401, body: 'Unauthorized' },
    { status: 404, body: JSON.stringify({ detail: 'Project not found' }) },
  ])(
    'Sentry $status 응답을 환경 없음으로 오인하지 않는다',
    async ({ status, body }) => {
      global.fetch = jest.fn(() =>
        Promise.resolve(new Response(body, { status })),
      ) as typeof fetch;
      const service = new AdminAnalyticsService(
        config({
          ANALYTICS_ENVIRONMENT: 'stage',
          SENTRY_IOS_PROJECT_ID: '123',
          SENTRY_ANALYTICS_READ_TOKEN: 'read-token',
        }),
      );
      await expect(service.sentry(range(), 'ios')).resolves.toMatchObject({
        status: 'error',
        totalEvents: null,
        series: [],
        issues: [],
      });
    },
  );

  it('한 조회만 환경 없음이고 다른 조회가 실제 404면 0건으로 단정하지 않는다', async () => {
    global.fetch = jest.fn((url: URL) =>
      Promise.resolve(
        new Response(
          url.pathname.endsWith('issues/')
            ? JSON.stringify({ detail: 'Project not found' })
            : JSON.stringify({ detail: 'Unknown environments selected' }),
          { status: 404 },
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
      status: 'error',
      totalEvents: null,
    });
  });

  it('Sentry 이슈에 영향 사용자 수·level·firstSeen을 넣고 이상한 값은 null로 둔다', async () => {
    global.fetch = jest.fn((url: URL) =>
      Promise.resolve(
        new Response(
          url.pathname.endsWith('issues/')
            ? JSON.stringify([
                {
                  id: '11',
                  title: 'TypeError: secret detail',
                  count: '4',
                  userCount: 2,
                  level: 'fatal',
                  firstSeen: '2026-10-18T01:00:00Z',
                  lastSeen: '2026-10-20T01:00:00Z',
                },
                {
                  id: '12',
                  count: 1,
                  userCount: -1,
                  level: '<script>',
                  firstSeen: '1',
                  lastSeen: '2026-10-20T02:00:00Z',
                },
              ])
            : JSON.stringify({ timeSeries: [{ values: [] }] }),
          { status: 200 },
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
    const result = await service.sentry(range(), 'ios');
    expect(result.issues).toEqual([
      expect.objectContaining({
        id: '11',
        title: 'Sentry issue',
        count: 4,
        userCount: 2,
        level: 'fatal',
        firstSeen: '2026-10-18T01:00:00.000Z',
      }),
      expect.objectContaining({
        id: '12',
        userCount: null,
        level: null,
        firstSeen: null,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('secret detail');
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
                distinct_id: 'user-secret-a',
              },
            }),
            JSON.stringify({
              event: 'user@example.com',
              properties: {
                time: Date.parse('2026-10-20T00:00:00Z') / 1000,
                distinct_id: 'user-secret-b',
              },
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
      uniqueUsers: 2,
      userSeries: [{ date: '2026-10-20', count: 2 }],
      topEvents: [
        {
          name: 'app_open',
          count: 1,
          users: 1,
          series: [{ date: '2026-10-20', count: 1 }],
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(first)).not.toContain('private@example.com');
    expect(JSON.stringify(first)).not.toContain('user-secret');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
  ])(
    'distinguishes Mixpanel HTTP %i without exposing upstream data',
    async (status, reason) => {
      global.fetch = jest.fn(() =>
        Promise.resolve(new Response('private upstream details', { status })),
      ) as typeof fetch;
      const service = new AdminAnalyticsService(
        config({
          MIXPANEL_SERVICE_ACCOUNT_USERNAME: 'reader',
          MIXPANEL_SERVICE_ACCOUNT_SECRET: 'private-secret',
        }),
      );
      const result = await service.mixpanel(range());
      expect(result).toEqual({
        status: 'error',
        reason,
        scope: 'shared',
        totalEvents: null,
        uniqueUsers: null,
        series: [],
        userSeries: [],
        topEvents: [],
        truncated: false,
      });
      expect(JSON.stringify(result)).not.toContain('private');
    },
  );

  it('같은 distinct_id가 여러 날·여러 이벤트에 나와도 사용자는 한 번만 센다', async () => {
    const row = (event: string, iso: string, user?: string) =>
      JSON.stringify({
        event,
        properties: { time: Date.parse(iso) / 1000, distinct_id: user },
      });
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(
          [
            row('app_open', '2026-10-19T16:00:00Z', 'u1'),
            row('app_open', '2026-10-19T17:00:00Z', 'u1'),
            row('flag_follow', '2026-10-19T18:00:00Z', 'u1'),
            row('app_open', '2026-10-19T19:00:00Z', 'u2'),
            row('app_open', '2026-10-19T20:00:00Z'),
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
    const result = await service.mixpanel(range());
    expect(result).toMatchObject({
      totalEvents: 5,
      uniqueUsers: 2,
      userSeries: [{ date: '2026-10-20', count: 2 }],
      topEvents: [
        {
          name: 'app_open',
          count: 4,
          users: 2,
          series: [{ date: '2026-10-20', count: 4 }],
        },
        { name: 'flag_follow', count: 1, users: 1 },
      ],
    });
  });

  describe('Mixpanel 퍼널', () => {
    const row = (event: string, iso: string, user?: string) =>
      JSON.stringify({
        event,
        properties: { time: Date.parse(iso) / 1000, distinct_id: user },
      });
    const mixpanelConfig = config({
      MIXPANEL_SERVICE_ACCOUNT_USERNAME: 'reader',
      MIXPANEL_SERVICE_ACCOUNT_SECRET: 'secret',
    });

    it('단계는 공개 가능한 이벤트 이름 2~5개만 받고 viewer 권한이 필요하다', () => {
      expect(parseFunnelSteps('app_open,flag_follow')).toEqual([
        'app_open',
        'flag_follow',
      ]);
      for (const bad of [
        undefined,
        'app_open',
        'a,b,c,d,e,f',
        'app_open,',
        'app_open,Bad Event',
        'app_open,event_2026',
      ])
        expect(() => parseFunnelSteps(bad)).toThrow(BadRequestException);
      const controller = new AdminAnalyticsController(
        new AdminAnalyticsService(config({})),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(Reflect.getMetadata(ADMIN_ROLES_KEY, controller.funnel)).toEqual([
        'viewer',
      ]);
    });

    it('사용자별로 시간순 도달만 세고 식별자는 내려주지 않는다', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve(
          new Response(
            [
              // u1: 순서대로 세 단계 모두 도달
              row('app_open', '2026-10-19T16:00:00Z', 'user-secret-1'),
              row('flag_follow', '2026-10-19T17:00:00Z', 'user-secret-1'),
              row('pack_sync', '2026-10-20T01:00:00Z', 'user-secret-1'),
              // u2: 두 번째 단계를 첫 단계보다 먼저 해서 1단계만 인정
              row('flag_follow', '2026-10-19T16:30:00Z', 'user-secret-2'),
              row('app_open', '2026-10-19T18:00:00Z', 'user-secret-2'),
              // u3: 범위 밖(KST 10/19) 이벤트는 제외되어 1단계만
              row('app_open', '2026-10-20T02:00:00Z', 'user-secret-3'),
              row('flag_follow', '2026-10-18T10:00:00Z', 'user-secret-3'),
              // distinct_id 없는 이벤트는 퍼널에서 빠진다
              row('app_open', '2026-10-19T19:00:00Z'),
            ].join('\n'),
            { status: 200 },
          ),
        ),
      ) as typeof fetch;
      const result = await new AdminAnalyticsService(mixpanelConfig).funnel(
        range(),
        ['app_open', 'flag_follow', 'pack_sync'],
      );
      expect(result).toEqual({
        status: 'ok',
        scope: 'shared',
        steps: [
          { name: 'app_open', users: 3 },
          { name: 'flag_follow', users: 1 },
          { name: 'pack_sync', users: 1 },
        ],
        truncated: false,
      });
      expect(JSON.stringify(result)).not.toContain('user-secret');
    });

    it('같은 초의 이벤트는 export 행 순서와 상관없이 단계 순서대로 본다', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve(
          new Response(
            [
              row('flag_follow', '2026-10-19T16:00:00Z', 'u1'),
              row('app_open', '2026-10-19T16:00:00Z', 'u1'),
            ].join('\n'),
            { status: 200 },
          ),
        ),
      ) as typeof fetch;
      const result = await new AdminAnalyticsService(mixpanelConfig).funnel(
        range(),
        ['app_open', 'flag_follow'],
      );
      expect(result.steps).toEqual([
        { name: 'app_open', users: 1 },
        { name: 'flag_follow', users: 1 },
      ]);
    });

    it('지표와 퍼널이 같은 기간이면 Mixpanel export를 한 번만 부른다', async () => {
      const fetchMock = jest.fn(() =>
        Promise.resolve(
          new Response(row('app_open', '2026-10-19T16:00:00Z', 'u1'), {
            status: 200,
          }),
        ),
      );
      global.fetch = fetchMock;
      const service = new AdminAnalyticsService(mixpanelConfig);
      await Promise.all([
        service.mixpanel(range()),
        service.funnel(range(), ['app_open', 'flag_follow']),
      ]);
      await service.funnel(range(), ['app_open', 'pack_sync']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('설정이 없으면 외부 호출 없이 null 단계로, 실패는 이유와 함께 돌려준다', async () => {
      const fetchMock = jest.fn(() =>
        Promise.resolve(new Response('', { status: 403 })),
      );
      global.fetch = fetchMock;
      await expect(
        new AdminAnalyticsService(config({})).funnel(range(), ['a', 'b']),
      ).resolves.toEqual({
        status: 'unconfigured',
        scope: 'shared',
        steps: [
          { name: 'a', users: null },
          { name: 'b', users: null },
        ],
        truncated: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      const service = new AdminAnalyticsService(mixpanelConfig);
      await expect(service.funnel(range(), ['a', 'b'])).resolves.toMatchObject({
        status: 'error',
        reason: 'forbidden',
        steps: [{ users: null }, {}],
      });
      // 실패한 export는 공유 캐시에 남지 않아 다음 조회가 다시 시도한다.
      await service.mixpanel(range());
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('does not request a Mixpanel to_date later than today (UTC)', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-21T05:00:00Z') });
    const fetchMock = jest.fn<Promise<globalThis.Response>, [URL]>(() =>
      Promise.resolve(new Response('', { status: 200 })),
    );
    global.fetch = fetchMock;
    try {
      const service = new AdminAnalyticsService(
        config({
          MIXPANEL_SERVICE_ACCOUNT_USERNAME: 'reader',
          MIXPANEL_SERVICE_ACCOUNT_SECRET: 'secret',
        }),
      );
      await service.mixpanel(range());
      const requested = fetchMock.mock.calls[0][0];
      expect(requested.searchParams.get('to_date')).toBe('2026-10-21');
      expect(requested.searchParams.get('from_date')).toBe('2026-10-19');
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    'terminated early\n',
    `${JSON.stringify({ event: 'app_open', properties: { time: Date.parse('2026-10-20T00:00:00Z') / 1000 } })}\nterminated early\n`,
  ])(
    'rejects a terminated Mixpanel export without returning partial counts',
    async (body) => {
      global.fetch = jest.fn(() =>
        Promise.resolve(new Response(body, { status: 200 })),
      ) as typeof fetch;
      const service = new AdminAnalyticsService(
        config({
          MIXPANEL_SERVICE_ACCOUNT_USERNAME: 'reader',
          MIXPANEL_SERVICE_ACCOUNT_SECRET: 'private-secret',
        }),
      );
      const result = await service.mixpanel(range());
      expect(result).toEqual({
        status: 'error',
        reason: 'incomplete_export',
        scope: 'shared',
        totalEvents: null,
        uniqueUsers: null,
        series: [],
        userSeries: [],
        topEvents: [],
        truncated: false,
      });
      expect(JSON.stringify(result)).not.toContain('terminated early');
      expect(JSON.stringify(result)).not.toContain('app_open');
      expect(JSON.stringify(result)).not.toContain('private-secret');
    },
  );

  it('keeps a successful blank Mixpanel export as zero events', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response('\n  \n', { status: 200 })),
    ) as typeof fetch;
    const service = new AdminAnalyticsService(
      config({
        MIXPANEL_SERVICE_ACCOUNT_USERNAME: 'reader',
        MIXPANEL_SERVICE_ACCOUNT_SECRET: 'secret',
      }),
    );
    expect(await service.mixpanel(range())).toEqual({
      status: 'ok',
      scope: 'shared',
      totalEvents: 0,
      uniqueUsers: 0,
      series: [],
      userSeries: [],
      topEvents: [],
      truncated: false,
    });
  });

  it.each([429, 500])(
    'does not misclassify Mixpanel HTTP %i as a credential failure',
    async (status) => {
      global.fetch = jest.fn(() =>
        Promise.resolve(new Response('', { status })),
      ) as typeof fetch;
      const service = new AdminAnalyticsService(
        config({
          MIXPANEL_SERVICE_ACCOUNT_USERNAME: 'reader',
          MIXPANEL_SERVICE_ACCOUNT_SECRET: 'secret',
        }),
      );
      const result = await service.mixpanel(range());
      expect(result.status).toBe(status === 429 ? 'rate_limited' : 'error');
      expect(result).not.toHaveProperty('reason');
      expect(result.totalEvents).toBeNull();
    },
  );
});
