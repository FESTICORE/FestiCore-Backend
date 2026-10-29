import { QueryRunner } from 'typeorm';
import { NolWorldConcertSource1792500087000 } from './migrations/1792500087000-nol-world-concert-source';

describe('NOL World public concert source migration', () => {
  const urls = [
    'https://world.nol.com/en/ticket/genre/CONCERT/products',
    'https://world.nol.com/en/ticket',
    'https://world.nol.com/en/search?q=festival',
  ];

  it('registers public discovery sources without replacing existing settings', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const migration = new NolWorldConcertSource1792500087000();
    await migration.up({ query } as unknown as QueryRunner);
    const calls = query.mock.calls as [string, string[]][];
    expect(query).toHaveBeenCalledTimes(urls.length);
    expect(calls.map((call) => call[1][0])).toEqual(urls);
    for (const call of calls) expect(call[0]).toContain('NOT EXISTS');
  });

  it('rolls back only its unused source', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const migration = new NolWorldConcertSource1792500087000();
    await migration.down({ query } as unknown as QueryRunner);
    const calls = query.mock.calls as [string, string[]][];
    expect(calls.map((call) => call[1][0])).toEqual(urls);
    for (const call of calls) {
      expect(call[0]).toContain("'nol-world-concert'");
      for (const table of [
        'crawl_runs',
        'crawl_proposals',
        'crawl_images',
        'crawl_alerts',
      ])
        expect(call[0]).toContain(table);
    }
  });
});
