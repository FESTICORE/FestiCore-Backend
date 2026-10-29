import { GmfOfficialLineupImages1792500068000 } from './1792500068000-gmf-official-lineup-images';

describe('GMF official image source migration', () => {
  it('enables the gallery with the exact public festival URL and backdates daily eligibility', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new GmfOfficialLineupImages1792500068000().up({ query } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        '"createdAt" = LEAST("createdAt", now() - interval \'1 day\')',
      ),
      [
        'https://www.mintpaper.co.kr/festivals/172/lineup',
        'https://mintpaper.co.kr/festivals/172',
      ],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("true, 'ok', now() - interval '1 day'"),
      [
        'https://www.mintpaper.co.kr/festivals/172/lineup',
        'https://mintpaper.co.kr/festivals/172',
      ],
    );
  });
});
