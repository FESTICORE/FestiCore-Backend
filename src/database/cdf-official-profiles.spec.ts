import { QueryRunner } from 'typeorm';
import { CDF_PROFILES } from '../modules/admin/crawl/service/cdf-profile';
import { CdfOfficialProfiles1792500068000 } from './migrations/1792500068000-cdf-official-profiles';

describe('CDF official profile source migration', () => {
  it('registers exactly nine reviewed profile pages without image URLs', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const migration = new CdfOfficialProfiles1792500068000();
    await migration.up({ query } as unknown as QueryRunner);

    const calls = query.mock.calls as [string, string[]][];
    const inserts = calls.filter(([sql]) =>
      sql.includes('INSERT INTO crawl_sources'),
    );
    expect(inserts).toHaveLength(9);
    const originalOneweUrl = 'https://rbwjapan.jp/artist/onewe.php';
    const currentOneweUrl = 'https://oneweofficial.jp/profile';
    expect(inserts.map(([, params]) => params[0]).sort()).toEqual(
      Object.keys(CDF_PROFILES)
        .map((url) => (url === currentOneweUrl ? originalOneweUrl : url))
        .sort(),
    );
    for (const [sql, [url, festival, artistName, handle]] of inserts) {
      expect(
        CDF_PROFILES[url === originalOneweUrl ? currentOneweUrl : url],
      ).toMatchObject({
        artistName,
        officialHandle: handle,
      });
      expect(festival).toBe('https://mintpaper.co.kr/festivals/178');
      expect(sql).toContain('"intervalMinutes"');
      expect(sql).toContain('1440');
      expect(sql).toContain("now() - interval '1 day'");
      expect(sql).toContain('"parserConfig"->>\'artistName\' = $3::text');
      expect(sql).not.toMatch(/https:\/\/[^']+\.(?:jpe?g|png|webp)/);
    }
  });

  it('stops when another enabled CDF photo source already owns the artist', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'existing' }]);
    await expect(
      new CdfOfficialProfiles1792500068000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('충돌하는 기존 소스');
    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as unknown as [string, string[]][];
    expect(calls[0][0]).toContain("IS DISTINCT FROM 'cdf-official-profile'");
  });

  it('only removes its own sources when no run exists', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new CdfOfficialProfiles1792500068000().down({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(9);
    for (const [sql, params] of query.mock.calls as [string, string[]][]) {
      expect(sql).toContain(
        "\"parserConfig\"->>'seed' = 'cdf-official-profile'",
      );
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('crawl_runs');
      expect(params).toHaveLength(3);
    }
  });
});
