import { DataSource } from 'typeorm';
import { DiscoverySummary } from './crawl-catalog';
import { projectSearchArtists } from './public-artist-search';

function discovery(
  id: string,
  sourceUrl: string,
  artists: DiscoverySummary['artists'] = [],
): DiscoverySummary {
  return {
    id,
    name: id,
    venue: '공연장',
    firstDate: '2026-11-04',
    lastDate: '2026-11-04',
    packVersion: 0,
    flagsEnabled: false,
    thumbUrl: null,
    ticketLinks: [],
    status: 'discovered',
    sourceUrl,
    sourceUrls: [sourceUrl],
    artists,
    sortAt: '2026-11-04T00:00:00Z',
  };
}

describe('public artist search projection', () => {
  it('keeps published artists, dates, and stages without image data', async () => {
    const query = jest.fn();
    const result = await projectSearchArtists(
      { query } as unknown as DataSource,
      ['fst_published'],
      [
        {
          id: 'fst_published',
          published: {
            stages: [{ id: 'stage-1', name: '메인 무대' }],
            sets: [
              {
                artist: '가수 A',
                stageId: 'stage-1',
                startsAt: '2026-11-04T15:00:00+09:00',
                imageUrl: 'private.webp',
              },
              {
                artist: '가수 A',
                stageId: 'stage-1',
                startsAt: '2026-11-05T15:00:00+09:00',
              },
            ],
          },
        },
      ],
      [],
    );
    expect(query).not.toHaveBeenCalled();
    expect(result.get('fst_published')).toEqual([
      {
        name: '가수 A',
        performances: [
          {
            startsAt: '2026-11-04T15:00:00+09:00',
            date: '2026-11-04',
            stageName: '메인 무대',
          },
          {
            startsAt: '2026-11-05T15:00:00+09:00',
            date: '2026-11-05',
            stageName: '메인 무대',
          },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private.webp');
  });

  it('batches reviewed lineups and timetables and assigns each source to its festival', async () => {
    const productA = 'https://world.nol.com/en/ticket/products/101';
    const productB = 'https://world.nol.com/en/ticket/products/202';
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          productUrl: productA,
          artists: [{ name: '공통 가수' }, { name: 'A 가수' }],
        },
        {
          productUrl: productB,
          artists: [{ name: '공통 가수' }, { name: 'B 가수' }],
        },
      ])
      .mockResolvedValueOnce([
        {
          festivalSourceUrl: productA,
          linkedSourceUrl: null,
          sets: [
            {
              artist: 'A 가수',
              startsAt: '2026-11-04T10:00:00+09:00',
              date: '2026-11-04',
              stageName: 'A 무대',
              endsAt: null,
            },
          ],
        },
        {
          festivalSourceUrl: productB,
          linkedSourceUrl: null,
          sets: [
            {
              artist: 'B 가수',
              startsAt: '2026-11-05T10:00:00+09:00',
              date: '2026-11-05',
              stageName: 'B 무대',
              endsAt: null,
            },
          ],
        },
      ]);
    const result = await projectSearchArtists(
      { query } as unknown as DataSource,
      ['fst_a', 'fst_b'],
      [],
      [
        discovery('fst_a', productA, [{ name: 'A 가수' }]),
        discovery('fst_b', productB),
      ],
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [
      [productA, productB],
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [
      [productA, productB],
    ]);
    expect(result.get('fst_a')).toEqual([
      {
        name: 'A 가수',
        performances: [
          {
            startsAt: '2026-11-04T10:00:00+09:00',
            date: '2026-11-04',
            stageName: 'A 무대',
          },
        ],
      },
      { name: '공통 가수', performances: [] },
    ]);
    expect(result.get('fst_b')).toEqual([
      { name: '공통 가수', performances: [] },
      {
        name: 'B 가수',
        performances: [
          {
            startsAt: '2026-11-05T10:00:00+09:00',
            date: '2026-11-05',
            stageName: 'B 무대',
          },
        ],
      },
    ]);
  });

  it('queries no unpaged festivals', async () => {
    const query = jest.fn();
    const result = await projectSearchArtists(
      { query } as unknown as DataSource,
      [],
      [],
      [discovery('fst_omitted', 'https://example.com/festival')],
    );
    expect(query).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});
