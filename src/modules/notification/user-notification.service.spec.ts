import {
  recordUserNotifications,
  UserNotificationService,
} from './user-notification.service';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const ntf = (n: number) => `ntf_${String(n).padStart(32, '0')}`;

function setup(rows: unknown[] = []) {
  const query = jest
    .fn<Promise<unknown>, [string, unknown[]?]>()
    .mockResolvedValue(rows);
  const service = new UserNotificationService({ query } as never);
  return { service, query };
}

function row(n: number, cursorAt: string) {
  return {
    id: ntf(n),
    type: 'crew.status',
    festivalId: 'fst_2026',
    title: '크루원 상태 변경',
    body: '민지님의 상태가 moving(으)로 변경됐어요.',
    route: '/crews/crw_1',
    subject: { crewId: 'crw_1' },
    createdAt: new Date(cursorAt),
    readAt: null,
    cursorAt,
  };
}

describe('recordUserNotifications', () => {
  const entry = {
    type: 'crew.gather' as const,
    festivalId: 'fst_2026',
    title: '크루 집결 요청',
    body: '민지님이 현재 위치에서 집결을 요청했어요.',
    route: '/crews/crw_1',
    subject: { crewId: 'crw_1', gatherId: 'gth_1' },
    dedupeKey: 'crew.gather:gth_1',
  };

  it('skips the query when nobody should receive it', async () => {
    const query = jest.fn();
    await recordUserNotifications({ query }, [], entry);
    expect(query).not.toHaveBeenCalled();
  });

  it('inserts one row per distinct existing user and ignores duplicates by default', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await recordUserNotifications({ query }, [userId, userId, otherId], entry);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('JOIN "users" u ON u."id" = r."userId"');
    expect(sql).toContain('ON CONFLICT ("userId", "dedupeKey") DO NOTHING');
    expect(params).toEqual([
      [userId, otherId],
      'crew.gather',
      'fst_2026',
      entry.title,
      entry.body,
      '/crews/crw_1',
      JSON.stringify(entry.subject),
      'crew.gather:gth_1',
    ]);
  });

  it('replaces content and marks it unread again for merged types', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await recordUserNotifications({ query }, [userId], entry, true);
    const sql = (query.mock.calls[0] as [string])[0];
    expect(sql).toContain('DO UPDATE SET');
    expect(sql).toContain('"createdAt" = now(), "readAt" = NULL');
  });
});

describe('UserNotificationService', () => {
  it('lists newest first within retention and returns a cursor that round-trips', async () => {
    const at = ['2026-10-17T06:40:00.123456Z', '2026-10-17T06:39:00.000001Z'];
    const { service, query } = setup([row(2, at[0]), row(1, at[1])]);
    const first = await service.list(userId, {
      festivalId: 'fst_2026',
      limit: '1',
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ORDER BY "createdAt" DESC, "id" DESC');
    expect(sql).toContain(`"createdAt" > now() - (30 * interval '1 day')`);
    expect(params).toEqual([userId, 'fst_2026', null, null, 2]);
    expect(first.items).toEqual([
      {
        id: ntf(2),
        type: 'crew.status',
        festivalId: 'fst_2026',
        title: '크루원 상태 변경',
        body: '민지님의 상태가 moving(으)로 변경됐어요.',
        createdAt: '2026-10-17T06:40:00.123Z',
        readAt: null,
        route: '/crews/crw_1',
        subject: { crewId: 'crw_1' },
      },
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));

    query.mockResolvedValueOnce([row(1, at[1])]);
    const second = await service.list(userId, {
      before: first.nextCursor!,
    });
    expect(query.mock.calls[1][1]).toEqual([userId, null, at[0], ntf(2), 21]);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    [{ festivalId: 'FST_bad' }],
    [{ limit: '0' }],
    [{ limit: '51' }],
    [{ limit: '1.5' }],
    [{ before: 'not-a-cursor' }],
    [
      {
        before: Buffer.from(`2026-10-17T06:40:00Z|${ntf(1)}`).toString(
          'base64url',
        ),
      },
    ],
  ])('rejects invalid list query %j with VALIDATION', async (input) => {
    const { service, query } = setup();
    await expect(service.list(userId, input)).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION' },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('counts only unread retained rows for the caller', async () => {
    const { service, query } = setup([{ count: '3' }]);
    await expect(service.unreadCount(userId, 'fst_2026')).resolves.toEqual({
      unreadCount: 3,
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('"readAt" IS NULL');
    expect(params).toEqual([userId, 'fst_2026']);
  });

  it('marks selected ids read only inside the caller scope', async () => {
    const { service, query } = setup();
    await service.markRead(userId, { ids: [ntf(1), ntf(1), ntf(2)] });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('"userId" = $1 AND "readAt" IS NULL');
    expect(params).toEqual([userId, [ntf(1), ntf(2)]]);
  });

  it('marks all, optionally scoped to one festival', async () => {
    const { service, query } = setup();
    await service.markRead(userId, { all: true });
    await service.markRead(userId, { all: true, festivalId: 'fst_2026' });
    expect(query.mock.calls[0][1]).toEqual([userId, null]);
    expect(query.mock.calls[1][1]).toEqual([userId, 'fst_2026']);
  });

  it.each([
    [{}],
    [{ ids: [ntf(1)], all: true as const }],
    [{ ids: [ntf(1)], festivalId: 'fst_2026' }],
    [{ ids: [] }],
    [{ ids: ['ntf_bad'] }],
    [{ ids: Array.from({ length: 101 }, (_, i) => ntf(i)) }],
  ])('rejects invalid read body %#', async (body) => {
    const { service, query } = setup();
    await expect(service.markRead(userId, body)).rejects.toMatchObject({
      status: 400,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('deletes only the caller rows and validates ids', async () => {
    const { service, query } = setup();
    await service.remove(userId, { ids: [ntf(3)] });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM "user_notifications"');
    expect(sql).toContain('"userId" = $1');
    expect(params).toEqual([userId, [ntf(3)]]);
    await expect(service.remove(userId, { ids: [] })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('purges expired rows in bounded batches and swallows failures', async () => {
    const { service, query } = setup();
    await service.purgeExpired();
    expect(query.mock.calls[0][0]).toContain('LIMIT 1000');
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(service.purgeExpired()).resolves.toBeUndefined();
  });
});
