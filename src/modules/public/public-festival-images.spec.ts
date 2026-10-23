import { discoverySummaries } from './crawl-catalog';
import { PublicFestivalService } from './public-festival.service';
describe('discovered festival artist profile images', () => {
  it('does not infer a profile image without a stored source', async () => {
    const sourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213793';
    const candidate = {
      name: 'WONDERLIVET 2026',
      venue: 'KINTEX',
      date: '2026.11.20 - 2026.11.22',
      url: sourceUrl,
      artists: [{ name: 'CHiCO with HoneyWorks' }],
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const id = discoverySummaries([{ candidate }])[0].id;
    await expect(service.detail(id)).resolves.toMatchObject({
      artists: [
        {
          name: 'CHiCO with HoneyWorks',
          imageUrl: null,
        },
      ],
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(
      (query.mock.calls as unknown as [string, [string[]]][])[2][1][0],
    ).toEqual([sourceUrl]);
  });

  it('serves a stored profile image matched by festival source and artist', async () => {
    const sourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213793';
    const candidate = {
      name: 'WONDERLIVET 2026',
      venue: 'KINTEX',
      date: '2026.11.20 - 2026.11.22',
      url: sourceUrl,
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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'Brandy Senki',
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
    const profileQuery = (
      query.mock.calls as unknown as [string, [string[]]][]
    )[3];
    expect(profileQuery[1][0]).toEqual([sourceUrl]);
  });
});
