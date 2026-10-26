import { QueryRunner } from 'typeorm';
import { ScrubUntrustedGalleryIdentity1792500073000 } from '../../database/migrations/1792500073000-scrub-untrusted-gallery-identity';
import { discoverySummaries } from './crawl-catalog';
import { PublicFestivalService } from './public-festival.service';
describe('discovered festival artist profile images', () => {
  it('adds only saved official GMF child artists when the discovery has no lineup', async () => {
    const gmfUrl = 'https://mintpaper.co.kr/festivals/172';
    const candidate = {
      name: 'Grand Mint Festival 2026',
      venue: 'Olympic Park',
      date: '2026.10.17 - 2026.10.18',
      url: gmfUrl,
      artists: [],
    };
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates AS')) return [{ candidate }];
      if (
        sql.includes('FROM crawl_images image') &&
        sql.includes("source.kind = 'artist-image'")
      )
        return [
          {
            festivalSourceUrl: gmfUrl,
            artistName: '이소라',
            seed: 'official-gmf-lineup',
            id: 'official-photo',
          },
          {
            festivalSourceUrl: gmfUrl,
            artistName: '잘못된 소스',
            seed: 'manual',
            id: 'manual-photo',
          },
          {
            festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
            artistName: '다른 축제',
            seed: 'official-gmf-lineup',
            id: 'other-photo',
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
    const result = await service.detail(
      discoverySummaries([{ candidate }])[0].id,
    );
    expect(result.artists).toEqual([
      {
        name: '이소라',
        imageUrl: '/api/v1/festivals/images/official-photo.webp',
      },
    ]);
    expect(result.timetable).toEqual([]);
  });

  it('uses an official CDF profile photo in detail and timetable with the ONEWE lineup alias', async () => {
    const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
    const candidate = {
      name: 'COUNTDOWN FANTASY 2026-2027',
      venue: '킨텍스',
      date: '2026.12.31 - 2026.12.31',
      url: festivalUrl,
      artists: [{ name: 'ONEWE' }],
      officialProfileArtists: [
        {
          name: 'ONEWE(원위)',
          profileUrl: 'https://www.instagram.com/official_onewe/',
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
          festivalSourceUrl: festivalUrl,
          artistName: 'ONEWE(원위)',
          artistAlias: null,
          id: 'cdf-onewe-photo',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'cdf-timetable',
          sourceUrl: festivalUrl,
          sourceImageId: null,
          verifiedAt: new Date('2026-10-23T00:00:00Z'),
          sets: [
            {
              artist: 'ONEWE',
              date: '2026-12-31',
              stageName: 'Main',
              startsAt: '2026-12-31T18:00:00+09:00',
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
    const result = await service.detail(
      discoverySummaries([{ candidate }])[0].id,
    );
    const imageUrl = '/api/v1/festivals/images/cdf-onewe-photo.webp';
    expect(result.artists).toContainEqual(
      expect.objectContaining({ name: 'ONEWE', imageUrl }),
    );
    expect(result.timetable).toContainEqual(
      expect.objectContaining({ artist: 'ONEWE', imageUrl }),
    );
  });

  it('shows only the saved GMF artist image on its official festival detail', async () => {
    const gmfUrl = 'https://mintpaper.co.kr/festivals/172';
    const otherUrl = 'https://mintpaper.co.kr/festivals/178';
    const candidate = {
      name: 'GRAND MINT FESTIVAL 2026',
      venue: '올림픽공원',
      date: '2026.10.17 - 2026.10.18',
      url: gmfUrl,
      artists: [{ name: '이소라' }],
    };
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates AS')) return [{ candidate }];
      if (sql.includes('FROM admin_festivals')) return [];
      if (
        sql.includes('FROM crawl_images image') &&
        sql.includes("source.kind = 'artist-image'")
      )
        return [
          { festivalSourceUrl: gmfUrl, artistName: '이소라', id: 'gmf-photo' },
          {
            festivalSourceUrl: otherUrl,
            artistName: '이소라',
            id: 'other-photo',
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
    const result = await service.detail(
      discoverySummaries([{ candidate }])[0].id,
    );
    expect(result.artists).toContainEqual({
      name: '이소라',
      imageUrl: '/api/v1/festivals/images/gmf-photo.webp',
    });
    const imageQuery = (query.mock.calls as [string, unknown[]][]).find(
      ([sql]) =>
        sql.includes('FROM crawl_images image') &&
        sql.includes("source.kind = 'artist-image'"),
    );
    expect(imageQuery?.[1][0]).toContain(gmfUrl);
    expect(imageQuery?.[1][0]).not.toContain(otherUrl);
  });

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
    expect(calls[0][0]).toContain('"sourceSeed" = \'official-lineup\'');
    expect(calls[0][0]).toContain(
      "NOT IN (\n                 'https://www.mintpaper.co.kr/posts/4819'",
    );
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
    expect(query).toHaveBeenCalledTimes(5);
    expect(
      (query.mock.calls as unknown as [string, [string[]]][])[3][1][0],
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
    )[4];
    expect(profileQuery[1][0]).toEqual([sourceUrl]);
  });

  it('attaches the stored Seoul profile to its YES24 catalog festival', async () => {
    const catalogUrl = 'https://ticket.yes24.com/Perf/60368';
    const candidate = {
      name: '2026 서울뮤직페스티벌',
      venue: '노들섬 잔디마당 야외 특설무대',
      date: '2026-10-24 ~ 2026-10-24',
      url: catalogUrl,
      artists: [{ name: '추다해차지스' }],
    };
    const id = discoverySummaries([{ candidate }])[0].id;
    const imageId = '00000000-0000-4000-8000-000000000848';
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: catalogUrl,
          artistName: '추다해차지스',
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
          name: '추다해차지스',
          imageUrl: `/api/v1/festivals/images/${imageId}.webp`,
        },
      ],
    });
    const profileQuery = (
      query.mock.calls as unknown as [string, [string[]]][]
    )[2];
    expect(profileQuery[1][0]).toEqual([catalogUrl]);
  });

  it('links a stored official artist photo only after the exact Melon product is verified', async () => {
    const melon =
      'https://ticket.melon.com/performance/index.htm?prodId=214999';
    const official = 'https://www.wonderli.vet/lineup';
    const candidate = {
      name: 'WONDERLIVET 2026 (원더리벳 2026)',
      venue: 'KINTEX HALL 7/8/9/10',
      date: '2026.11.20 - 2026.11.22',
      url: melon,
      artists: [{ name: 'The Shepherd Bois' }],
    };
    const imageId = '00000000-0000-4000-8000-000000000199';
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ url: melon, candidate }])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: official,
          artistName: 'The Shepherd Bois',
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
    const original = discoverySummaries([{ candidate }])[0];
    const detail = await service.detail(original.id);
    expect(detail).toMatchObject({
      id: original.id,
      sourceUrl: melon,
      ticketLinks: [{ label: '멜론티켓', url: melon }],
      artists: [
        {
          name: 'The Shepherd Bois',
          imageUrl: `/api/v1/festivals/images/${imageId}.webp`,
        },
      ],
    });
    expect(
      (query.mock.calls as unknown as [string, [string[]]][])[3][1][0],
    ).toEqual([melon, official]);
    const proofQuery = (
      query.mock.calls as unknown as [string, unknown[]][]
    )[2][0];
    const catalogQuery = (
      query.mock.calls as unknown as [string, unknown[]][]
    )[0][0];
    expect(catalogQuery).toContain('jsonb_array_elements_text');
    expect(catalogQuery).toContain('FROM latest JOIN details USING (url)');
    expect(proofQuery).toContain(
      "verified.result IN ('nochange-parsed', 'unchanged')",
    );
    expect(proofQuery).toContain('newer."startedAt" > verified."startedAt"');
    expect(proofQuery).toContain("latest.status IS DISTINCT FROM 'rejected'");
    expect(proofQuery).toContain("latest.decision IS DISTINCT FROM 'rejected'");
    expect(proofQuery).toContain(
      "childRun.result IN ('proposed', 'unchanged', 'nochange-parsed')",
    );
    expect(proofQuery).toContain(
      "childRun.result IN ('proposed', 'unchanged')",
    );
    expect(proofQuery).toContain(
      'proposedRun."contentHash" = childRun."contentHash"',
    );
    expect(proofQuery).toContain("childRun.result = 'nochange-parsed'");
    expect(proofQuery).toContain('childRun."proposalId" = latest."proposalId"');
    expect(proofQuery).toContain('proposedRun."sourceId" = child.id');
    expect(proofQuery).toContain('jsonb_build_array(child.url, $3::text)');
  });

  it('does not bridge a rejected latest proposal to the official lineup', async () => {
    const melon =
      'https://ticket.melon.com/performance/index.htm?prodId=214999';
    const candidate = {
      name: 'WONDERLIVET 2026',
      venue: 'KINTEX HALL 7/8/9/10',
      date: '2026.11.20 - 2026.11.22',
      url: melon,
      artists: [{ name: 'The Shepherd Bois' }],
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const detail = await service.detail(
      discoverySummaries([{ candidate }])[0].id,
    );
    expect(detail).toMatchObject({
      artists: [{ name: 'The Shepherd Bois', imageUrl: null }],
    });
    const proofQuery = (
      query.mock.calls as unknown as [string, unknown[]][]
    )[2][0];
    expect(proofQuery).toContain("latest.status IS DISTINCT FROM 'rejected'");
    expect(proofQuery).toContain("latest.decision IS DISTINCT FROM 'rejected'");
  });

  it.each([
    [
      'another product',
      'https://ticket.melon.com/performance/index.htm?prodId=999',
    ],
    [
      'another event',
      'https://ticket.melon.com/performance/index.htm?prodId=214999',
    ],
  ])('does not borrow a photo for %s', async (reason, verifiedUrl) => {
    const melon =
      'https://ticket.melon.com/performance/index.htm?prodId=214999';
    const candidate = {
      name: 'WONDERLIVET 2026',
      venue: 'KINTEX',
      date: '2026.11.20 - 2026.11.22',
      url: melon,
      artists: [{ name: 'The Shepherd Bois' }],
    };
    const proof = {
      ...candidate,
      ...(reason === 'another event'
        ? { date: '2026.11.21 - 2026.11.22' }
        : {}),
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ url: verifiedUrl, candidate: proof }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
    const detail = await service.detail(
      discoverySummaries([{ candidate }])[0].id,
    );
    expect(detail.artists).toContainEqual({
      name: 'The Shepherd Bois',
      imageUrl: null,
    });
    expect(
      (query.mock.calls as unknown as [string, [string[]]][])[3][1][0],
    ).toEqual([melon]);
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

  it('shows an XMF official modal photo for a verified full name without leaking another festival photo', async () => {
    const sourceUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213766';
    const unrelatedUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=999999';
    const candidate = {
      name: 'XMF 2026',
      venue: '파라다이스시티',
      date: '2026.10.03 - 2026.10.04',
      url: sourceUrl,
      artists: [
        { name: '나카시마 미카' },
        { name: 'MIKA NAKASHIMA' },
        { name: '다른 가수' },
      ],
    };
    const imageId = '00000000-0000-4000-8000-000000000051';
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: sourceUrl,
          artistName: 'MIKA',
          artistAlias: '나카시마 미카',
          artistOfficialName: 'MIKA NAKASHIMA',
          id: imageId,
        },
        {
          festivalSourceUrl: unrelatedUrl,
          artistName: '다른 가수',
          artistAlias: null,
          artistOfficialName: null,
          id: '00000000-0000-4000-8000-000000000052',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'xmf-official-revision',
          sourceUrl: 'https://xmfestival.com/notice',
          sourceImageId: null,
          verifiedAt: new Date('2026-10-23T00:00:00Z'),
          sets: [
            {
              artist: '나카시마 미카',
              date: '2026-10-03',
              stageName: 'STAGE A',
              startsAt: '2026-10-03T21:00:00+09:00',
              endsAt: null,
            },
            {
              artist: 'MIKA NAKASHIMA',
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

    const result = await service.detail(
      discoverySummaries([{ candidate }])[0].id,
    );

    const imageUrl = `/api/v1/festivals/images/${imageId}.webp`;
    expect(result.artists).toContainEqual({ name: '나카시마 미카', imageUrl });
    expect(result.artists).toContainEqual({ name: 'MIKA NAKASHIMA', imageUrl });
    expect(result.artists).toContainEqual({
      name: '다른 가수',
      imageUrl: null,
    });
    expect(result.timetable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artist: '나카시마 미카', imageUrl }),
        expect.objectContaining({ artist: 'MIKA NAKASHIMA', imageUrl }),
      ]),
    );
    const profileQuery = (
      query.mock.calls as unknown as [string, [string[]]][]
    )[2];
    expect(profileQuery[0]).toContain("'official-artist-gallery'");
    const galleryPredicate =
      /source\."parserConfig"->>'seed' = 'official-artist-gallery'\s+AND source\."parserConfig"->>'artistOfficialNameSource' =\s+'official-notice-and-modal-site'\s+AND EXISTS \(\s+SELECT 1 FROM crawl_sources gallery\s+WHERE gallery\.kind = 'artist-gallery'\s+AND gallery\.enabled = true\s+AND gallery\.url = source\.url\s+AND gallery\."parserConfig"->>'seed' = 'xmf-official-gallery'\s+AND gallery\."parserConfig"->>'festivalSourceUrl' =\s+source\."parserConfig"->>'festivalSourceUrl'\s+\)/g;
    expect(profileQuery[0].match(galleryPredicate)).toHaveLength(2);
    expect(profileQuery[0]).toMatch(
      /CASE WHEN source\."parserConfig"->>'seed' = 'official-artist-gallery'[\s\S]+THEN source\."parserConfig"->>'artistOfficialName'/,
    );
    expect(profileQuery[0]).not.toContain('prodId=213766');
    expect(profileQuery[1][0]).toEqual([sourceUrl]);
  });

  it('scrubs historical admin-created identity claims while preserving crawler-created sources', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new ScrubUntrustedGalleryIdentity1792500073000().up({
      query,
    } as unknown as QueryRunner);

    const sql = (query.mock.calls as unknown as [string][])[0][0];
    expect(sql).toContain("source.kind = 'artist-image'");
    expect(sql).toContain('source."parserConfig" ?| ARRAY[');
    expect(sql).toContain("'officialSiteKeys', 'artistOfficialName'");
    expect(sql).toContain("'artistOfficialNameSource'");
    expect(sql).toContain("THEN ARRAY['seed']::text[]");
    expect(sql).toContain(
      "'official-artist-gallery' THEN false ELSE source.enabled END",
    );
    expect(sql).toContain(
      "'official-artist-gallery' THEN 'disabled' ELSE source.status END",
    );
    expect(sql).toContain("audit.action = 'crawl.source.created'");
    expect(sql).toContain("audit.target = 'crawl-source:' || source.id::text");
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
