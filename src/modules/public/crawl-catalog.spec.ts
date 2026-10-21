import { discoverySummaries, ticketDateRange } from './crawl-catalog';

describe('ticket discovery catalog', () => {
  it('parses Korean and English ticket dates without inventing event times', () => {
    expect(ticketDateRange('2026.12.25 - 2026.12.26')).toEqual({
      firstDate: '2026-12-25',
      lastDate: '2026-12-26',
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
    });
    expect(entries[0]).not.toHaveProperty('startsAt');
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
