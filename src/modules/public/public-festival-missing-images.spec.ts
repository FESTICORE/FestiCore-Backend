import { publicFestivalTestDataSource } from '../../../test/public-festival-test-data-source';
import {
  publicPackEtag,
  PublicFestivalService,
} from './public-festival.service';
import { PublicImageRow } from './published-image-overlay';

const imageId = '00000000-0000-4000-8000-000000000001';
const anotherImageId = '00000000-0000-4000-8000-000000000002';
const imageUrl = (id: string) => `/api/v1/festivals/images/${id}.webp`;
const sourceUrl = 'https://festival.example.com/2026';

function publishedFestival(
  id: string,
  artist: string,
  storedImage: string | null = null,
) {
  return {
    id,
    published: {
      id,
      packVersion: 1,
      source: { url: sourceUrl },
      sets: [{ artist, imageUrl: storedImage }],
    },
  };
}

function reviewedImage(
  festivalId: string,
  id = imageId,
  artistName = '가수 A',
): PublicImageRow {
  return {
    id,
    seed: 'commons-approved-profile',
    artistName,
    reviewFestivalId: festivalId,
    festivalSourceUrl: sourceUrl,
    author: '사진가',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Artist.jpg',
    rightsRunId: 'rights-run',
  };
}

function publishedOnlyService(
  published: ReturnType<typeof publishedFestival>[],
  visibleImages: PublicImageRow[],
) {
  const query = jest.fn().mockImplementation((sql: string) => {
    if (sql.includes('FROM admin_festivals')) return Promise.resolve(published);
    if (sql.includes('FROM crawl_images image'))
      return Promise.resolve(visibleImages);
    return Promise.resolve([]);
  });
  const service = new PublicFestivalService(
    {} as never,
    {} as never,
    publicFestivalTestDataSource(query) as never,
    {} as never,
  );
  jest
    .spyOn(service as never, 'discoveryCatalog')
    .mockResolvedValue([] as never);
  return { service, query };
}

describe('private missing artist image discovery input', () => {
  it('collects missing published timetable and discovered artists once with original source URLs', async () => {
    const published = [
      {
        id: 'fst_published',
        published: {
          source: { url: 'https://festival.example.com/2026' },
          sets: [
            { artist: '가수 A', imageUrl: null },
            {
              artist: '가수 B',
              imageUrl:
                '/api/v1/festivals/images/11111111-1111-4111-8111-111111111111.webp',
            },
          ],
        },
      },
    ];
    const discovered = [
      {
        id: 'fst_discovered',
        sourceUrl: 'https://tickets.example.com/show',
        sourceUrls: [
          'https://tickets.example.com/show',
          'https://world.nol.com/en/ticket/products/123',
        ],
        artists: [
          { name: '가수 C', imageUrl: null },
          { name: '가수 D', imageUrl: 'https://example.com/d.jpg' },
        ],
      },
    ];
    const service = new PublicFestivalService(
      {} as never,
      {} as never,
      {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('FROM admin_festivals'))
            return Promise.resolve(published);
          if (sql.includes('FROM crawl_images image'))
            return Promise.resolve([
              {
                ...reviewedImage(
                  'fst_published',
                  '11111111-1111-4111-8111-111111111111',
                  '가수 B',
                ),
                seed: null,
                artistName: null,
                reviewFestivalId: null,
                festivalSourceUrl: null,
              },
            ]);
          if (sql.includes('FROM crawl_timetable_revisions'))
            return Promise.resolve([
              {
                festivalSourceUrl: 'https://tickets.example.com/show',
                linkedSourceUrl: null,
                sets: [{ artist: '가수 E' }, { artist: '가수 F' }],
              },
            ]);
          if (sql.includes('FROM crawl_lineup_revisions'))
            return Promise.resolve([
              {
                productUrl: 'https://world.nol.com/en/ticket/products/123',
                artists: [{ name: '가수 G' }],
              },
            ]);
          return Promise.resolve([]);
        }),
      } as never,
      {} as never,
    );
    jest
      .spyOn(service as never, 'discoveryCatalog')
      .mockResolvedValue(discovered as never);
    jest
      .spyOn(service as never, 'attachStoredImages')
      .mockResolvedValue(
        new Map([
          [
            '*\u0000https://tickets.example.com/show\u0000가수 F',
            '11111111-1111-4111-8111-111111111111',
          ],
        ]) as never,
      );

    expect(await service.missingArtistImages()).toEqual([
      {
        festivalId: 'fst_discovered',
        festivalSourceUrl: 'https://tickets.example.com/show',
        artistName: '가수 C',
      },
      {
        festivalId: 'fst_discovered',
        festivalSourceUrl: 'https://tickets.example.com/show',
        artistName: '가수 E',
      },
      {
        festivalId: 'fst_discovered',
        festivalSourceUrl: 'https://tickets.example.com/show',
        artistName: '가수 G',
      },
      {
        festivalId: 'fst_published',
        festivalSourceUrl: 'https://festival.example.com/2026',
        artistName: '가수 A',
      },
    ]);
  });

  it('excludes an approved Commons image from a published pack with no stored image ID', async () => {
    const { service, query } = publishedOnlyService(
      [publishedFestival('fst_first', '가수 A')],
      [reviewedImage('fst_first')],
    );

    expect(await service.missingArtistImages()).toEqual([]);
    const imageQueries = (query.mock.calls as [string, unknown[]][]).filter(
      ([sql]) => sql.includes('FROM crawl_images image'),
    );
    expect(imageQueries).toHaveLength(1);
    expect(imageQueries[0][1]).toEqual([['fst_first'], []]);
    expect(imageQueries[0][0]).toContain('artistImageRightsEvidence');
  });

  it('skips the published image query when no published festival exists', async () => {
    const { service, query } = publishedOnlyService([], []);

    expect(await service.missingArtistImages()).toEqual([]);
    expect(
      (query.mock.calls as [string][]).filter(([sql]) =>
        sql.includes('FROM crawl_images image'),
      ),
    ).toHaveLength(0);
  });

  it('excludes malformed stored IDs from a batch while continuing with another festival', async () => {
    const { service, query } = publishedOnlyService(
      [
        publishedFestival('fst_bad', '가수 A', imageUrl('-'.repeat(36))),
        publishedFestival('fst_healthy', '가수 B', imageUrl(imageId)),
      ],
      [],
    );

    expect(await service.missingArtistImages()).toEqual([
      {
        festivalId: 'fst_bad',
        festivalSourceUrl: sourceUrl,
        artistName: '가수 A',
      },
      {
        festivalId: 'fst_healthy',
        festivalSourceUrl: sourceUrl,
        artistName: '가수 B',
      },
    ]);
    const imageQueries = (query.mock.calls as [string, unknown[]][]).filter(
      ([sql]) => sql.includes('FROM crawl_images image'),
    );
    expect(imageQueries).toHaveLength(1);
    expect(imageQueries[0][1]).toEqual([['fst_bad', 'fst_healthy'], [imageId]]);
  });

  it('includes a published artist after its stored image approval is revoked or expires', async () => {
    const { service } = publishedOnlyService(
      [publishedFestival('fst_first', '가수 A', imageUrl(imageId))],
      [],
    );

    expect(await service.missingArtistImages()).toEqual([
      {
        festivalId: 'fst_first',
        festivalSourceUrl: sourceUrl,
        artistName: '가수 A',
      },
    ]);
  });

  it('keeps a valid stored image out of the missing list', async () => {
    const { service } = publishedOnlyService(
      [publishedFestival('fst_first', '가수 A', imageUrl(imageId))],
      [
        {
          ...reviewedImage('fst_first'),
          seed: null,
          artistName: null,
          reviewFestivalId: null,
          festivalSourceUrl: null,
        },
      ],
    );

    expect(await service.missingArtistImages()).toEqual([]);
  });

  it('separates same-name reviews by festival and checks all published packs in one image query', async () => {
    const first = publishedFestival('fst_first', '가수 A');
    const second = publishedFestival('fst_second', '가수 A', imageUrl(imageId));
    const { service, query } = publishedOnlyService(
      [first, second],
      [reviewedImage('fst_first')],
    );

    expect(await service.missingArtistImages()).toEqual([
      {
        festivalId: 'fst_second',
        festivalSourceUrl: sourceUrl,
        artistName: '가수 A',
      },
    ]);
    const imageQueries = (query.mock.calls as [string, unknown[]][]).filter(
      ([sql]) => sql.includes('FROM crawl_images image'),
    );
    expect(imageQueries).toHaveLength(1);
    expect(imageQueries[0][1]).toEqual([
      ['fst_first', 'fst_second'],
      [imageId],
    ]);

    const overlay = service as unknown as {
      overlayPublishedPack: (
        pack: Record<string, unknown>,
        festivalId: string,
        rows: PublicImageRow[],
        currentPack: Record<string, unknown>,
      ) => { document: Record<string, unknown>; etag: string };
    };
    const otherPack = {
      packVersion: 1,
      source: { url: sourceUrl },
      artists: [{ name: '가수 A', imageUrl: imageUrl(imageId) }],
      sets: [{ artist: '가수 A', imageUrl: imageUrl(imageId) }],
    };
    const otherResult = overlay.overlayPublishedPack(
      otherPack,
      'fst_second',
      [reviewedImage('fst_first')],
      otherPack,
    );
    expect(otherResult.document.artists).toEqual([
      { name: '가수 A', imageUrl: null },
    ]);
    expect(otherResult.etag).toBe(publicPackEtag(1));
  });

  it('rejects a review whose official source or current artist does not match', async () => {
    const { service } = publishedOnlyService(
      [
        publishedFestival('fst_first', '가수 A'),
        publishedFestival('fst_second', '가수 B'),
      ],
      [
        {
          ...reviewedImage('fst_first'),
          festivalSourceUrl: 'https://other.example.com',
        },
        reviewedImage('fst_second', anotherImageId, '가수 A'),
      ],
    );

    expect(await service.missingArtistImages()).toEqual([
      {
        festivalId: 'fst_first',
        festivalSourceUrl: sourceUrl,
        artistName: '가수 A',
      },
      {
        festivalId: 'fst_second',
        festivalSourceUrl: sourceUrl,
        artistName: '가수 B',
      },
    ]);
  });
});
