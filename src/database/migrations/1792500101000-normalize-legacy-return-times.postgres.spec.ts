import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { NormalizeLegacyReturnTimes1792500101000 } from './1792500101000-normalize-legacy-return-times';

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('Normalize legacy return times (PostgreSQL)', () => {
  const schema = `legacy_return_times_${randomUUID().replaceAll('-', '_')}`;
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
    await db.query(`CREATE TABLE "admin_festivals" (
      "id" varchar(32) PRIMARY KEY, "draft" jsonb NOT NULL, "published" jsonb)`);
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('nulls only free-text values in draft and published, and is repeatable', async () => {
    const legacy = {
      name: 'A',
      directions: {
        lastShuttleAt: '23:40',
        lastTrainAt: '2026-11-20T23:52:00+09:00',
        memo: '메모',
      },
    };
    const valid = {
      name: 'B',
      directions: { lastShuttleAt: null, lastTrainAt: '2026-11-20T23:52:00Z' },
    };
    await db.query(
      `INSERT INTO "admin_festivals" ("id", "draft", "published") VALUES
        ('fst_legacy', $1::jsonb, $1::jsonb),
        ('fst_valid', $2::jsonb, NULL),
        ('fst_nodir', '{"name":"C"}'::jsonb, NULL)`,
      [JSON.stringify(legacy), JSON.stringify(valid)],
    );
    const runner = db.createQueryRunner();
    try {
      await new NormalizeLegacyReturnTimes1792500101000().up(runner);
      await new NormalizeLegacyReturnTimes1792500101000().up(runner);
    } finally {
      await runner.release();
    }
    const rows = await db.query<
      Array<{ id: string; draft: unknown; published: unknown }>
    >('SELECT "id", "draft", "published" FROM "admin_festivals" ORDER BY "id"');
    const expected = {
      name: 'A',
      directions: {
        lastShuttleAt: null,
        lastTrainAt: '2026-11-20T23:52:00+09:00',
        memo: '메모',
      },
    };
    expect(rows).toEqual([
      { id: 'fst_legacy', draft: expected, published: expected },
      { id: 'fst_nodir', draft: { name: 'C' }, published: null },
      { id: 'fst_valid', draft: valid, published: null },
    ]);
  });
});
