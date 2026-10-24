import { discoverySummaries } from './crawl-catalog';
import { PublicFestivalService } from './public-festival.service';
describe('discovered festival artist profile images', () => {
  it('shows an official CDF performer profile beside an already stored artist photo', async () => {
    const candidate = {
      name: 'COUNTDOWN FANTASY 2026-2027',
      venue: '킨텍스',
      date: '2026.12.31 - 2026.12.31',
      url: 'https://mintpaper.co.kr/festivals/178',
      artistSourceUrl: 'https://ticket.yes24.com/Perf/60590',
      artists: [{ name: '혁오' }],
      officialProfileArtists: [
        {
          name: '혁오',
          profileUrl: 'https://www.instagram.com/hyukohofficial/',
        },
      ],
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: candidate.url,
          artistName: '혁오',
          artistAlias: null,
          id: 'stored-image',
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
        {
          name: '혁오',
          profileUrl: 'https://www.instagram.com/hyukohofficial/',
          imageUrl: '/api/v1/festivals/images/stored-image.webp',
        },
      ],
    });
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0][0]).toContain('"officialProfileArtists"');
    expect(calls[0][0]).toContain("'https://www.mintpaper.co.kr/posts/4819'");
    expect(calls[0][0]).toContain(
      "jsonb_build_object(\n               'artists', candidate->'artists', 'url', candidate->>'url')",
    );
    expect(calls[0][0]).toContain('details."artistDetails"->\'artists\'');
    expect(calls[0][0]).toContain('details."artistDetails"->>\'url\'');
  });

  it('prefers a stored primary performer image over a linked source profile', async () => {
    const yes24Url = 'https://ticket.yes24.com/Perf/60590';
    const melonUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213793';
    const performerUrl = 'https://tkfile.yes24.com/artists/band-a.jpg';
    const candidates = [
      {
        candidate: {
          name: 'Linked Festival',
          venue: 'KINTEX',
          date: '2026.11.20 - 2026.11.21',
          url: yes24Url,
          artists: [{ name: 'Band A', sourceUrl: performerUrl }],
        },
      },
      {
        candidate: {
          name: 'Linked Festival',
          venue: 'KINTEX',
          date: '2026.11.20 - 2026.11.21',
          url: melonUrl,
          artists: [{ name: 'Band A' }],
        },
      },
    ];
    const query = jest
      .fn()
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ originUrl: performerUrl, id: 'primary-image' }])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: melonUrl,
          artistName: 'Band A',
          id: 'linked-image',
        },
      ])
      .mockResolvedValueOnce([]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const id = discoverySummaries(candidates)[0].id;
    await expect(service.detail(id)).resolves.toMatchObject({
      artists: [
        {
          name: 'Band A',
          imageUrl: '/api/v1/festivals/images/primary-image.webp',
        },
      ],
    });
  });

  it('keeps the primary image when two linked sources store different photos of one artist', async () => {
    const yes24Url = 'https://ticket.yes24.com/Perf/60590';
    const melonUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213793';
    const candidates = [yes24Url, melonUrl].map((url) => ({
      candidate: {
        name: 'Linked Festival',
        venue: 'KINTEX',
        date: '2026.11.20 - 2026.11.21',
        url,
        artists: [{ name: 'Band A' }],
      },
    }));
    const primaryId = '00000000-0000-4000-8000-000000000041';
    const query = jest
      .fn()
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { festivalSourceUrl: yes24Url, artistName: 'Band A', id: primaryId },
        {
          festivalSourceUrl: melonUrl,
          artistName: 'Band A',
          id: '00000000-0000-4000-8000-000000000042',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'revision-1',
          sourceUrl: 'https://official.example/timetable',
          sourceImageId: null,
          verifiedAt: new Date('2026-10-23T00:00:00Z'),
          sets: [
            {
              artist: 'Band A',
              date: '2026-11-20',
              stageName: 'Main',
              startsAt: '2026-11-20T18:00:00+09:00',
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
    const result = await service.detail(discoverySummaries(candidates)[0].id);
    const imageUrl = `/api/v1/festivals/images/${primaryId}.webp`;
    expect(result.artists).toContainEqual({ name: 'Band A', imageUrl });
    expect(result.timetable).toEqual([
      expect.objectContaining({ artist: 'Band A', imageUrl }),
    ]);
  });

  it.each([
    ['YES24 first', false],
    ['Melon first', true],
  ])(
    'uses linked source images and timetable when %s',
    async (_label, melonFirst) => {
      const yes24Url = 'https://ticket.yes24.com/Perf/60590';
      const melonUrl =
        'https://ticket.melon.com/performance/index.htm?prodId=213793';
      const imageId = '00000000-0000-4000-8000-000000000031';
      const unrelatedUrl =
        'https://ticket.melon.com/performance/index.htm?prodId=999999';
      const candidates = [
        {
          candidate: {
            name: 'Linked Festival',
            venue: 'KINTEX',
            date: '2026.11.20 - 2026.11.21',
            url: yes24Url,
            artists: [{ name: 'Band A' }],
          },
        },
        {
          candidate: {
            name: 'Linked Festival',
            venue: 'KINTEX',
            date: '2026.11.20 - 2026.11.21',
            url: melonUrl,
            artists: [{ name: 'Band A' }],
          },
        },
      ];
      if (melonFirst) candidates.reverse();
      const query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('WITH candidates AS')) return candidates;
        if (sql.includes('FROM admin_festivals')) return [];
        if (sql.includes('SELECT DISTINCT ON (revision."sourceId")'))
          return [
            {
              id: 'linked-revision',
              sourceUrl: 'https://official.example/linked-timetable',
              sourceImageId: null,
              verifiedAt: new Date('2026-10-23T00:00:00Z'),
              sets: [
                {
                  artist: 'Band A',
                  date: '2026-11-20',
                  stageName: 'Main',
                  startsAt: '2026-11-20T18:00:00+09:00',
                  endsAt: null,
                },
              ],
            },
          ];
        if (
          sql.includes('FROM crawl_images image') &&
          sql.includes("source.kind = 'artist-image'")
        )
          return [
            { festivalSourceUrl: melonUrl, artistName: 'Band A', id: imageId },
            {
              festivalSourceUrl: unrelatedUrl,
              artistName: 'Band A',
              id: '00000000-0000-4000-8000-000000000032',
            },
          ];
        return [];
      });
      const service = new PublicFestivalService(
        { findOne: jest.fn().mockResolvedValue(null) } as never,
        {} as never,
        { query } as never,
        {} as never,
      );
      const id = discoverySummaries(candidates)[0].id;
      const result = await service.detail(id);
      expect(discoverySummaries(candidates)[0].sourceUrls).toEqual(
        expect.arrayContaining([yes24Url, melonUrl]),
      );
      const imageUrl = `/api/v1/festivals/images/${imageId}.webp`;
      expect(result.artists).toContainEqual({ name: 'Band A', imageUrl });
      expect(result.timetable).toEqual([
        expect.objectContaining({ artist: 'Band A', imageUrl }),
      ]);
      const sourceQueries = (
        query.mock.calls as unknown as [string, [string[]]][]
      ).filter(
        ([sql]) =>
          sql.includes('SELECT DISTINCT ON (revision."sourceId")') ||
          sql.includes('SELECT DISTINCT ON (source."parserConfig"'),
      );
      for (const [, [urls]] of sourceQueries) {
        expect(urls).toEqual(expect.arrayContaining([yes24Url, melonUrl]));
        expect(urls).not.toContain(unrelatedUrl);
      }
    },
  );

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

  it('does not choose a profile when reviewed aliases collide', async () => {
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
          artistName: 'Band A',
          artistAlias: 'DAY6',
          id: 'image-a',
        },
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'Band B',
          artistAlias: 'Day6',
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
