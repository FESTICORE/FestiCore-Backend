import { tourApiCandidates, tourApiPage } from './tour-api';

describe('TourAPI festival discovery', () => {
  it('normalizes a singleton page and rejects upstream errors', () => {
    expect(
      tourApiPage(
        JSON.stringify({
          response: {
            header: { resultCode: '0000' },
            body: { totalCount: 1, items: { item: { contentid: '123' } } },
          },
        }),
      ),
    ).toEqual({ items: [{ contentid: '123' }], totalCount: 1 });
    expect(() =>
      tourApiPage(
        JSON.stringify({
          response: {
            header: { resultCode: '22' },
            body: { totalCount: 0, items: '' },
          },
        }),
      ),
    ).toThrow('TourAPI 응답 오류');
  });

  it('keeps valid dated records without retaining images or raw API metadata', () => {
    const rows = [
      {
        contentid: '123',
        title: '가을 축제',
        eventstartdate: '20261021',
        eventenddate: '20261102',
        addr1: '서울특별시 광장',
        firstimage: 'https://unverified.example/poster.jpg',
      },
      {
        contentid: '124',
        title: '잘못된 날짜',
        eventstartdate: '20260230',
        eventenddate: '20260301',
        addr1: '서울',
      },
    ];
    expect(tourApiCandidates(JSON.stringify(rows))).toEqual([
      {
        name: '가을 축제',
        url: 'https://apis.data.go.kr/B551011/KorService2/detailCommon2?contentId=123',
        date: '2026-10-21 ~ 2026-11-02',
        venue: '서울특별시 광장',
      },
    ]);
  });
});
