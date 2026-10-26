import { QueryRunner } from 'typeorm';
import { AdditionalFestivalOfficialProfiles1792500080000 } from './1792500080000-additional-festival-official-profiles';
import {
  ADDITIONAL_FESTIVAL_PROFILE_SEED,
  ADDITIONAL_FESTIVAL_PROFILES,
} from '../../modules/admin/crawl/service/additional-festival-profile';

describe('additional Seoul Music official photo source migration', () => {
  it('registers two reviewed pages without fixed image URLs', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new AdditionalFestivalOfficialProfiles1792500080000().up({
      query,
    } as unknown as QueryRunner);
    expect(Object.keys(ADDITIONAL_FESTIVAL_PROFILES)).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(6);
    for (const [page, profile] of Object.entries(ADDITIONAL_FESTIVAL_PROFILES))
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO crawl_sources'),
        [
          page,
          profile.festivalSourceUrl,
          profile.artistName,
          ADDITIONAL_FESTIVAL_PROFILE_SEED,
        ],
      );
    expect(
      query.mock.calls.map((call: unknown[]) => String(call[0])).join(' '),
    ).not.toMatch(/imageUrl|imageHint/);
  });

  it('stops when an enabled source already owns the same festival artist', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'existing' }]);
    await expect(
      new AdditionalFestivalOfficialProfiles1792500080000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('충돌하는 기존 소스');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails instead of silently skipping a disabled matching source', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'disabled-source' }]);
    await expect(
      new AdditionalFestivalOfficialProfiles1792500080000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('비활성 공식 프로필 소스');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO crawl_sources'),
      expect.anything(),
    );
  });
});
