import { QueryRunner } from 'typeorm';
import { FestivalOfficialProfiles1792500076000 } from './1792500076000-festival-official-profiles';
import {
  FESTIVAL_PROFILE_SEED,
  FESTIVAL_PROFILES,
} from '../../modules/admin/crawl/service/festival-profile';

describe('Seoul Music and Oneway official profile source migration', () => {
  it('seeds three reviewed page and artist pairs without fixed image URLs', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new FestivalOfficialProfiles1792500076000().up({
      query,
    } as unknown as QueryRunner);
    expect(Object.keys(FESTIVAL_PROFILES)).toHaveLength(3);
    expect(query).toHaveBeenCalledTimes(6);
    for (const [page, profile] of Object.entries(FESTIVAL_PROFILES))
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO crawl_sources'),
        [
          page,
          profile.festivalSourceUrl,
          profile.artistName,
          FESTIVAL_PROFILE_SEED,
        ],
      );
    expect(
      query.mock.calls.map((call: unknown[]) => String(call[0])).join(' '),
    ).not.toMatch(/imageUrl|imageHint/);
  });

  it('stops when an enabled source already owns the festival artist', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'existing' }]);
    await expect(
      new FestivalOfficialProfiles1792500076000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('충돌하는 기존 소스');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
