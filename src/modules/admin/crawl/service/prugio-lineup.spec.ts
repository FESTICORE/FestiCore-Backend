import { parsePrugioLineup, PrugioLineup } from './prugio-lineup';
import { parseCrawl } from './crawl-parser';
import { CrawlSource } from '../entity/crawl-source.entity';
import { PRUGIO_LINEUP_SEED, PRUGIO_LINEUP_URL } from './prugio-lineup';

const lineup = [
  '［출연자］',
  '2일 〈교수추천 라이징 스타 콘서트〉',
  'Sop - 김인영, 박주이, 오채원',
  'M.Sop -우혜민',
  'Ten - 장천원',
  'B.Bar - 권혁우',
  'Pf - 김주리',
  '3일 〈그랜드 오페라 갈라 콘서트 1〉',
  'Sop- 소혜정,신난향,서운정,이한나',
  'Ten - 조승연,오상택',
  'Pf - 김주리',
  '4일 〈그랜드 오페라 갈라콘서트 2〉',
  'Sop - 안현선,서운정,이한나',
  'Bar - 전대근',
  'Ten - 송현섭,오상택',
  'Pf - 한민선',
];

function page(lines = lineup, title = '제4회 푸르지오아트홀 뮤직페스티벌') {
  return `<div class="board_detail"><h3 class="board_tit">${title}</h3><dl>
    <dt>기간</dt><dd>2026.10.02.~2026.10.04.</dd>
    <dt>장소</dt><dd>서울 | 푸르지오아트홀</dd></dl></div>
    <div class="view_con"><h3>공연소개</h3>${lines.map((line) => `<p>${line}</p>`).join('')}
    <div class="culture-guide"></div></div>`;
}

describe('parsePrugioLineup', () => {
  it('extracts 21 dated appearances and 17 unique names without images or set times', () => {
    const result = parsePrugioLineup(page());
    expect(result.artists).toHaveLength(17);
    expect(
      result.artists.reduce((count, artist) => count + artist.dates.length, 0),
    ).toBe(21);
    expect(
      result.artists.find((artist) => artist.name === '김주리')?.dates,
    ).toEqual(['2026-10-02', '2026-10-03']);
    expect(
      result.artists.find((artist) => artist.name === '오상택')?.dates,
    ).toEqual(['2026-10-03', '2026-10-04']);
    expect(JSON.stringify(result)).not.toMatch(/imageUrl|startsAt|endsAt/);
  });

  it('rejects a mismatched festival and incomplete day', () => {
    expect(() => parsePrugioLineup(page(lineup, '다른 축제'))).toThrow('신원');
    expect(() => parsePrugioLineup(page(lineup.slice(0, -5)))).toThrow(
      '불완전',
    );
  });

  it('parses changing performer names rather than a fixed list', () => {
    const changed = [...lineup];
    changed[2] = 'Sop - 새가수, 박주이, 오채원';
    expect(parsePrugioLineup(page(changed)).artists[0]).toEqual({
      name: '새가수',
      dates: ['2026-10-02'],
    });
  });
});

describe('Prugio scheduled crawl source', () => {
  it('dispatches the exact MCST discovery source to the dated parser', async () => {
    const source = {
      kind: 'discovery',
      parser: 'ticket-list',
      url: PRUGIO_LINEUP_URL,
      parserConfig: { seed: PRUGIO_LINEUP_SEED },
    } as CrawlSource;
    const parsed = (await parseCrawl(source, page())) as PrugioLineup[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].artists[0]).toEqual({
      name: '김인영',
      dates: ['2026-10-02'],
    });
    await expect(
      parseCrawl({ ...source, url: 'https://example.com' }, page()),
    ).rejects.toThrow('소스 설정');
  });
});
