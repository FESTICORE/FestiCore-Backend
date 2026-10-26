import { attachPrugioLineup, DiscoverySummary } from './crawl-catalog';
import {
  PRUGIO_FESTIVAL_ID,
  PRUGIO_LINEUP_URL,
} from '../admin/crawl/service/prugio-lineup';

const summary = (): DiscoverySummary => ({
  id: PRUGIO_FESTIVAL_ID,
  name: '제 4회 푸르지오아트홀 뮤직페스티벌',
  venue: '푸르지오 아트홀',
  firstDate: '2026-10-02',
  lastDate: '2026-10-04',
  packVersion: 0,
  flagsEnabled: false,
  thumbUrl: null,
  ticketLinks: [],
  status: 'discovered',
  sourceUrl: 'https://ticket.melon.com/performance/index.htm?prodId=213868',
  sourceUrls: [],
  sortAt: '2026-10-02T00:00:00+09:00',
  artists: [{ name: '김주리', imageUrl: null }],
});

const candidate = {
  festivalId: PRUGIO_FESTIVAL_ID,
  name: '제4회 푸르지오아트홀 뮤직페스티벌',
  venue: '푸르지오아트홀',
  date: '2026.10.02 - 2026.10.04',
  url: PRUGIO_LINEUP_URL,
  artists: [
    { name: '김주리', dates: ['2026-10-02', '2026-10-03'] },
    { name: '서운정', dates: ['2026-10-03', '2026-10-04'] },
  ],
};

describe('attachPrugioLineup', () => {
  it('adds dated names to the matching discovered festival without inventing images', () => {
    const entries = [summary()];
    attachPrugioLineup(entries, candidate);
    expect(entries[0].artists).toEqual([
      { name: '김주리', imageUrl: null, dates: ['2026-10-02', '2026-10-03'] },
      { name: '서운정', dates: ['2026-10-03', '2026-10-04'] },
    ]);
  });

  it('ignores mismatched identity and malformed dates', () => {
    const entries = [summary()];
    attachPrugioLineup(entries, { ...candidate, venue: '다른 공연장' });
    attachPrugioLineup(entries, {
      ...candidate,
      artists: [{ name: '김주리', dates: ['2026-10-05'] }],
    });
    expect(entries[0].artists).toEqual([{ name: '김주리', imageUrl: null }]);
  });
});
