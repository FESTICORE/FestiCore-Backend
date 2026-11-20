import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import { ADMIN_ROLES_KEY } from '../auth/admin-roles.decorator';
import { parseAnalyticsRange } from './admin-analytics.range';
import { AdminDashboardController } from './admin-dashboard.controller';
import {
  AdminDashboardService,
  fillBuckets,
  kstWeekStart,
} from './admin-dashboard.service';

describe('admin dashboard', () => {
  it('requires viewer, sets no-store and validates range and granularity', () => {
    const service = {
      summary: jest.fn(),
      trends: jest.fn(),
    } as unknown as AdminDashboardService;
    const controller = new AdminDashboardController(service);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, controller.summary)).toEqual([
      'viewer',
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, controller.trends)).toEqual([
      'viewer',
    ]);
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    void controller.summary(res);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(() =>
      controller.trends(res, '2026-10-01', '2026-10-02', 'month'),
    ).toThrow(BadRequestException);
    expect(() => parseAnalyticsRange('2026-07-01', '2026-10-02', 92)).toThrow(
      BadRequestException,
    );
    expect(parseAnalyticsRange('2026-07-03', '2026-10-02', 92).from).toBe(
      '2026-07-03',
    );
  });

  it('fills empty day and week buckets with zero', () => {
    const range = parseAnalyticsRange('2026-10-01', '2026-10-05');
    expect(
      fillBuckets(range, 'day', [{ bucket: '2026-10-03', count: '4' }]),
    ).toEqual([
      { date: '2026-10-01', count: 0 },
      { date: '2026-10-02', count: 0 },
      { date: '2026-10-03', count: 4 },
      { date: '2026-10-04', count: 0 },
      { date: '2026-10-05', count: 0 },
    ]);
    // 2026-10-05는 월요일이다.
    expect(kstWeekStart('2026-10-04')).toBe('2026-09-28');
    expect(kstWeekStart('2026-10-05')).toBe('2026-10-05');
    expect(
      fillBuckets(range, 'week', [{ bucket: '2026-10-05', count: 2 }]),
    ).toEqual([
      { date: '2026-09-28', count: 0 },
      { date: '2026-10-05', count: 2 },
    ]);
  });

  it('builds today summary in KST with null rates for empty denominators', async () => {
    const query = jest.fn((sql: string) => {
      const value = sql.includes('user_notifications') ? 0 : 5;
      return Promise.resolve([{ count: String(value) }]);
    });
    const service = new AdminDashboardService({
      query,
    } as unknown as DataSource);
    // 2026-11-20 00:30 KST
    const result = await service.summary(
      Date.parse('2026-11-19T15:30:00.000Z'),
    );
    expect(result).toMatchObject({
      date: '2026-11-20',
      newUsers: 5,
      totalUsers: 5,
      engagement: {
        pushOptInRate: 1,
        notificationReadRate: null,
        notifications30d: 0,
      },
    });
    const firstCall = query.mock.calls[0] as unknown as [string, string[]];
    expect(firstCall[1]).toEqual([
      '2026-11-19T15:00:00.000Z',
      '2026-11-20T15:00:00.000Z',
    ]);
  });

  it('returns zero-filled trends with signup total', async () => {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('FROM users')
          ? [
              { bucket: '2026-10-01', count: '2' },
              { bucket: '2026-10-02', count: '3' },
            ]
          : [],
      ),
    );
    const service = new AdminDashboardService({
      query,
    } as unknown as DataSource);
    const result = await service.trends(
      parseAnalyticsRange('2026-10-01', '2026-10-02'),
      'day',
    );
    expect(result.totalSignups).toBe(5);
    expect(result.logins).toEqual([
      { date: '2026-10-01', count: 0 },
      { date: '2026-10-02', count: 0 },
    ]);
    expect(query).toHaveBeenCalledTimes(4);
    const calls = query.mock.calls as unknown as [string, string[]][];
    for (const [sql, params] of calls) {
      expect(sql).toContain("AT TIME ZONE 'Asia/Seoul'");
      expect(params).toEqual([
        '2026-09-30T15:00:00.000Z',
        '2026-10-02T15:00:00.000Z',
      ]);
    }
    expect(calls.map(([sql]) => sql).join('\n')).toContain(
      'FROM metric_events',
    );
    expect(calls.find(([sql]) => sql.includes('metric_events'))?.[0]).toContain(
      '"receivedAt" >= $1',
    );
  });
});
