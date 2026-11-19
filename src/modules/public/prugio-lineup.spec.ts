import { publicFestivalTestDataSource } from '../../../test/public-festival-test-data-source';
import { attachPrugioLineup, DiscoverySummary } from './crawl-catalog';
import {
  PRUGIO_FESTIVAL_ID,
  PRUGIO_LINEUP_URL,
} from '../admin/crawl/service/prugio-lineup';
import { PublicFestivalService } from './public-festival.service';

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

describe('Prugio public detail', () => {
  it('retains official date assignments without creating a timed timetable', async () => {
    const ticket = {
      name: '제 4회 푸르지오아트홀 뮤직페스티벌',
      venue: '푸르지오 아트홀',
      date: '2026.10.02 - 2026.10.04',
      url: 'https://ticket.melon.com/performance/index.htm?prodId=213868',
    };
    const query = jest
      .fn()
      .mockImplementation((sql: string) =>
        sql.includes('WITH candidates AS')
          ? [{ candidate: ticket, prugioCandidate: candidate }]
          : [],
      );
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      publicFestivalTestDataSource(query) as never,
      {} as never,
    );
    const detail = await service.detail(PRUGIO_FESTIVAL_ID);
    expect(detail.artists).toEqual([
      { name: '김주리', imageUrl: null, dates: ['2026-10-02', '2026-10-03'] },
      { name: '서운정', imageUrl: null, dates: ['2026-10-03', '2026-10-04'] },
    ]);
    expect(detail.timetable).toEqual([]);
  });

  it('connects the saved official portrait to the matching dated performer', async () => {
    const ticket = {
      name: '제 4회 푸르지오아트홀 뮤직페스티벌',
      venue: '푸르지오 아트홀',
      date: '2026.10.02 - 2026.10.04',
      url: 'https://ticket.melon.com/performance/index.htm?prodId=213868',
    };
    const imageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('WITH candidates AS'))
        return [{ candidate: ticket, prugioCandidate: candidate }];
      if (
        sql.includes(
          'SELECT DISTINCT ON (source."parserConfig"->>\'festivalSourceUrl\'',
        )
      )
        return [
          {
            festivalSourceUrl: PRUGIO_LINEUP_URL,
            artistName: '서운정',
            artistAlias: null,
            artistOfficialName: null,
            seed: 'prugio-official-profile',
            id: imageId,
          },
        ];
      return [];
    });
    const service = new PublicFestivalService(
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      publicFestivalTestDataSource(query) as never,
      {} as never,
    );
    const detail = await service.detail(PRUGIO_FESTIVAL_ID);
    expect(detail.artists).toContainEqual({
      name: '서운정',
      imageUrl: `/api/v1/festivals/images/${imageId}.webp`,
      dates: ['2026-10-03', '2026-10-04'],
    });
    const imageQuery = (query.mock.calls as [string, unknown[]][]).find(
      ([sql]) =>
        sql.includes(
          'SELECT DISTINCT ON (source."parserConfig"->>\'festivalSourceUrl\'',
        ),
    );
    expect(imageQuery?.[1][0]).toContain(PRUGIO_LINEUP_URL);
  });
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
    expect(entries[0].sourceUrls).toContain(PRUGIO_LINEUP_URL);
  });

  it('ignores mismatched identity and malformed dates', () => {
    const entries = [summary()];
    attachPrugioLineup(entries, { ...candidate, venue: '다른 공연장' });
    attachPrugioLineup(entries, {
      ...candidate,
      artists: [{ name: '김주리', dates: ['2026-10-05'] }],
    });
    expect(entries[0].artists).toEqual([{ name: '김주리', imageUrl: null }]);
    expect(entries[0].sourceUrls).not.toContain(PRUGIO_LINEUP_URL);
  });
});
