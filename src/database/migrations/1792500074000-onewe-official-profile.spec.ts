import { QueryRunner } from 'typeorm';
import { OneweOfficialProfile1792500074000 } from './1792500074000-onewe-official-profile';

describe('ONEWE official profile source migration', () => {
  it('moves the reviewed CDF source to the official profile without an image URL', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;

    await new OneweOfficialProfile1792500074000().up(runner);

    const calls = query.mock.calls as [string, string[]][];
    expect(query).toHaveBeenCalledTimes(3);
    expect(calls[1][0]).toContain('UPDATE crawl_sources SET url');
    expect(calls[1][1]).toEqual([
      'https://oneweofficial.jp/profile',
      'https://rbwjapan.jp/artist/onewe.php',
      'https://mintpaper.co.kr/festivals/178',
      'ONEWE(원위)',
      'official_onewe',
    ]);
    expect(calls[2][0]).toContain('WHERE NOT EXISTS');
    expect(calls[2][1]).toEqual([
      'https://oneweofficial.jp/profile',
      'https://mintpaper.co.kr/festivals/178',
      'ONEWE(원위)',
      'official_onewe',
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain('image.fanicon.net');
  });

  it('stops when another enabled source already claims the same artist', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'conflict' }]);
    const runner = { query } as unknown as QueryRunner;

    await expect(
      new OneweOfficialProfile1792500074000().up(runner),
    ).rejects.toThrow('충돌하는 기존 소스');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects rollback without changing source rows or crawl history', async () => {
    await expect(
      new OneweOfficialProfile1792500074000().down(),
    ).rejects.toThrow('수동으로 되돌려야');
  });
});
