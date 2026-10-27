import { QueryRunner } from 'typeorm';
import { CdfLowHighLowProfile1792500091000 } from './1792500091000-cdf-low-high-low-profile';
import { CDF_FESTIVAL_URL } from '../../modules/admin/crawl/service/cdf-profile';
import {
  CDF_LOW_HIGH_LOW_PROFILE_SEED,
  CDF_LOW_HIGH_LOW_PROFILE_URL,
} from '../../modules/admin/crawl/service/cdf-low-high-low-profile';

const values = [
  CDF_LOW_HIGH_LOW_PROFILE_URL,
  CDF_FESTIVAL_URL,
  '로우하이로우',
  'LOW HIGH LOW',
  CDF_LOW_HIGH_LOW_PROFILE_SEED,
];

describe('CDF LOW HIGH LOW official photo source migration', () => {
  it('registers an idempotent daily source without a hardcoded photo', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new CdfLowHighLowProfile1792500091000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, parameters] of query.mock.calls as [string, unknown[]][]) {
      expect(parameters).toEqual(values);
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) =>
        Number(match[1]),
      );
      expect([...new Set(placeholders)].sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5,
      ]);
    }
    const insert = (query.mock.calls as [string, unknown[]][])[1][0];
    expect(insert).toContain('INSERT INTO crawl_sources');
    expect(insert).toContain('WHERE NOT EXISTS');
    expect(insert).toContain('1440');
    expect(insert).not.toMatch(/imageUrl|imageHint|cdnimg/);
  });

  it('preserves competing and intentionally disabled artist sources', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'existing' }]);
    await expect(
      new CdfLowHighLowProfile1792500091000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('충돌하거나 비활성화된');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
