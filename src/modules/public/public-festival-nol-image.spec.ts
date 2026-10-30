import { publicFestivalTestDataSource } from '../../../test/public-festival-test-data-source';
import { PublicFestivalService } from './public-festival.service';

describe('NOL festival poster', () => {
  it('joins only the official YES24 product and its matching English detail to CDF', async () => {
    const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
    const yes24 = 'https://ticket.yes24.com/Perf/60590';
    const english = 'https://ticket.yes24.com/English/Perf/60590';
    const candidate = (url: string, venue: string, date: string) => ({
      candidate: {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url,
        venue,
        date,
        artists: [{ name: 'Band A' }],
      },
    });
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates'))
        return [
          candidate(festivalUrl, 'KINTEX', '2026.12.31 - 2027.01.01'),
          candidate(yes24, '킨텍스 제2전시장', '2026.12.31'),
          candidate(english, 'KINTEX HALL 7·8', '2026.12.31'),
        ];
      if (sql.includes('SELECT child.url'))
        return [{ url: yes24, verifiedTicketUrls: JSON.stringify([yes24]) }];
      if (sql.includes('SELECT DISTINCT ON (source."parserConfig"'))
        return [
          {
            festivalSourceUrl: festivalUrl,
            artistName: 'Band A',
            artistAlias: null,
            artistOfficialName: null,
            seed: 'cdf-official-profile',
            id: '11111111-1111-4111-8111-111111111111',
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
      publicFestivalTestDataSource(query) as never,
      {} as never,
    );
    const result = await service.list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items).toHaveLength(3);
    expect(
      result.items.find((item) => item.sourceUrl === festivalUrl)?.ticketLinks,
    ).toEqual([
      { label: '공식 사이트', url: festivalUrl },
      { label: '예스24', url: yes24 },
    ]);
    for (const url of [yes24, english]) {
      const detail = result.items.find((item) => item.sourceUrl === url);
      expect(detail).toBeDefined();
      const fetched = await service.discovered(detail!.id);
      expect(fetched?.id).toBe(detail!.id);
      expect(fetched?.artists?.[0].imageUrl).toBe(
        '/api/v1/festivals/images/11111111-1111-4111-8111-111111111111.webp',
      );
    }
    const imageQuery = (query.mock.calls as [string, [string[]]][]).find(
      ([sql]) => sql.includes('SELECT DISTINCT ON (source."parserConfig"'),
    );
    expect(imageQuery?.[1][0]).toEqual([festivalUrl, yes24, english]);
  });

  it('shows a verified official YES24 ticket link before its detail crawl succeeds', async () => {
    const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
    const yes24 = 'https://ticket.yes24.com/Perf/60590';
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates'))
        return [
          {
            candidate: {
              name: 'COUNTDOWN FANTASY 2026-2027',
              url: festivalUrl,
              venue: 'KINTEX',
              date: '2026.12.31 - 2027.01.01',
            },
          },
        ];
      if (sql.includes('SELECT child.url'))
        return [{ url: yes24, verifiedTicketUrls: JSON.stringify([yes24]) }];
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
      publicFestivalTestDataSource(query) as never,
      {} as never,
    );
    const result = await service.list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items[0].ticketLinks).toEqual([
      { label: '공식 사이트', url: festivalUrl },
      { label: '예스24', url: yes24 },
    ]);
  });

  it.each([
    {
      order: 'official first',
      urls: ['official', 'verified', 'unverified'],
      primary: 'official',
    },
    {
      order: 'YES24 first',
      urls: ['verified', 'official', 'unverified'],
      primary: 'verified',
    },
    {
      order: 'unverified first',
      urls: ['unverified', 'official', 'verified'],
      primary: 'official',
    },
  ])(
    'keeps one verified YES24 link when discovery already merged both sources: %s',
    async ({ urls, primary }) => {
      const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
      const yes24 = 'https://ticket.yes24.com/Perf/60590';
      const unverified = 'https://ticket.yes24.com/Perf/60591';
      const sources = { official: festivalUrl, verified: yes24, unverified };
      const candidates = urls.map((source) => ({
        candidate: {
          name: 'COUNTDOWN FANTASY 2026-2027',
          url: sources[source as keyof typeof sources],
          venue: 'KINTEX',
          date: '2026.12.31',
          artists: [{ name: 'Band A' }],
        },
      }));
      const query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('WITH candidates')) return candidates;
        if (sql.includes('SELECT child.url'))
          return [{ url: yes24, verifiedTicketUrls: JSON.stringify([yes24]) }];
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
        publicFestivalTestDataSource(query) as never,
        {} as never,
      );
      const result = await service.list(
        undefined,
        '50',
        new Date('2026-10-22T00:00:00Z'),
      );
      expect(result.items).toHaveLength(1);
      const detail = await service.discovered(result.items[0].id);
      expect(detail?.sourceUrl).toBe(
        primary === 'official' ? festivalUrl : yes24,
      );
      expect(detail?.ticketLinks.map((link) => link.url).sort()).toEqual(
        [festivalUrl, yes24].sort(),
      );
      expect(new Set(detail?.ticketLinks.map((link) => link.url)).size).toBe(2);
    },
  );

  it('does not join a different YES24 product or a mismatched event', async () => {
    const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
    const yes24 = 'https://ticket.yes24.com/Perf/60590';
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates'))
        return [
          {
            candidate: {
              name: 'COUNTDOWN FANTASY 2026-2027',
              url: festivalUrl,
              venue: 'KINTEX',
              date: '2026.12.31 - 2027.01.01',
            },
          },
          {
            candidate: {
              name: 'COUNTDOWN FANTASY 2026-2027',
              url: 'https://ticket.yes24.com/Perf/60591',
              venue: 'Other hall',
              date: '2026.12.31',
            },
          },
          {
            candidate: {
              name: 'COUNTDOWN FANTASY 2026-2027',
              url: yes24,
              venue: 'Other hall',
              date: '2026.12.30',
            },
          },
          {
            candidate: {
              name: 'OTHER FESTIVAL',
              url: 'https://ticket.yes24.com/English/Perf/60590',
              venue: 'Other hall',
              date: '2026.12.31',
            },
          },
        ];
      if (sql.includes('SELECT child.url'))
        return [{ url: yes24, verifiedTicketUrls: JSON.stringify([yes24]) }];
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
      publicFestivalTestDataSource(query) as never,
      {} as never,
    );
    const result = await service.list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items).toHaveLength(4);
    expect(
      result.items.find((item) => item.sourceUrl === festivalUrl)?.ticketLinks,
    ).toEqual([
      { label: '공식 사이트', url: festivalUrl },
      { label: '예스24', url: yes24 },
    ]);
  });

  it('does not grant official images to a catalog row containing another YES24 product', async () => {
    const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
    const yes24 = 'https://ticket.yes24.com/Perf/60590';
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates'))
        return [
          {
            candidate: {
              name: 'COUNTDOWN FANTASY 2026-2027',
              url: festivalUrl,
              venue: 'KINTEX',
              date: '2026.12.31 - 2027.01.01',
            },
          },
          ...[yes24, 'https://ticket.yes24.com/Perf/60591'].map((url) => ({
            candidate: {
              name: 'COUNTDOWN FANTASY 2026-2027',
              url,
              venue: 'OTHER HALL',
              date: '2026.12.31',
              artists: [{ name: 'Band A' }],
            },
          })),
        ];
      if (sql.includes('SELECT child.url'))
        return [{ url: yes24, verifiedTicketUrls: JSON.stringify([yes24]) }];
      if (sql.includes('SELECT DISTINCT ON (source."parserConfig"'))
        return [
          {
            festivalSourceUrl: festivalUrl,
            artistName: 'Band A',
            artistAlias: null,
            artistOfficialName: null,
            seed: 'cdf-official-profile',
            id: '11111111-1111-4111-8111-111111111111',
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
      publicFestivalTestDataSource(query) as never,
      {} as never,
    );
    const result = await service.list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    const yes24Id = result.items.find((item) => item.sourceUrl === yes24)?.id;
    expect(yes24Id).toBeDefined();
    expect(
      (await service.discovered(yes24Id!))?.artists?.[0].imageUrl,
    ).toBeNull();
  });

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
      publicFestivalTestDataSource(query) as never,
      {} as never,
    );
    const result = await service.list(
      undefined,
      '50',
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].ticketLinks).toEqual([
      { label: '공식 사이트', url: festivalUrl },
      { label: 'NOL', url: nolUrl },
      {
        label: '멜론티켓',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=123',
      },
      {
        label: '공식 인스타그램',
        url: 'https://www.instagram.com/countdown_fantasy/',
      },
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
    const stalePlace = 'https://nol.yanolja.com/ticket/places/111';
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
        return [
          candidate(stale),
          candidate(stalePlace),
          candidate(festivalUrl),
          candidate(valid),
        ];
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
      publicFestivalTestDataSource(query) as never,
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
    expect(profileQueries[0][1][0]).not.toContain(stalePlace);
    expect(profileQueries[1][1][0]).not.toContain(stalePlace);
  });

  it('checks the official notice when Mint Paper is beyond the visible link cap', async () => {
    const festivalUrl = 'https://mintpaper.co.kr/festivals/178';
    const stale = 'https://nol.yanolja.com/ticket/products/111';
    const urls = [
      ...Array.from(
        { length: 5 },
        (_, index) => `https://ticket.yes24.com/Perf/${60000 + index}`,
      ),
      stale,
      festivalUrl,
    ];
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates'))
        return urls.map((url) => ({
          candidate: {
            name: 'COUNTDOWN FANTASY 2026-2027',
            url,
            date: '2026.12.31 - 2027.01.01',
            venue: 'KINTEX',
            artists: [{ name: 'Band A' }],
          },
        }));
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
      publicFestivalTestDataSource(query) as never,
      {} as never,
    );
    await service.list(undefined, '50', new Date('2026-10-22T00:00:00Z'));
    const profileQuery = (query.mock.calls as [string, [string[]]][]).find(
      ([sql]) => sql.includes('SELECT DISTINCT ON (source."parserConfig"'),
    );
    expect(profileQuery?.[1][0]).toContain(festivalUrl);
    expect(profileQuery?.[1][0]).not.toContain(stale);
    expect(
      query.mock.calls.some(([sql]: [string]) =>
        sql.includes('SELECT child.url'),
      ),
    ).toBe(true);
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
      publicFestivalTestDataSource(query) as never,
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
    expect(sql).toContain('AS "artistDetails"');
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
      publicFestivalTestDataSource(query) as never,
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
        "substring(source.url from '^https://nol[.]yanolja[.]com/ticket/products/([0-9]+)$')",
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
