import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { FlagStatusUpdatedByBackfill1792500099000 } from './1792500099000-flag-status-updated-by-backfill';

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('Flag status updatedBy backfill (PostgreSQL)', () => {
  const schema = `flag_updated_by_test_${randomUUID().replaceAll('-', '_')}`;
  const first = randomUUID();
  const second = randomUUID();
  const kept = randomUUID();
  let admin: DataSource;
  let db: DataSource;

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
    await db.query(`CREATE TABLE "flags" (
      "id" varchar(32) PRIMARY KEY, "statusUpdatedBy" uuid)`);
    await db.query(`CREATE TABLE "flag_status_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "flagId" varchar(32) NOT NULL, "userId" uuid,
      "createdAt" timestamptz NOT NULL)`);
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('uses the latest event author and keeps admin, withdrawn and existing values', async () => {
    await db.query(
      `INSERT INTO "flags" ("id", "statusUpdatedBy") VALUES
        ('flg_latest', NULL), ('flg_admin', NULL), ('flg_none', NULL), ('flg_kept', $1)`,
      [kept],
    );
    await db.query(
      `INSERT INTO "flag_status_events" ("flagId", "userId", "createdAt") VALUES
        ('flg_latest', $1, '2026-10-17T06:00:00Z'),
        ('flg_latest', $2, '2026-10-17T06:10:00Z'),
        ('flg_admin', $1, '2026-10-17T06:00:00Z'),
        ('flg_admin', NULL, '2026-10-17T06:10:00Z'),
        ('flg_kept', $1, '2026-10-17T06:10:00Z')`,
      [first, second],
    );
    const runner = db.createQueryRunner();
    try {
      await new FlagStatusUpdatedByBackfill1792500099000().up(runner);
      await new FlagStatusUpdatedByBackfill1792500099000().up(runner);
    } finally {
      await runner.release();
    }
    const rows = await db.query<
      Array<{ id: string; statusUpdatedBy: string | null }>
    >('SELECT "id", "statusUpdatedBy" FROM "flags" ORDER BY "id"');
    expect(rows).toEqual([
      { id: 'flg_admin', statusUpdatedBy: null },
      { id: 'flg_kept', statusUpdatedBy: kept },
      { id: 'flg_latest', statusUpdatedBy: second },
      { id: 'flg_none', statusUpdatedBy: null },
    ]);
  });
});
