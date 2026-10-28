import { discoverySummaries, ticketDateRange } from './crawl-catalog';

describe('ticket discovery catalog', () => {
  it('keeps official Melon venue coordinates with source evidence', () => {
    const candidate = {
      name: 'WONDERLIVET 2026',
      venue: 'KINTEX HALL 7/8/9/10',
      date: '2026.11.20 - 2026.11.21',
      url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
      locationEvidence: {
        point: {
          latitude: 37.66469544695199,
          longitude: 126.742064181796,
          label: 'KINTEX HALL 7/8/9/10',
          internalSecret: 'hidden',
        },
        sourceUrl:
          'https://ticket.melon.com/performance/index.htm?prodId=213793',
        verifiedAt: '2026-10-28T11:00:00Z',
      },
    };
    expect(discoverySummaries([{ candidate }])[0].location).toEqual({
      latitude: 37.66469544695199,
      longitude: 126.742064181796,
      label: 'KINTEX HALL 7/8/9/10',
      source: {
        name: '멜론티켓',
        url: candidate.url,
        verifiedAt: '2026-10-28T11:00:00Z',
      },
    });
    expect(
      discoverySummaries([
        {
          candidate: {
            ...candidate,
            locationEvidence: {
              ...candidate.locationEvidence,
              sourceUrl: 'https://evil.example/',
            },
          },
        },
      ])[0].location,
    ).toBeUndefined();
    expect(
      discoverySummaries([
        {
          candidate: {
            ...candidate,
            venue: '다른 공연장',
          },
        },
      ])[0].location,
    ).toBeUndefined();
  });

  it('accepts a bounded multi-week NOL World festival without widening other tickets', () => {
    const candidate = {
      name: 'Hampyeong Grand Chrysanthemum Festival 2026',
      venue: 'Hampyeong Expo Park',
      date: '2026.10.23 ~ 2026.11.08',
      url: 'https://world.nol.com/en/ticket/products/26013613',
    };
    expect(discoverySummaries([{ candidate }])).toHaveLength(1);
    expect(
      discoverySummaries([
        {
          candidate: {
            ...candidate,
            url: 'https://nol.yanolja.com/ticket/products/26013613',
          },
        },
      ]),
    ).toHaveLength(0);
    expect(
      discoverySummaries([
        { candidate: { ...candidate, date: '2026.10.23 ~ 2026.12.01' } },
      ]),
    ).toHaveLength(0);
  });

  it('publishes only the matching official NOL World product poster', () => {
    const candidate = {
      name: 'STILL ROLLING FEST 2026',
      venue: 'ROLLING HALL',
      date: '2026.11.21',
      url: 'https://world.nol.com/en/ticket/products/26015253',
    };
    const matched = discoverySummaries([
      {
        candidate: {
          ...candidate,
          posterUrl:
            'https://ticketimage.interpark.com/Play/image/large/26/26015253_p.gif',
        },
      },
    ])[0];
    expect(matched.posterUrl).toBe(
      'https://ticketimage.interpark.com/Play/image/large/26/26015253_p.gif',
    );
    expect(matched.ticketLinks).toEqual([
      {
        label: 'NOL World',
        url: candidate.url,
      },
    ]);
    const mismatched = discoverySummaries([
      {
        candidate: {
          ...candidate,
          posterUrl:
            'https://ticketimage.interpark.com/Play/image/large/26/26015254_p.gif',
        },
      },
    ])[0];
    expect(mismatched.posterUrl).toBeUndefined();
  });

  it('retains official CDF performer profiles without treating them as image URLs', () => {
    const base = {
      name: 'COUNTDOWN FANTASY 2026-2027',
      venue: '킨텍스',
      date: '2026.12.31 - 2026.12.31',
    };
    const entries = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://ticket.yes24.com/Perf/60590',
          artists: [
            {
              name: '혁오',
              sourceUrl: 'https://tkfile.yes24.com/artists/hyukoh.jpg',
            },
          ],
        },
      },
      {
        candidate: {
          ...base,
          url: 'https://mintpaper.co.kr/festivals/178',
          officialProfileArtists: [
            {
              name: '혁오',
              profileUrl: 'https://www.instagram.com/hyukohofficial/',
            },
            {
              name: '실리카겔',
              profileUrl: 'https://www.instagram.com/silicagel.official/',
            },
          ],
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].artists).toEqual([
      {
        name: '혁오',
        sourceUrl: 'https://tkfile.yes24.com/artists/hyukoh.jpg',
        profileUrl: 'https://www.instagram.com/hyukohofficial/',
      },
    ]);
    const untrusted = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://ticket.yes24.com/Perf/60590',
          artists: [
            {
              name: '혁오',
              profileUrl: 'https://www.instagram.com/hyukohofficial/',
            },
          ],
        },
      },
    ]);
    expect(untrusted[0].artists?.[0]).toEqual({ name: '혁오' });
  });

  it('keeps the catalog available when an artist proposal has an invalid source URL', () => {
    const entries = discoverySummaries([
      {
        candidate: {
          name: 'Broken source festival',
          venue: '킨텍스',
          date: '2026.12.31',
          url: 'https://ticket.yes24.com/Perf/60590',
          artistSourceUrl: 'not a url',
          artists: [{ name: '혁오' }],
        },
      },
      {
        candidate: {
          name: 'Valid festival',
          venue: '킨텍스',
          date: '2026.12.30',
          url: 'https://ticket.yes24.com/Perf/60591',
        },
      },
    ]);
    expect(entries.map((entry) => entry.name)).toEqual([
      'Broken source festival',
      'Valid festival',
    ]);
    expect(entries[0].artists).toBeUndefined();
  });

  it('accepts the official post apex URL with query parameters', () => {
    const entries = discoverySummaries([
      {
        candidate: {
          name: 'COUNTDOWN FANTASY 2026-2027',
          venue: '킨텍스',
          date: '2026.12.31',
          url: 'https://mintpaper.co.kr/festivals/178',
          artistSourceUrl: 'https://mintpaper.co.kr/posts/4819?source=official',
          artists: [
            {
              name: '혁오',
              profileUrl: 'https://www.instagram.com/hyukohofficial/',
            },
          ],
        },
      },
    ]);
    expect(entries[0].artists?.[0].profileUrl).toBe(
      'https://www.instagram.com/hyukohofficial/',
    );
  });

  it('adds official profiles only to matching current performers', () => {
    const entries = discoverySummaries([
      {
        candidate: {
          name: 'COUNTDOWN FANTASY 2026-2027',
          venue: '킨텍스',
          date: '2026.12.31',
          url: 'https://ticket.yes24.com/Perf/60590',
          artists: [{ name: 'ONEWE' }, { name: '혁오' }],
          officialProfileArtists: [
            {
              name: 'ONEWE(원위)',
              profileUrl: 'https://www.instagram.com/official_onewe/',
            },
            {
              name: '취소된 출연진',
              profileUrl: 'https://www.instagram.com/cancelled_band/',
            },
          ],
        },
      },
    ]);
    expect(entries[0].artists).toEqual([
      {
        name: 'ONEWE',
        profileUrl: 'https://www.instagram.com/official_onewe/',
      },
      { name: '혁오' },
    ]);
  });

  it('does not restore dropped performers when the official catalog row comes first', () => {
    const base = {
      name: 'COUNTDOWN FANTASY 2026-2027',
      venue: '킨텍스',
      date: '2026.12.31',
    };
    const entries = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://mintpaper.co.kr/festivals/178',
          officialProfileArtists: [
            {
              name: 'ONEWE(원위)',
              profileUrl: 'https://www.instagram.com/official_onewe/',
            },
            {
              name: '취소된 출연진',
              profileUrl: 'https://www.instagram.com/cancelled_band/',
            },
          ],
        },
      },
      {
        candidate: {
          ...base,
          url: 'https://ticket.yes24.com/Perf/60590',
          artists: [{ name: 'ONEWE' }],
        },
      },
    ]);
    expect(entries[0].artists).toEqual([
      {
        name: 'ONEWE',
        profileUrl: 'https://www.instagram.com/official_onewe/',
      },
    ]);
    const officialOnly = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://mintpaper.co.kr/festivals/178',
          officialProfileArtists: [
            {
              name: 'ONEWE(원위)',
              profileUrl: 'https://www.instagram.com/official_onewe/',
            },
          ],
        },
      },
    ]);
    expect(officialOnly[0].artists).toEqual([
      {
        name: 'ONEWE(원위)',
        profileUrl: 'https://www.instagram.com/official_onewe/',
      },
    ]);
  });

  it('leaves a profile unset when two official names claim one performer', () => {
    const entries = discoverySummaries([
      {
        candidate: {
          name: 'COUNTDOWN FANTASY 2026-2027',
          venue: '킨텍스',
          date: '2026.12.31',
          url: 'https://ticket.yes24.com/Perf/60590',
          artists: [{ name: 'ONEWE' }],
          officialProfileArtists: [
            {
              name: 'ONEWE',
              profileUrl: 'https://www.instagram.com/first_onewe/',
            },
            {
              name: 'ONEWE(원위)',
              profileUrl: 'https://www.instagram.com/second_onewe/',
            },
          ],
        },
      },
    ]);
    expect(entries[0].artists).toEqual([{ name: 'ONEWE' }]);
  });

  it('keeps every linked source for enrichment after the public link cap', () => {
    const urls = Array.from(
      { length: 6 },
      (_, index) => `https://ticket.yes24.com/Perf/${60000 + index}`,
    );
    const entries = discoverySummaries(
      urls.map((url) => ({
        candidate: {
          name: 'Linked Festival',
          venue: 'KINTEX',
          date: '2026.11.20 - 2026.11.21',
          url,
        },
      })),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].ticketLinks).toHaveLength(5);
    expect(entries[0].sourceUrls).toEqual(urls);
  });

  it('parses Korean and English ticket dates without inventing event times', () => {
    expect(ticketDateRange('2026.12.25 - 2026.12.26')).toEqual({
      firstDate: '2026-12-25',
      lastDate: '2026-12-26',
    });
    expect(ticketDateRange('2026.12.25 ~ 12.27')).toEqual({
      firstDate: '2026-12-25',
      lastDate: '2026-12-27',
    });
    expect(ticketDateRange('2026.12.31 ~ 01.01')).toEqual({
      firstDate: '2026-12-31',
      lastDate: '2027-01-01',
    });
    expect(ticketDateRange('Dec 31, 2026')).toEqual({
      firstDate: '2026-12-31',
      lastDate: '2026-12-31',
    });
    expect(ticketDateRange('Jul 09-14, 2028')).toEqual({
      firstDate: '2028-07-09',
      lastDate: '2028-07-14',
    });
    expect(ticketDateRange('2026.02.30')).toBeNull();
    expect(ticketDateRange('2026.12.26 ~ 12.25')).toBeNull();
  });

  it('merges ticket sale tiers and rejects untrusted or incomplete candidates', () => {
    const base = {
      date: '2026.12.26 - 2026.12.27',
      venue: '일산 킨텍스',
    };
    const entries = discoverySummaries([
      {
        candidate: {
          ...base,
          name: '원웨이 페스티벌 2026 - 얼리버드',
          url: 'https://ticket.melon.com/performance/index.htm?prodId=214100',
        },
      },
      {
        candidate: {
          ...base,
          name: '원웨이 페스티벌 2026 - 슈퍼얼리버드',
          url: 'https://ticket.melon.com/performance/index.htm?prodId=213769',
        },
      },
      {
        candidate: {
          ...base,
          name: '가짜 축제',
          url: 'https://evil.example/ticket',
        },
      },
      {
        candidate: {
          ...base,
          name: '날짜 없음',
          date: null,
          url: 'https://ticket.melon.com/performance/index.htm?prodId=1',
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: '원웨이 페스티벌 2026',
      firstDate: '2026-12-26',
      lastDate: '2026-12-27',
      packVersion: 0,
      status: 'discovered',
      ticketLinks: [
        {
          label: '멜론티켓',
          url: 'https://ticket.melon.com/performance/index.htm?prodId=214100',
        },
        {
          label: '멜론티켓',
          url: 'https://ticket.melon.com/performance/index.htm?prodId=213769',
        },
      ],
    });
    expect(entries[0]).not.toHaveProperty('startsAt');
  });

  it('includes discoveries whose ticket date omits the end year', () => {
    const entries = discoverySummaries([
      {
        candidate: {
          name: '연말 페스티벌',
          venue: '광장',
          date: '2026.12.31 ~ 01.01',
          url: 'https://ticket.yes24.com/Perf/12345',
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      firstDate: '2026-12-31',
      lastDate: '2027-01-01',
    });
  });

  it('uses only the newest proposal for a URL and removes all tiers after publication', () => {
    const date = '2026.12.26 - 2026.12.27';
    const firstUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=214100';
    const secondUrl =
      'https://ticket.melon.com/performance/index.htm?prodId=213769';
    const rows = [
      {
        candidate: {
          name: '원웨이 페스티벌 2026 - 얼리버드',
          venue: '킨텍스',
          date,
          url: firstUrl,
        },
      },
      {
        candidate: {
          name: '원웨이 페스티벌 2026 - 얼리버드',
          venue: '옛 장소',
          date,
          url: firstUrl,
        },
      },
      {
        candidate: {
          name: '원웨이 페스티벌 2026 - 슈퍼얼리버드',
          venue: '킨텍스',
          date,
          url: secondUrl,
        },
      },
    ];
    expect(discoverySummaries(rows)).toHaveLength(1);
    expect(
      discoverySummaries(rows, [
        {
          name: '원웨이 페스티벌 2026',
          venue: '킨텍스',
          firstDate: '2026-12-26',
          lastDate: '2026-12-27',
          sourceUrl: firstUrl,
        },
      ]),
    ).toEqual([]);
  });

  it('merges verified detail artists and a YES24 poster into one festival', () => {
    const base = {
      name: 'WONDERLIVET 2026',
      venue: 'KINTEX',
      date: '2026.11.20 - 2026.11.22',
    };
    const entries = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://ticket.yes24.com/Perf/59840',
          posterUrl: 'https://tkfile.yes24.com/upload2/PerfBlog/poster.jpg',
        },
      },
      {
        candidate: {
          ...base,
          url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
          artists: [
            { name: 'Band', sourceUrl: 'https://cdnimg.melon.co.kr/band.jpg' },
            { name: 'Bad', sourceUrl: 'https://evil.example/bad.jpg' },
          ],
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].posterUrl).toBe(
      'https://tkfile.yes24.com/upload2/PerfBlog/poster.jpg',
    );
    expect(entries[0].artists).toEqual([
      { name: 'Band', sourceUrl: 'https://cdnimg.melon.co.kr/band.jpg' },
      { name: 'Bad' },
    ]);
    expect(entries[0].ticketLinks).toEqual([
      { label: '예스24', url: 'https://ticket.yes24.com/Perf/59840' },
      {
        label: '멜론티켓',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
      },
    ]);
  });

  it('keeps source-paired artist images only from the corresponding ticket host', () => {
    const base = {
      name: 'FESTIVAL 2026',
      venue: '킨텍스',
      date: '2026.11.07 - 2026.11.08',
    };
    const yes24 = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://ticket.yes24.com/Perf/60590',
          artists: [
            { name: 'A', sourceUrl: 'https://tkfile.yes24.com/artists/a.jpg' },
            {
              name: 'B',
              sourceUrl: 'https://ticketimage.interpark.com/artists/b.jpg',
            },
          ],
        },
      },
    ])[0];
    const nol = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://nol.yanolja.com/ticket/products/26013406',
          artists: [
            {
              name: 'C',
              sourceUrl: 'https://ticketimage.interpark.com/artists/c.jpg',
            },
            { name: 'D', sourceUrl: 'https://tkfile.yes24.com/artists/d.jpg' },
          ],
        },
      },
    ])[0];
    expect(yes24.artists).toEqual([
      { name: 'A', sourceUrl: 'https://tkfile.yes24.com/artists/a.jpg' },
      { name: 'B' },
    ]);
    expect(nol.artists).toEqual([
      {
        name: 'C',
        sourceUrl: 'https://ticketimage.interpark.com/artists/c.jpg',
      },
      { name: 'D' },
    ]);
  });

  it('adds a paired image to an artist already named by another source for the same event', () => {
    const base = {
      name: 'FESTIVAL 2026',
      venue: '킨텍스',
      date: '2026.11.07 - 2026.11.08',
    };
    const entries = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://ticket.yes24.com/Perf/60590',
          artists: [{ name: 'Band A' }],
        },
      },
      {
        candidate: {
          ...base,
          url: 'https://nol.yanolja.com/ticket/products/26013406',
          artists: [
            {
              name: 'Band A',
              sourceUrl: 'https://ticketimage.interpark.com/artists/a.jpg',
            },
          ],
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].artists).toEqual([
      {
        name: 'Band A',
        sourceUrl: 'https://ticketimage.interpark.com/artists/a.jpg',
      },
    ]);
  });

  it('keeps the artist cap while enriching an existing artist after an extra name', () => {
    const base = {
      name: 'FESTIVAL 2026',
      venue: '킨텍스',
      date: '2026.11.07 - 2026.11.08',
    };
    const entries = discoverySummaries([
      {
        candidate: {
          ...base,
          url: 'https://ticket.yes24.com/Perf/60590',
          artists: Array.from({ length: 80 }, (_, index) => ({
            name: `Band ${index}`,
          })),
        },
      },
      {
        candidate: {
          ...base,
          url: 'https://nol.yanolja.com/ticket/products/26013406',
          artists: [
            { name: 'Extra' },
            {
              name: 'Band 79',
              sourceUrl: 'https://ticketimage.interpark.com/artists/79.jpg',
            },
          ],
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].artists).toHaveLength(80);
    expect(entries[0].artists).not.toContainEqual({ name: 'Extra' });
    expect(entries[0].artists).toContainEqual({
      name: 'Band 79',
      sourceUrl: 'https://ticketimage.interpark.com/artists/79.jpg',
    });
  });

  it('keeps a verified NOL product poster and rejects unrelated images', () => {
    const candidate = {
      name: 'NOL FESTIVAL 2026',
      venue: '킨텍스',
      date: '2026.11.07 - 2026.11.08',
      url: 'https://nol.yanolja.com/ticket/products/26013406',
    };
    const poster =
      'https://ticketimage.interpark.com/Play/image/large/26/26013406_p.gif';
    expect(
      discoverySummaries([
        { candidate: { ...candidate, posterUrl: poster } },
      ])[0],
    ).toMatchObject({ posterUrl: poster });
    for (const untrusted of [
      'https://evil.example/Play/image/large/26/26013406_p.gif',
      'https://ticketimage.interpark.com/Play/image/large/26/other.gif',
      'https://ticketimage.interpark.com/Play/image/large/26/99999999_p.gif',
      'http://ticketimage.interpark.com/Play/image/large/26/26013406_p.gif',
    ]) {
      expect(
        discoverySummaries([
          { candidate: { ...candidate, posterUrl: untrusted } },
        ])[0],
      ).not.toHaveProperty('posterUrl');
    }
  });

  it('returns official festival sources and verified Instagram account links', () => {
    const base = {
      name: 'GRAND MINT FESTIVAL 2026',
      date: '2026.10.17 - 2026.10.18',
      venue: '올림픽공원',
      url: 'https://mintpaper.co.kr/festivals/172/lineup',
    };
    expect(
      discoverySummaries([
        {
          candidate: {
            ...base,
            officialInstagramUrl:
              'https://www.instagram.com/grandmintfestival/',
          },
        },
      ])[0],
    ).toMatchObject({
      name: base.name,
      officialInstagramUrl: 'https://www.instagram.com/grandmintfestival/',
    });
    expect(
      discoverySummaries([
        {
          candidate: {
            ...base,
            officialInstagramUrl:
              'https://www.instagram.com/grandmintfestival/p/abc',
          },
        },
      ])[0],
    ).not.toHaveProperty('officialInstagramUrl');
    const merged = discoverySummaries([
      { candidate: base },
      {
        candidate: {
          ...base,
          officialInstagramUrl: 'https://www.instagram.com/grandmintfestival/',
          posterUrl:
            'https://mintpaper.s3.ap-northeast-2.amazonaws.com/gmf.jpg',
        },
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].officialInstagramUrl).toBe(
      'https://www.instagram.com/grandmintfestival/',
    );
    expect(merged[0].ticketLinks).toEqual([
      { label: '공식 사이트', url: base.url },
      {
        label: '공식 인스타그램',
        url: 'https://www.instagram.com/grandmintfestival/',
      },
    ]);
    expect(merged[0].posterUrl).toBe(
      'https://mintpaper.s3.ap-northeast-2.amazonaws.com/gmf.jpg',
    );
    const wonderlivet = discoverySummaries([
      {
        candidate: {
          name: 'WONDERLIVET 2026 (원더리벳 2026)',
          date: '2026.11.20 - 2026.11.22',
          venue: 'KINTEX HALL 7/8/9/10',
          url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
          posterUrl:
            'https://cdnticket.melon.co.kr/resource/image/upload/product/2026/poster.png',
        },
      },
    ]);
    expect(wonderlivet[0].posterUrl).toBe(
      'https://cdnticket.melon.co.kr/resource/image/upload/product/2026/poster.png',
    );
    expect(
      discoverySummaries([
        {
          candidate: {
            ...base,
            posterUrl:
              'https://cdnticket.melon.co.kr/resource/image/web/common/logo.png',
          },
        },
      ])[0],
    ).not.toHaveProperty('posterUrl');
    expect(
      discoverySummaries([
        { candidate: base },
        {
          candidate: {
            ...base,
            officialInstagramUrl:
              'https://www.instagram.com/grandmintfestival/',
          },
          decision: 'rejected',
        },
      ])[0],
    ).not.toHaveProperty('officialInstagramUrl');
  });
});
