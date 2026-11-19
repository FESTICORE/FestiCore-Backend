import { Client } from 'pg';
import { PublicFestivalService } from '../src/modules/public/public-festival.service';

type CatalogRow = {
  candidate: { date: string };
  decision: string | null;
};

describe('public discovery date fallback (PostgreSQL)', () => {
  const url = 'https://ticket.melon.com/performance/index.htm?prodId=242';
  const client = new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'festicore',
  });
  let catalogRows: CatalogRow[];
  let service: PublicFestivalService;

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE TEMP TABLE crawl_sources (
      id integer PRIMARY KEY, url text NOT NULL, kind text NOT NULL,
      "parserConfig" jsonb NOT NULL DEFAULT '{}'::jsonb
    )`);
    await client.query(`CREATE TEMP TABLE crawl_proposals (
      id integer PRIMARY KEY, "sourceId" integer NOT NULL,
      kind text NOT NULL, status text NOT NULL,
      items jsonb NOT NULL, "createdAt" timestamptz NOT NULL
    )`);
    await client.query(
      `INSERT INTO crawl_sources (id, url, kind) VALUES (1, $1, 'discovery')`,
      [url],
    );
    await client.query(
      `INSERT INTO crawl_sources (id, url, kind, "parserConfig")
       VALUES (2, 'https://ticket.melon.com/search', 'discovery',
         jsonb_build_object('festivalSourceUrl', $1::text))`,
      [url],
    );
    const query = (sql: string): Promise<unknown[]> => {
      if (sql.includes('WITH candidates AS'))
        throw new Error('catalog query escaped the transaction');
      return Promise.resolve([]);
    };
    const transaction = async (
      isolation: string,
      run: (manager: { query: typeof query }) => Promise<unknown>,
    ) => {
      expect(isolation).toBe('REPEATABLE READ');
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        const result = await run({
          query: async (sql: string, params?: unknown[]) => {
            const rows = (await client.query<CatalogRow>(sql, params)).rows;
            if (sql.includes('WITH candidates AS')) catalogRows = rows;
            return rows;
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    };
    service = new PublicFestivalService(
      {} as never,
      {} as never,
      { query, transaction } as never,
      {} as never,
    );
  });

  afterAll(async () => client.end());
  beforeEach(async () => {
    catalogRows = [];
    await client.query('TRUNCATE crawl_proposals');
  });

  async function insertProposal(
    id: number,
    date: string,
    decision: string,
    status = 'pending',
    sourceId = 1,
  ): Promise<void> {
    await client.query(
      `INSERT INTO crawl_proposals
        (id, "sourceId", kind, status, items, "createdAt")
       VALUES ($1, $5, 'festival.new', $2, $3::jsonb, $4::timestamptz)`,
      [
        id,
        status,
        JSON.stringify([
          {
            decision,
            after: { name: '날짜 회귀 축제', venue: '공연장', date, url },
          },
        ]),
        `2026-10-${String(id).padStart(2, '0')}T00:00:00Z`,
        sourceId,
      ],
    );
  }

  it('falls back to the older valid date when the latest date is malformed', async () => {
    await insertProposal(1, '2026.12.26', 'accepted');
    await insertProposal(2, '2026.02.30', 'accepted');

    const summaries = await service['discoveryCatalog']();

    expect(catalogRows).toHaveLength(1);
    expect(catalogRows[0].candidate.date).toBe('2026.12.26');
    expect(summaries).toMatchObject([
      { firstDate: '2026-12-26', lastDate: '2026-12-26', sourceUrl: url },
    ]);
  });

  it('hides the URL when a newer search proposal rejects an older direct ticket', async () => {
    await insertProposal(1, '2026.12.26', 'accepted');
    await insertProposal(2, '2026.02.30', 'rejected', 'pending', 2);

    const summaries = await service['discoveryCatalog']();

    expect(catalogRows).toHaveLength(1);
    expect(catalogRows[0]).toMatchObject({
      candidate: { date: '2026.12.26' },
      decision: 'rejected',
    });
    expect(summaries).toEqual([]);
  });

  it('shows a newer search ticket after an older direct proposal was rejected', async () => {
    await insertProposal(1, '2026.12.26', 'rejected');
    await insertProposal(2, '2026.12.27', 'accepted', 'pending', 2);

    const summaries = await service['discoveryCatalog']();

    expect(catalogRows).toMatchObject([
      { candidate: { date: '2026.12.27' }, decision: 'accepted' },
    ]);
    expect(summaries).toMatchObject([
      { firstDate: '2026-12-27', sourceUrl: url },
    ]);
  });
});
