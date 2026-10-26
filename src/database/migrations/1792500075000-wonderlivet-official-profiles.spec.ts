import { QueryRunner } from 'typeorm';
import { WonderlivetOfficialProfiles1792500075000 } from './1792500075000-wonderlivet-official-profiles';
import {
  WONDERLIVET_PROFILE_FESTIVAL_URL,
  WONDERLIVET_PROFILE_SEED,
  WONDERLIVET_PROFILES,
} from '../../modules/admin/crawl/service/wonderlivet-profile';

describe('Wonderlivet official profile source migration', () => {
  it('seeds six reviewed pages without fixed image URLs and prevents conflicting sources', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;
    await new WonderlivetOfficialProfiles1792500075000().up(runner);
    expect(query).toHaveBeenCalledTimes(
      Object.keys(WONDERLIVET_PROFILES).length * 2,
    );
    for (const [page, profile] of Object.entries(WONDERLIVET_PROFILES)) {
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO crawl_sources'),
        [
          page,
          WONDERLIVET_PROFILE_FESTIVAL_URL,
          profile.artistName,
          WONDERLIVET_PROFILE_SEED,
        ],
      );
    }
    expect(
      query.mock.calls.map((call: unknown[]) => String(call[0])).join(' '),
    ).not.toMatch(/imageUrl|imageHint/);
  });

  it('fails closed when an enabled competing source already owns the artist', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'existing' }]);
    await expect(
      new WonderlivetOfficialProfiles1792500075000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('충돌하는 기존 소스');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
