import { QueryRunner } from 'typeorm';
import { CrawlLineupRevisions1792500089000 } from './1792500089000-crawl-lineup-revisions';

describe('NOL World lineup review schema', () => {
  it('keeps source, run, image bytes, parser, decision and audit identity together', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new CrawlLineupRevisions1792500089000().up({
      query,
    } as unknown as QueryRunner);
    const ddl = query.mock.calls.map(([sql]: [string]) => sql).join('\n');
    expect(ddl).toContain('"runId" uuid NOT NULL REFERENCES crawl_runs(id)');
    expect(ddl).toContain(
      '"sourceId" uuid NOT NULL REFERENCES crawl_sources(id)',
    );
    expect(ddl).toContain('"rawLines" jsonb NOT NULL');
    expect(ddl).toContain(
      "CHECK (status IN ('pending', 'approved', 'rejected'))",
    );
    expect(ddl).toContain(
      '"sourceId", "imageUrl", "imageHash", "parserVersion"',
    );
  });
});
