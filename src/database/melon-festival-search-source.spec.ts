import { QueryRunner } from 'typeorm';
import { MelonFestivalSearch1792500031000 } from './migrations/1792500031000-melon-festival-search';

describe('Melon festival search source migration', () => {
  const encoded =
    'https://ticket.melon.com/search/index.htm?q=%ED%8E%98%EC%8A%A4%ED%8B%B0%EB%B2%8C';
  const korean = 'https://ticket.melon.com/search/index.htm?q=페스티벌';
  const seed = 'melon-festival-search';

  it('avoids registering a second source when either URL form exists', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new MelonFestivalSearch1792500031000().up({
      query,
    } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, string[]];
    expect(params).toEqual([encoded, korean, seed]);
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain('"url" IN ($1, $2)');
    expect(sql).toContain("jsonb_build_object('seed', $3::text)");
  });

  it('only disables owned rows and keeps rows with any crawl history', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new MelonFestivalSearch1792500031000().down({
      query,
    } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(2);
    const [disable, remove] = query.mock.calls.map(
      ([sql, params]: [string, string[]]) => {
        expect(params).toEqual([encoded, korean, seed]);
        expect(sql).toContain('"parserConfig"->>\'seed\' = $3');
        expect(sql).toContain('"url" IN ($1, $2)');
        return sql;
      },
    );
    expect(disable).toContain('"enabled" = false');
    expect(disable).toContain('"status" = \'disabled\'');
    for (const sql of [disable, remove]) {
      // A pre-existing admin source with the raw Korean URL has no seed and
      // must not be changed by either rollback statement.
      expect(sql).toMatch(
        /WHERE "url" IN \(\$1, \$2\) AND "kind" = 'discovery'\s+AND "parserConfig"->>'seed' = \$3/,
      );
    }
    for (const table of [
      'crawl_runs',
      'crawl_proposals',
      'crawl_images',
      'crawl_alerts',
    ]) {
      expect(remove).toContain(`NOT EXISTS (SELECT 1 FROM ${table}`);
    }
  });
});
