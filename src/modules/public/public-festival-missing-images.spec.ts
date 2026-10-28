import { PublicFestivalService } from './public-festival.service';

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
});
