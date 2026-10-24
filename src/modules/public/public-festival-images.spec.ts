import { discoverySummaries } from './crawl-catalog';
import { PublicFestivalService } from './public-festival.service';
describe('discovered festival artist profile images', () => {
  it('serves a YES24 performer image only when its exact origin URL was stored', async () => {
    const imageUrl = 'https://tkfile.yes24.com/artists/band-a.jpg';
    const candidate = {
      name: 'COUNTDOWN FANTASY 2026-2027',
      venue: '킨텍스',
      date: '2026.12.31 - 2026.12.31',
      url: 'https://ticket.yes24.com/Perf/60590',
      artists: [
        { name: 'Band A', sourceUrl: imageUrl },
        {
          name: 'Band B',
          sourceUrl: 'https://tkfile.yes24.com/artists/band-b.jpg',
        },
      ],
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ originUrl: imageUrl, id: 'image-a' }])
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
        { name: 'Band A', imageUrl: '/api/v1/festivals/images/image-a.webp' },
        { name: 'Band B', imageUrl: null },
      ],
    });
    const imageQuery = (
      query.mock.calls as unknown as [string, [string[]]][]
    )[2];
    expect(imageQuery[0]).toContain(
      'image."originUrl" LIKE \'https://tkfile.yes24.com/%\'',
    );
    expect(imageQuery[1]).toEqual([
      [imageUrl, 'https://tkfile.yes24.com/artists/band-b.jpg'],
    ]);
  });

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
    expect(query).toHaveBeenCalledTimes(4);
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
      ])
      .mockResolvedValueOnce([]);
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

  it('uses a reviewed alternate artist name for the lineup and timetable', async () => {
    const sourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213766';
    const candidate = {
      name: 'XMF 2026',
      venue: '파라다이스시티',
      date: '2026.10.03 - 2026.10.04',
      url: sourceUrl,
      artists: [{ name: '데이식스' }],
    };
    const imageId = '00000000-0000-4000-8000-000000000001';
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'DAY6',
          artistAlias: '데이식스',
          id: imageId,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '00000000-0000-4000-8000-000000000002',
          sourceUrl: 'https://xmfestival.com/notice',
          sourceImageId: null,
          verifiedAt: new Date('2026-10-23T00:00:00Z'),
          sets: [
            {
              artist: 'DAY6',
              date: '2026-10-04',
              stageName: 'STAGE A',
              startsAt: '2026-10-04T21:00:00+09:00',
              endsAt: null,
            },
          ],
        },
      ]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const id = discoverySummaries([{ candidate }])[0].id;
    const result = await service.detail(id);
    const imageUrl = `/api/v1/festivals/images/${imageId}.webp`;
    expect(result.artists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '데이식스', imageUrl }),
        expect.objectContaining({ name: 'DAY6', imageUrl }),
      ]),
    );
    expect(result.timetable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artist: 'DAY6', imageUrl }),
      ]),
    );
  });

  it('matches harmless name formatting differences without guessing a different artist', async () => {
    const sourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213766';
    const candidate = {
      name: 'XMF 2026',
      venue: '파라다이스시티',
      date: '2026.10.03 - 2026.10.04',
      url: sourceUrl,
      artists: [{ name: '  DAY6  ' }, { name: 'Ado' }],
    };
    const imageId = '00000000-0000-4000-8000-000000000001';
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'day6',
          artistAlias: null,
          id: imageId,
        },
      ])
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
        { name: 'DAY6', imageUrl: `/api/v1/festivals/images/${imageId}.webp` },
        { name: 'Ado', imageUrl: null },
      ],
    });
  });

  it('does not choose a profile when normalized names collide', async () => {
    const sourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213766';
    const candidate = {
      name: 'XMF 2026',
      venue: '파라다이스시티',
      date: '2026.10.03 - 2026.10.04',
      url: sourceUrl,
      artists: [{ name: 'day6' }],
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'DAY6',
          artistAlias: null,
          id: 'image-a',
        },
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'Day6',
          artistAlias: null,
          id: 'image-b',
        },
      ])
      .mockResolvedValueOnce([]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const id = discoverySummaries([{ candidate }])[0].id;
    await expect(service.detail(id)).resolves.toMatchObject({
      artists: [{ name: 'day6', imageUrl: null }],
    });
  });
});
