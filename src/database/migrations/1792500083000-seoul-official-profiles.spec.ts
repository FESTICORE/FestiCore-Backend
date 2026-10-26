import { QueryRunner } from 'typeorm';
import { SeoulOfficialProfiles1792500083000 } from './1792500083000-seoul-official-profiles';
import { ADDITIONAL_FESTIVAL_PROFILE_SEED } from '../../modules/admin/crawl/service/additional-festival-profile';

describe('Seoul official artist photo sources', () => {
  it('registers two daily sources without storing an image URL', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SeoulOfficialProfiles1792500083000().up({
      query,
    } as unknown as QueryRunner);
    const inserts = (
      query.mock.calls as unknown as [string, string[]][]
    ).filter(([sql]) => sql.includes('INSERT INTO crawl_sources'));
    expect(inserts).toHaveLength(2);
    expect(inserts.map(([, values]) => values[0])).toEqual([
      'https://paulkim.co.kr/',
      'https://www.yoursummer.net/artist/nerd-connection',
    ]);
    for (const [sql, values] of inserts) {
      expect(sql).toContain('1440');
      expect(sql).toContain("now() - interval '1 day'");
      expect(sql).not.toMatch(/imageUrl|imageHint/);
      expect(values).toHaveLength(4);
      expect(values[3]).toBe(ADDITIONAL_FESTIVAL_PROFILE_SEED);
    }
  });

  it('fails on conflicting or disabled artist sources', async () => {
    for (const result of [[[{ id: 'conflict' }]], [[], [{ id: 'disabled' }]]]) {
      const query = jest.fn();
      result.forEach((rows) => query.mockResolvedValueOnce(rows));
      await expect(
        new SeoulOfficialProfiles1792500083000().up({
          query,
        } as unknown as QueryRunner),
      ).rejects.toThrow();
      expect(
        (query.mock.calls as unknown as [string, unknown[]][]).some(([sql]) =>
          sql.includes('INSERT'),
        ),
      ).toBe(false);
    }
  });
});
