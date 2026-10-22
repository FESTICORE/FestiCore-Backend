import { PublicFestivalService } from './public-festival.service';

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
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const service = new PublicFestivalService(
      { createQueryBuilder: () => builder } as never,
      {} as never,
      { query } as never,
      {} as never,
    );
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
