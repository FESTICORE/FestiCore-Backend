import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  MetricsService,
  validateEvents,
  validateRange,
} from './metrics.service';

const at = '2026-10-21T12:00:00Z';
const now = Date.parse(at);
const deviceId = '1f0d7050-9b11-4099-84b5-7d71e31f8850';

describe('metrics validation', () => {
  it('accepts the specified event contract', () => {
    expect(
      validateEvents(
        {
          events: [
            {
              name: 'live.poll',
              at,
              festivalId: 'fst_demo2026',
              props: { status: 304 },
            },
          ],
        },
        now,
      ),
    ).toHaveLength(1);
  });

  it.each([
    { events: [] },
    {
      events: Array.from({ length: 101 }, () => ({ name: 'offline.open', at })),
    },
    { events: [{ name: 'unknown', at }] },
    { events: [{ name: 'offline.open', at, token: 'secret' }] },
    { events: [{ name: 'offline.open', at: '2026-10-21' }] },
    { events: [{ name: 'app.cold_start', at }] },
    { events: [{ name: 'pack.download', at }] },
    { events: [{ name: 'live.poll', at, props: { status: 500 } }] },
    { events: [{ name: 'screen.open', at }] },
    { events: [{ name: 'offline.open', at }] },
    { events: [{ name: 'status.update', at, props: { kind: 'flag' } }] },
    {
      events: [
        { name: 'status.update', at, props: { kind: 'other', queued: true } },
      ],
    },
    { events: [{ name: 'push.received', at }] },
    {
      events: [
        { name: 'screen.open', at, props: { payload: 'a'.repeat(257) } },
      ],
    },
    { events: [{ name: 'offline.open', at, value: -1 }] },
    {
      events: [{ name: 'offline.open', at, props: { accessToken: 'secret' } }],
    },
  ])('rejects malformed or unbounded events %#', (body) => {
    expect(() => validateEvents(body, now)).toThrow(BadRequestException);
  });

  it('accepts a published festival span beyond 31 days', () => {
    expect(
      validateRange('fst_demo2026', undefined, undefined, '1d', {
        from: at,
        to: '2026-12-01T12:00:00Z',
      }),
    ).toMatchObject({ start: at, end: '2026-12-01T12:00:00Z' });
  });

  it('rejects an inverted admin date range', () => {
    expect(() =>
      validateRange('fst_demo2026', '2026-12-01T12:00:00Z', at, '1h', {
        from: at,
        to: '2026-10-22T12:00:00Z',
      }),
    ).toThrow(BadRequestException);
  });
});

describe('MetricsService', () => {
  const query = jest.fn<Promise<unknown>, [string, unknown[]]>();
  const service = new MetricsService({ query } as unknown as DataSource);

  beforeEach(() => query.mockReset());

  it('requires a UUID v4 and stores bounded events through SQL parameters', async () => {
    await expect(service.ingest('invalid', { events: [] })).rejects.toThrow(
      BadRequestException,
    );
    query.mockResolvedValueOnce([{ id: 1 }]);
    await service.ingest(deviceId, {
      events: [
        {
          name: 'offline.open',
          at: new Date().toISOString(),
          props: { screen: 'S01' },
        },
      ],
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('jsonb_to_recordset($2::jsonb)');
    expect(query.mock.calls[0][0]).toContain('FROM "devices"');
    expect(query.mock.calls[0][0]).toContain('FOR KEY SHARE');
    expect(query.mock.calls[0][1][0]).toBe(deviceId);
  });

  it('rejects events for a device that is no longer registered', async () => {
    query.mockResolvedValueOnce([]);
    await expect(
      service.ingest(deviceId, {
        events: [
          {
            name: 'offline.open',
            at: new Date().toISOString(),
            props: { screen: 'S01' },
          },
        ],
      }),
    ).rejects.toThrow(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reports follow and crew counts with cold-start P95', async () => {
    query
      .mockResolvedValueOnce([
        { firstStart: at, lastEnd: '2026-10-22T12:00:00Z' },
      ])
      .mockResolvedValueOnce([
        {
          at: new Date(at),
          activeDevices: 4,
          liveRequests: 10,
          live304Rate: 0.3,
          liveErrorRate: 0.1,
          statusUpdates: 2,
          follows: 3,
          crewJoins: 1,
          offlineOpens: 2,
          coldStartP95Ms: 780.5,
        },
      ]);
    const result = await service.report('fst_demo2026');
    expect(result.buckets[0]).toMatchObject({
      at: new Date(at).toISOString(),
      activeDevices: 4,
      live304Rate: 0.3,
      follows: 3,
      crewJoins: 1,
      coldStartP95Ms: 780.5,
    });
    const sql = query.mock.calls[1][0];
    expect(sql).toContain('percentile_cont(0.95)');
    expect(sql).toContain('FROM "flag_follows"');
    expect(sql).toContain('FROM "crew_members"');
    expect(sql).toContain("AT TIME ZONE 'Asia/Seoul'");
    expect(query.mock.calls[1][1]).toEqual([
      'fst_demo2026',
      at,
      '2026-10-22T12:00:00Z',
      'hour',
    ]);
  });

  it('rejects an unpublished festival', async () => {
    query.mockResolvedValueOnce([]);
    await expect(service.report('fst_missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
