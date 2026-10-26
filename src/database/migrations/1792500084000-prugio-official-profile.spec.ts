import { QueryRunner } from 'typeorm';
import { PrugioOfficialProfile1792500084000 } from './1792500084000-prugio-official-profile';
import {
  PRUGIO_PROFILE_ARTIST,
  PRUGIO_PROFILE_SEED,
  PRUGIO_PROFILE_URL,
} from '../../modules/admin/crawl/service/prugio-profile';
import { PRUGIO_LINEUP_URL } from '../../modules/admin/crawl/service/prugio-lineup';

describe('Prugio official artist photo source migration', () => {
  const values = [
    PRUGIO_PROFILE_URL,
    PRUGIO_LINEUP_URL,
    PRUGIO_PROFILE_ARTIST,
    PRUGIO_PROFILE_SEED,
  ];

  it('registers a daily dynamic source with valid SQL placeholders', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new PrugioOfficialProfile1792500084000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(3);
    const statements = query.mock.calls as [string, unknown[]][];
    for (const [sql, parameters] of statements) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) =>
        Number(match[1]),
      );
      expect([...new Set(placeholders)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: parameters.length }, (_, index) => index + 1),
      );
    }
    expect(statements[1][1]).toEqual([
      PRUGIO_LINEUP_URL,
      PRUGIO_PROFILE_ARTIST,
    ]);
    expect(statements[2][0]).toContain('1440');
    expect(statements[2][0]).not.toMatch(/imageUrl|imageHint/);
    expect(statements[2][1]).toEqual(values);
  });

  it('rejects a competing active or intentionally disabled source', async () => {
    for (const result of [[[{ id: 'active' }]], [[], [{ id: 'disabled' }]]]) {
      const query = jest.fn();
      result.forEach((rows) => query.mockResolvedValueOnce(rows));
      await expect(
        new PrugioOfficialProfile1792500084000().up({
          query,
        } as unknown as QueryRunner),
      ).rejects.toThrow();
      expect(query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO crawl_sources'),
        values,
      );
    }
  });
});
