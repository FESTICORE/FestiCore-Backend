import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { UserNotifications1792500095000 } from '../../database/migrations/1792500095000-user-notifications';
import { UserNotificationsCreatedIndex1792500100000 } from '../../database/migrations/1792500100000-user-notifications-created-index';
import {
  recordUserNotifications,
  UserNotificationEntry,
  UserNotificationService,
  withInboxSavepoint,
} from './user-notification.service';

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('UserNotificationService (PostgreSQL)', () => {
  const schema = `user_notification_test_${randomUUID().replaceAll('-', '_')}`;
  const me = randomUUID();
  const other = randomUUID();
  const missing = randomUUID();
  let admin: DataSource;
  let db: DataSource;
  let service: UserNotificationService;

  const entry = (n: number, extra: Partial<UserNotificationEntry> = {}) => ({
    type: 'crew.gather' as const,
    festivalId: 'fst_2026',
    title: `제목 ${n}`,
    body: `본문 ${n}`,
    route: '/crews/crw_1',
    subject: { crewId: 'crw_1' },
    dedupeKey: `crew.gather:${n}`,
    ...extra,
  });

  beforeAll(async () => {
    admin = new DataSource({ type: 'postgres', url, synchronize: false });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      url,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await db.initialize();
    await db.query('CREATE TABLE "users" ("id" uuid PRIMARY KEY)');
    await db.query('CREATE TABLE "source_writes" ("id" int PRIMARY KEY)');
    const runner = db.createQueryRunner();
    try {
      await new UserNotifications1792500095000().up(runner);
      await new UserNotificationsCreatedIndex1792500100000().up(runner);
    } finally {
      await runner.release();
    }
    await db.query('INSERT INTO "users" ("id") VALUES ($1), ($2)', [me, other]);
    service = new UserNotificationService(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE "user_notifications", "source_writes"');
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('creates ntf ids, skips unknown users and deduplicates by key', async () => {
    await recordUserNotifications(db, [me, other, missing], entry(1));
    await recordUserNotifications(db, [me], entry(1, { title: '무시' }));
    const rows = await db.query<Array<{ id: string; title: string }>>(
      'SELECT "id", "title" FROM "user_notifications" ORDER BY "userId"',
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.id).toMatch(/^ntf_[0-9a-f]{32}$/);
      expect(row.title).toBe('제목 1');
    }
  });

  it('merges a replaced row back to unread with the latest content', async () => {
    await recordUserNotifications(db, [me], entry(1), true);
    await service.markRead(me, { all: true });
    expect(await service.unreadCount(me)).toEqual({ unreadCount: 0 });
    await recordUserNotifications(db, [me], entry(1, { body: '최신' }), true);
    const { items } = await service.list(me, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ body: '최신', readAt: null });
    expect(await service.unreadCount(me)).toEqual({ unreadCount: 1 });
  });

  it('pages without gaps even when rows share a millisecond', async () => {
    for (let n = 0; n < 5; n++)
      await recordUserNotifications(db, [me], entry(n));
    await db.query(
      `UPDATE "user_notifications"
       SET "createdAt" = '2026-10-17T06:40:00.123Z'::timestamptz + (random() * interval '900 microseconds')`,
    );
    const seen: string[] = [];
    let before: string | undefined;
    do {
      const page = await service.list(me, { limit: '2', before });
      seen.push(...page.items.map((item) => item.id));
      before = page.nextCursor ?? undefined;
    } while (before);
    const all = await db.query<Array<{ id: string }>>(
      'SELECT "id" FROM "user_notifications"',
    );
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual(all.map((row) => row.id).sort());
  });

  it('reads and deletes only the caller rows, scoped by festival', async () => {
    await recordUserNotifications(db, [me, other], entry(1));
    await recordUserNotifications(
      db,
      [me],
      entry(2, { festivalId: 'fst_other' }),
    );
    const others = await service.list(other, {});
    const otherId = others.items[0].id;
    await service.markRead(me, { ids: [otherId] });
    await service.remove(me, { ids: [otherId] });
    expect((await service.list(other, {})).items[0]).toMatchObject({
      id: otherId,
      readAt: null,
    });
    await service.markRead(me, { all: true, festivalId: 'fst_2026' });
    expect(await service.unreadCount(me)).toEqual({ unreadCount: 1 });
    expect(await service.unreadCount(me, 'fst_other')).toEqual({
      unreadCount: 1,
    });
    const mine = await service.list(me, { festivalId: 'fst_other' });
    await service.remove(me, { ids: [mine.items[0].id] });
    expect((await service.list(me, {})).items).toHaveLength(1);
  });

  it('hides and purges rows older than 30 days, and cascades on user delete', async () => {
    await recordUserNotifications(db, [me], entry(1));
    await recordUserNotifications(db, [me], entry(2));
    await db.query(
      `UPDATE "user_notifications" SET "createdAt" = now() - interval '31 days'
       WHERE "dedupeKey" = 'crew.gather:1'`,
    );
    expect((await service.list(me, {})).items).toHaveLength(1);
    expect(await service.unreadCount(me)).toEqual({ unreadCount: 1 });
    await service.purgeExpired();
    const left = await db.query<Array<{ count: string }>>(
      'SELECT count(*) AS count FROM "user_notifications"',
    );
    expect(Number(left[0].count)).toBe(1);
    await db.query('DELETE FROM "users" WHERE "id" = $1', [me]);
    const after = await db.query<Array<{ count: string }>>(
      'SELECT count(*) AS count FROM "user_notifications"',
    );
    expect(Number(after[0].count)).toBe(0);
    await db.query('INSERT INTO "users" ("id") VALUES ($1)', [me]);
  });

  it('commits the source write when the inbox write fails inside a savepoint', async () => {
    await db.transaction(async (manager) => {
      await manager.query('INSERT INTO "source_writes" ("id") VALUES (1)');
      await withInboxSavepoint(manager, async () => {
        await recordUserNotifications(manager, [me], entry(1));
        await recordUserNotifications(manager, ['not-a-uuid'], entry(2));
      });
      await manager.query('INSERT INTO "source_writes" ("id") VALUES (2)');
      await withInboxSavepoint(manager, () =>
        recordUserNotifications(manager, [me], entry(3)),
      );
    });
    const writes = await db.query<Array<{ id: number }>>(
      'SELECT "id" FROM "source_writes" ORDER BY "id"',
    );
    expect(writes.map((row) => row.id)).toEqual([1, 2]);
    const keys = await db.query<Array<{ dedupeKey: string }>>(
      'SELECT "dedupeKey" FROM "user_notifications"',
    );
    expect(keys.map((row) => row.dedupeKey)).toEqual(['crew.gather:3']);
  });

  it('rolls back with the caller transaction', async () => {
    await expect(
      db.transaction(async (manager) => {
        await recordUserNotifications(manager, [me], entry(1));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await service.unreadCount(me)).toEqual({ unreadCount: 0 });
  });
});
