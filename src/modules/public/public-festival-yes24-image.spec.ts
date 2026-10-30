import { publicFestivalTestDataSource } from '../../../test/public-festival-test-data-source';
import { PublicFestivalService } from './public-festival.service';
import { PUBLIC_CRAWL_IMAGE_SQL } from './crawl-image-policy';

function serviceWithQuery(query: jest.Mock) {
  const builder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  return new PublicFestivalService(
    { createQueryBuilder: () => builder } as never,
    {} as never,
    publicFestivalTestDataSource(query) as never,
    {} as never,
  );
}

describe('YES24 English festival poster', () => {
  it('attaches a stored official card poster to an existing discovery', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          candidate: {
            name: 'COUNTDOWN FANTASY 2026-2027',
            url: 'https://ticket.yes24.com/English/Perf/60590',
            date: 'Dec 31, 2026',
            venue: 'KINTEX HALL 7·8',
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          originUrl:
            'https://stkfile.yes24.com/upload2/PerfBlog/202610/20261012/20261012-60590.jpg',
          id: 'poster-60590',
        },
      ]);
    const service = serviceWithQuery(query);
    const result = await service.list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        sourceUrl: 'https://ticket.yes24.com/English/Perf/60590',
        thumbUrl: '/api/v1/festivals/images/poster-60590.webp',
      }),
    ]);
    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe('YES24 domestic festival poster', () => {
  const productUrl = 'https://ticket.yes24.com/Perf/59840';
  const listPoster =
    'https://tkfile.yes24.com/upload2/PerfBlog/202608/20260820/20260820-59840.png/dims/quality/70/';
  const detailPoster =
    'https://tkfile.yes24.com/upload2/PerfBlog/202608/20260820/20260820-59840.png';
  const candidate = {
    name: 'WONDERLIVET 2026',
    url: productUrl,
    date: '2026.11.20 - 2026.11.22',
    venue: 'KINTEX',
    posterUrl: listPoster,
  };

  it('reuses the canonical poster saved under the enabled exact product detail source', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { sourceUrl: productUrl, originUrl: detailPoster, id: 'detail-poster' },
      ]);
    const result = await serviceWithQuery(query).list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        sourceUrl: productUrl,
        thumbUrl: '/api/v1/festivals/images/detail-poster.webp',
      }),
    ]);
    const [sql, params] = query.mock.calls[3] as [string, string[][]];
    expect(params).toEqual([[productUrl]]);
    expect(sql).toContain("source.kind = 'discovery'");
    expect(sql).toContain('source.enabled = true');
    expect(sql).toContain('source.url = ANY($1::text[])');
    expect(sql).toContain('https://tkfile[.]yes24[.]com/upload2/PerfBlog/');
    expect(sql).toContain(
      "substring(source.url from '^https://ticket[.]yes24[.]com/Perf/([0-9]+)$')",
    );
    expect(sql).toContain('[.](jpg|jpeg|png|webp)$');
    expect(sql).toContain(PUBLIC_CRAWL_IMAGE_SQL);
  });

  it('ignores posters for other product IDs and noncanonical or unrelated sources', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          sourceUrl: 'https://ticket.yes24.com/Perf/59841',
          originUrl: detailPoster,
          id: 'other-source',
        },
        {
          sourceUrl: productUrl,
          originUrl:
            'https://tkfile.yes24.com/upload2/PerfBlog/202608/20260820/20260820-59841.png',
          id: 'other-product',
        },
        {
          sourceUrl: productUrl,
          originUrl:
            'https://stkfile.yes24.com/upload2/PerfBlog/202608/20260820/20260820-59840.png',
          id: 'listing-poster',
        },
        {
          sourceUrl: productUrl,
          originUrl: `${detailPoster}/dims/quality/70/`,
          id: 'transformed-poster',
        },
      ]);
    const result = await serviceWithQuery(query).list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items).toEqual([
      expect.objectContaining({ sourceUrl: productUrl, thumbUrl: null }),
    ]);
  });

  it('keeps an exactly matched image without querying the fallback', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ candidate }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ originUrl: listPoster, id: 'exact-poster' }]);
    const result = await serviceWithQuery(query).list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        sourceUrl: productUrl,
        thumbUrl: '/api/v1/festivals/images/exact-poster.webp',
      }),
    ]);
    expect(query).toHaveBeenCalledTimes(3);
  });
});
