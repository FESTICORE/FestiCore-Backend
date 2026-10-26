import { QueryRunner } from 'typeorm';
import { SukimaswitchOfficialProfile1792500082000 } from './1792500082000-sukimaswitch-official-profile';
import {
  SUKIMASWITCH_PROFILE,
  SUKIMASWITCH_PROFILE_URL,
  WONDERLIVET_PROFILE_FESTIVAL_URL,
  WONDERLIVET_PROFILE_SEED,
} from '../../modules/admin/crawl/service/wonderlivet-profile';

describe('SUKIMASWITCH official profile source migration', () => {
  const values = [
    SUKIMASWITCH_PROFILE_URL,
    WONDERLIVET_PROFILE_FESTIVAL_URL,
    SUKIMASWITCH_PROFILE.artistName,
    WONDERLIVET_PROFILE_SEED,
  ];

  it('registers a daily source without fixing the photo URL', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SukimaswitchOfficialProfile1792500082000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('enabled = false'),
      values.slice(0, 3),
    );
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO crawl_sources'),
      values,
    );
    const statements = query.mock.calls as [string, unknown[]][];
    for (const [sql, parameters] of statements) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) =>
        Number(match[1]),
      );
      expect(Math.max(...placeholders)).toBe(parameters.length);
    }
    expect(statements[2][0]).toContain('1440');
    expect(statements[2][0]).not.toMatch(/imageUrl|imageHint/);
  });

  it('rejects a competing or intentionally disabled source', async () => {
    for (const result of [[[{ id: 'active' }]], [[], [{ id: 'disabled' }]]]) {
      const query = jest.fn();
      result.forEach((rows) => query.mockResolvedValueOnce(rows));
      await expect(
        new SukimaswitchOfficialProfile1792500082000().up({
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
