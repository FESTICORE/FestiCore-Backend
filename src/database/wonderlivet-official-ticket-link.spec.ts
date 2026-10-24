import { QueryRunner } from 'typeorm';
import { WonderlivetOfficialTicketLink1792500072000 } from './migrations/1792500072000-wonderlivet-official-ticket-link';

describe('원더리벳 공식 예매 링크 크롤 소스', () => {
  it('seeds only the official daily page, not a fixed Melon product ID', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const migration = new WonderlivetOfficialTicketLink1792500072000();
    await migration.up({ query } as unknown as QueryRunner);
    const calls = query.mock.calls as unknown as [string, string[]][];
    const [sql, parameters] = calls[0];
    expect(sql).toContain('1440');
    expect(parameters).toEqual([
      'https://litt.ly/wonderlivet',
      'wonderlivet-official-ticket-links',
      'https://www.wonderli.vet/lineup',
    ]);
    expect(JSON.stringify(calls)).not.toContain('prodId=');
    await migration.down({ query } as unknown as QueryRunner);
    expect(calls[1][0]).toContain('NOT EXISTS (SELECT 1 FROM crawl_runs');
  });
});
