import { QueryRunner } from 'typeorm';
import { OnewayOfficialChannels1792500092000 } from './1792500092000-oneway-official-channels';
import {
  ONEWAY_CHANNELS,
  ONEWAY_CHANNEL_SEED,
  ONEWAY_FESTIVAL_URL,
} from '../../modules/admin/crawl/service/oneway-official-channel';

describe('OneWay artist channel source migration', () => {
  it('registers exactly two daily sources without storing image URLs', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new OnewayOfficialChannels1792500092000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(4);
    const calls = query.mock.calls as [string, unknown[]][];
    for (const [index, [url, channel]] of Object.entries(
      ONEWAY_CHANNELS,
    ).entries()) {
      const values = [
        url,
        ONEWAY_FESTIVAL_URL,
        channel.artistName,
        ONEWAY_CHANNEL_SEED,
      ];
      expect(calls[index * 2][1]).toEqual(values);
      expect(calls[index * 2 + 1][1]).toEqual(values);
      const insert = calls[index * 2 + 1][0];
      expect(insert).toContain('WHERE NOT EXISTS');
      expect(insert).toContain('1440');
      expect(insert).not.toMatch(/imageUrl|imageHint|googleusercontent/);
    }
  });

  it('does not replace a conflicting or intentionally disabled source', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'existing' }]);
    await expect(
      new OnewayOfficialChannels1792500092000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('충돌하거나 비활성화된');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
