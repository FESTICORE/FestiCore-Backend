import { QueryRunner } from 'typeorm';
import { SeoulKimchangwanProfile1792500086000 } from './1792500086000-seoul-kimchangwan-profile';
import {
  ADDITIONAL_FESTIVAL_PROFILE_SEED,
  SEOUL_MUSIC_SOURCE_URL,
} from '../../modules/admin/crawl/service/additional-festival-profile';

describe('Seoul Kim Chang Wan Band official photo source', () => {
  it('registers the official page without storing a fixed image URL', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SeoulKimchangwanProfile1792500086000().up({
      query,
    } as unknown as QueryRunner);
    const insert = (query.mock.calls as unknown as [string, string[]][]).find(
      ([sql]) => sql.includes('INSERT INTO crawl_sources'),
    );
    expect(insert).toBeDefined();
    expect(insert![1]).toEqual([
      'https://kr.koreanculture.org/performing-arts/2025/08/06/kmusic-night/kor',
      SEOUL_MUSIC_SOURCE_URL,
      '김창완밴드',
      ADDITIONAL_FESTIVAL_PROFILE_SEED,
    ]);
    expect(insert![0]).toContain('1440');
    expect(insert![0]).not.toMatch(/imageUrl|imageHint/);
    for (const [sql, values] of query.mock.calls as unknown as [
      string,
      string[],
    ][]) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) =>
        Number(match[1]),
      );
      expect(Math.max(...placeholders)).toBe(values.length);
      expect(new Set(placeholders).size).toBe(values.length);
    }
  });

  it('stops if an enabled conflict or disabled artist source exists', async () => {
    for (const rows of [[[{ id: 'conflict' }]], [[], [{ id: 'disabled' }]]]) {
      const query = jest.fn();
      rows.forEach((result) => query.mockResolvedValueOnce(result));
      await expect(
        new SeoulKimchangwanProfile1792500086000().up({
          query,
        } as unknown as QueryRunner),
      ).rejects.toThrow();
      expect(
        (query.mock.calls as unknown as [string][]).some(([sql]) =>
          sql.includes('INSERT'),
        ),
      ).toBe(false);
    }
  });
});
