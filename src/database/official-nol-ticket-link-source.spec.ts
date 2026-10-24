import { QueryRunner } from 'typeorm';
import { OfficialNolTicketLink1792500063000 } from './migrations/1792500063000-official-nol-ticket-link';

describe('official NOL ticket link source migration', () => {
  it('registers the exact Mint Paper post as a discovery source', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const migration = new OfficialNolTicketLink1792500063000();

    await migration.up({ query } as unknown as QueryRunner);

    const calls = query.mock.calls as unknown as [string, string[]][];
    expect(query).toHaveBeenCalledTimes(1);
    expect(calls[0][1][0]).toBe('https://www.mintpaper.co.kr/posts/4821');
    expect(JSON.parse(calls[0][1][1])).toEqual({
      seed: 'official-ticket-links',
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
    });

    await migration.down({ query } as unknown as QueryRunner);
    expect(calls[1][0]).toContain('NOT EXISTS (SELECT 1 FROM crawl_runs');
  });
});
