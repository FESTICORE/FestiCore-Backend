import { discoverySummaries } from './crawl-catalog';
import { PublicFestivalService } from './public-festival.service';
import {
  WONDERLIVET_ARTIST_IMAGES,
  WONDERLIVET_MELON_DETAIL_URL,
} from './wonderlivet-artist-images';

describe('discovered festival official artist images', () => {
  it('serves a locally stored official replacement for a Melon placeholder', async () => {
    const candidate = {
      name: 'WONDERLIVET 2026',
      venue: 'KINTEX',
      date: '2026.11.20 - 2026.11.22',
      url: WONDERLIVET_MELON_DETAIL_URL,
      artists: [
        {
          name: 'Brandy Senki',
          sourceUrl: 'https://cdnimg.melon.co.kr/melon/thumbnail/320x300',
        },
      ],
    };
    const id = discoverySummaries([{ candidate }])[0].id;
    const imageId = '00000000-0000-4000-8000-000000000001';
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          originUrl: WONDERLIVET_ARTIST_IMAGES['Brandy Senki'],
          id: imageId,
        },
      ]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    await expect(service.detail(id)).resolves.toMatchObject({
      artists: [
        {
          name: 'Brandy Senki',
          imageUrl: `/api/v1/festivals/images/${imageId}.webp`,
        },
      ],
    });
    const imageQuery = (
      query.mock.calls as unknown as [string, [string[]]][]
    )[2];
    expect(imageQuery[1][0]).toEqual([
      WONDERLIVET_ARTIST_IMAGES['Brandy Senki'],
    ]);
  });
});
