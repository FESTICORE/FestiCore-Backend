import { PublicFestivalService } from './public-festival.service';

describe('NOL festival poster', () => {
  it('shows only enabled official NOL links verified for the Mint Paper festival', async () => {
    const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
    const nolUrl = 'https://nol.yanolja.com/ticket/products/26014568';
    const candidate = (url: string) => ({
      candidate: {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url,
        date: '2026.12.31 - 2027.01.01',
        venue: 'KINTEX',
        officialInstagramUrl: 'https://www.instagram.com/countdown_fantasy/',
      },
    });
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates'))
        return [
          candidate('https://ticket.yes24.com/Perf/99999'),
          candidate(festivalUrl),
          candidate(
            'https://ticket.melon.com/performance/index.htm?prodId=123',
          ),
          candidate('https://ticket.yes24.com/English/Perf/99999'),
        ];
      if (sql.includes('SELECT child.url'))
        return [
          {
            url: nolUrl,
            verifiedTicketUrls: JSON.stringify([nolUrl]),
          },
          {
            url: 'https://nol.yanolja.com/ticket/products/777',
            verifiedTicketUrls: JSON.stringify([nolUrl]),
          },
        ];
      return [];
    });
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
    expect(result.items).toHaveLength(1);
    expect(result.items[0].ticketLinks).toEqual([
      { label: '예스24', url: 'https://ticket.yes24.com/Perf/99999' },
      { label: 'NOL', url: nolUrl },
      { label: '공식 사이트', url: festivalUrl },
      {
        label: '멜론티켓',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=123',
      },
      { label: '예스24', url: 'https://ticket.yes24.com/English/Perf/99999' },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('parent.enabled = true AND child.enabled = true'),
      ['https://www.mintpaper.co.kr/posts/4821', festivalUrl],
    );
    expect(
      (query.mock.calls as [string][]).find(([sql]) =>
        sql.includes('SELECT child.url'),
      )?.[0],
    ).not.toContain('status');
  });

  it('removes stale proposal NOL links even when a NOL row is the primary source', async () => {
    const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
    const stale = 'https://nol.yanolja.com/ticket/products/111';
    const valid = 'https://nol.yanolja.com/ticket/products/222';
    let verifiedRows = [
      { url: valid, verifiedTicketUrls: JSON.stringify([valid]) },
    ];
    const candidate = (url: string) => ({
      candidate: {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url,
        date: '2026.12.31 - 2027.01.01',
        venue: 'KINTEX',
        artists: [{ name: 'Band A' }],
      },
    });
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates'))
        return [candidate(stale), candidate(festivalUrl), candidate(valid)];
      if (sql.includes('SELECT child.url')) return verifiedRows;
      return [];
    });
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
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        sourceUrl: festivalUrl,
        ticketLinks: [
          { label: '공식 사이트', url: festivalUrl },
          { label: 'NOL', url: valid },
        ],
      }),
    );
    verifiedRows = [];
    const disabled = await service.list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(disabled.items[0].ticketLinks).toEqual([
      { label: '공식 사이트', url: festivalUrl },
    ]);
    const profileQueries = (query.mock.calls as [string, [string[]]][]).filter(
      ([sql]) => sql.includes('SELECT DISTINCT ON (source."parserConfig"'),
    );
    expect(profileQueries).toHaveLength(2);
    expect(profileQueries[0][1][0]).toEqual([festivalUrl, valid]);
    expect(profileQueries[1][1][0]).toEqual([festivalUrl]);
    expect(profileQueries[0][1][0]).not.toContain(stale);
  });

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
