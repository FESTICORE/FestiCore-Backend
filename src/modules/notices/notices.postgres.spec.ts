import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Notices1792500103000 } from '../../database/migrations/1792500103000-notices';

const url = process.env.LIVE_ACTIVITY_PG_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('공지 migration (PostgreSQL)', () => {
  const schema = `notices_test_${randomUUID().replaceAll('-', '_')}`;
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
    const runner = db.createQueryRunner();
    try {
      await new Notices1792500103000().up(runner);
    } finally {
      await runner.release();
    }
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('게시 제약과 목록 인덱스를 적용하고 최신순으로 조회한다', async () => {
    const older = randomUUID();
    const newer = randomUUID();
    const draft = randomUUID();
    await db.query(
      `INSERT INTO "notices" ("id", "title", "content", "published", "publishedAt")
       VALUES ($1, 'old', 'body', true, '2026-11-01T00:00:00Z'),
              ($2, 'new', 'body', true, '2026-11-02T00:00:00Z'),
              ($3, 'draft', 'body', false, NULL)`,
      [older, newer, draft],
    );
    const rows = await db.query<Array<{ id: string }>>(
      `SELECT "id" FROM "notices" WHERE "published" = true
       ORDER BY "publishedAt" DESC, "id" DESC LIMIT 100`,
    );
    expect(rows.map((row) => row.id)).toEqual([newer, older]);
    await expect(
      db.query('UPDATE "notices" SET "published" = true WHERE "id" = $1', [
        draft,
      ]),
    ).rejects.toThrow();
    const indexes = await db.query<Array<{ indexname: string }>>(
      'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2',
      [schema, 'notices'],
    );
    expect(indexes.map((item) => item.indexname)).toContain(
      'IDX_notices_published_list',
    );
  });
});
