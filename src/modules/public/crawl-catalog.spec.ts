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
});
