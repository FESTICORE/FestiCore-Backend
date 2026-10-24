import { PublicFestivalService } from './public-festival.service';

describe('NOL festival poster', () => {
  it('keeps the official Mint Paper catalog fields ahead of linked NOL details', async () => {
    const cover =
      'https://mintpaper.s3.ap-northeast-2.amazonaws.com/cdf-cover.jpg';
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          candidate: {
            name: 'COUNTDOWN FANTASY 2026-2027',
            url: 'https://mintpaper.co.kr/festivals/178',
            date: '2026.12.31 - 2027.01.01',
            venue: 'KINTEX',
            posterUrl: cover,
            artists: [{ name: '극동아시아타이거즈' }],
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ originUrl: cover, id: 'official-cover' }])
      .mockResolvedValueOnce([]);
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
        sourceUrl: 'https://mintpaper.co.kr/festivals/178',
        thumbUrl: '/api/v1/festivals/images/official-cover.webp',
      }),
    ]);
    const sql = (query.mock.calls as unknown as [string][])[0][0];
    expect(
      sql.match(/"sourceSeed" IS DISTINCT FROM 'official-ticket-link-detail'/g),
    ).toHaveLength(3);
  });

  it('attaches a stored NOL poster through the public image policy', async () => {
    const poster =
      'https://ticketimage.interpark.com/Play/image/large/26/26013406_p.gif';
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          candidate: {
            name: 'NOL FESTIVAL 2026',
            url: 'https://nol.yanolja.com/ticket/products/26013406',
            date: '2026.11.07 - 2026.11.08',
            venue: '킨텍스',
            posterUrl: poster,
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ originUrl: poster, id: 'poster-26013406' }]);
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
        sourceUrl: 'https://nol.yanolja.com/ticket/products/26013406',
        thumbUrl: '/api/v1/festivals/images/poster-26013406.webp',
      }),
    ]);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining(
        "source.url ~ '^https://nol[.]yanolja[.]com/ticket/products/[0-9]+$'",
      ),
      [[poster]],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(
        'image."originUrl" ~* \'^https://ticketimage[.]interpark[.]com/Play/image/large/[0-9]+/[0-9]+_p[.](gif|jpe?g|png|webp)$\'',
      ),
      [[poster]],
    );
  });
});
