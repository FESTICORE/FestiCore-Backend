import { CrawlSource } from '../entity/crawl-source.entity';
import { parseCrawl } from './crawl-parser';

function source(
  parser: CrawlSource['parser'],
  kind: CrawlSource['kind'],
  config: Record<string, string> = {},
): CrawlSource {
  return {
    parser,
    kind,
    parserConfig: config,
    url: 'https://festival.example.com/',
  } as CrawlSource;
}

describe('crawl parsers', () => {
  it('reads a configured timetable table into stable set candidates', async () => {
    const html =
      '<table><tr><th>Artist</th><th>Start</th><th>End</th></tr><tr><td>Band</td><td>12:00</td><td>13:00</td></tr></table>';
    const config = { date: '2026-11-20', stageId: 'stg_main' };
    expect(
      await parseCrawl(source('html-table', 'timetable', config), html),
    ).toEqual([
      expect.objectContaining({
        artist: 'Band',
        stageId: 'stg_main',
        startsAt: '2026-11-20T12:00:00+09:00',
        endsAt: '2026-11-20T13:00:00+09:00',
      }),
    ]);
  });

  it('requires the declared date captures and rejects empty text', async () => {
    expect(
      await parseCrawl(
        source('regex-days', 'days', {
          pattern:
            '(?<date>2026-11-20) (?<startsAt>2026-11-20T12:00:00\\+09:00) (?<endsAt>2026-11-20T13:00:00\\+09:00)',
        }),
        '2026-11-20 2026-11-20T12:00:00+09:00 2026-11-20T13:00:00+09:00',
      ),
    ).toEqual({
      date: '2026-11-20',
      startsAt: '2026-11-20T12:00:00+09:00',
      endsAt: '2026-11-20T13:00:00+09:00',
    });
    await expect(
      parseCrawl(source('html-text', 'notice'), '<script>hidden</script>'),
    ).rejects.toThrow('비었습니다');
  });

  it('discovers festival cards with their event date and venue, without navigation links or duplicates', async () => {
    const html = `
      <nav><a href="/ticket">홈</a><a href="/festival">페스티벌</a></nav>
      <ul>
        <li class="ticket-item">
          <a href="/ticket/products/123"><img alt="2026 서울 재즈 페스티벌" src="poster.jpg"></a>
          <span class="date">2026.05.29 ~ 05.31</span>
          <span class="venue">서울 올림픽공원</span>
        </li>
        <li><a href="/ticket/products/123">2026 서울 재즈 페스티벌</a></li>
        <li><a href="https://tickets.example.com/concert">2026 단독 콘서트</a></li>
        <li><a href="https://tickets.example.com/orchestra">페스티벌 오케스트라 내한공연</a></li>
        <li><a href="http://insecure.example.com/festival">2026 부산 록 페스티벌</a></li>
      </ul>`;
    expect(await parseCrawl(source('ticket-list', 'discovery'), html)).toEqual([
      {
        name: '2026 서울 재즈 페스티벌',
        url: 'https://festival.example.com/ticket/products/123',
        date: '2026.05.29 ~ 05.31',
        venue: '서울 올림픽공원',
      },
    ]);
  });

  it('reads serialized product URLs but does not mistake ticket opening time for event date', async () => {
    const html = String.raw`<script>self.__next_f.push([1,"action":{"web":"https://nol.yanolja.com/ticket/products/26015181"},"thumbnail":"poster.jpg","title":"썸띵 뉴 뮤직 페스티벌 2026","dateInfo":"10.23(금) 17:00"}]);</script>`;
    expect(await parseCrawl(source('ticket-list', 'discovery'), html)).toEqual([
      {
        name: '썸띵 뉴 뮤직 페스티벌 2026',
        url: 'https://nol.yanolja.com/ticket/products/26015181',
      },
    ]);
  });

  it('reads verified NOL event dates and venues without treating opening times as event dates', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket';
    const html = String.raw`<script>self.__next_f.push([1,"action":{"web":"https://nol.yanolja.com/ticket/products/26013510"},"title":"ASEAN-Korea Music Festival 2026 ROUND in Korea","dateInfo":"26.11.07 ~ 26.11.08","locationDetails":["인천남동체육관"]},{"action":{"web":"https://nol.yanolja.com/ticket/products/26015181"},"title":"썸띵 뉴 뮤직 페스티벌 2026","dateInfo":"10.23(금) 17:00","locationDetails":[]}]);</script>`;
    expect(await parseCrawl(nol, html)).toEqual([
      {
        name: 'ASEAN-Korea Music Festival 2026 ROUND in Korea',
        url: 'https://nol.yanolja.com/ticket/products/26013510',
        date: '2026.11.07 - 2026.11.08',
        venue: '인천남동체육관',
      },
      {
        name: '썸띵 뉴 뮤직 페스티벌 2026',
        url: 'https://nol.yanolja.com/ticket/products/26015181',
      },
    ]);
  });

  it('omits invalid NOL dates and does not attach another product’s venue', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket';
    const html = String.raw`<script>self.__next_f.push([1,"action":{"web":"https://nol.yanolja.com/ticket/products/1"},"title":"서울 페스티벌","dateInfo":"26.02.30 ~ 26.03.01","locationDetails":[]},{"action":{"web":"https://nol.yanolja.com/ticket/products/2"},"title":"부산 페스티벌","dateInfo":"26.13.01","locationDetails":["부산 공연장"]}]);</script>`;
    expect(await parseCrawl(nol, html)).toEqual([
      {
        name: '서울 페스티벌',
        url: 'https://nol.yanolja.com/ticket/products/1',
      },
      {
        name: '부산 페스티벌',
        url: 'https://nol.yanolja.com/ticket/products/2',
        venue: '부산 공연장',
      },
    ]);
  });

  it('reads the Melon festival category JSON and rejects concerts included in the category', async () => {
    const melon = source('ticket-list', 'discovery');
    melon.url =
      'https://ticket.melon.com/performance/ajax/prodList.json?perfGenreCode=GENRE_CON_FESTIVAL';
    const body = JSON.stringify({
      result: 0,
      data: [
        {
          prodId: 213665,
          title: '2026 대구힙합페스티벌',
          periodInfo: '2026.12.25 - 2026.12.26',
          placeName: '대구 엑스코(EXCO)',
        },
        {
          prodId: 213901,
          title: '버츄얼 X 밴드 라이브 콘서트',
          periodInfo: '2026.10.31 - 2026.10.31',
          placeName: '서울',
        },
        {
          prodId: 213902,
          title: '재즈 페스티벌 콘서트',
          periodInfo: '2026.10.31 - 2026.10.31',
          placeName: '서울',
        },
        {
          prodId: 213903,
          title: '제83회 JAZZ! 라이브 클럽 데이',
          periodInfo: '2026.10.31 - 2026.10.31',
          placeName: '서울',
        },
        {
          prodId: 213904,
          title: 'KT&G 상상마당 부산 시리즈 기획 공연 - 클로버 뮤직 스테이션',
          periodInfo: '2026.10.31 - 2026.10.31',
          placeName: '부산',
        },
        {
          prodId: 213793,
          title: 'WONDERLIVET 2026 (원더리벳 2026)',
          periodInfo: '2026.11.20 - 2026.11.22',
          placeName: 'KINTEX HALL 7/8/9/10',
        },
      ],
    });
    expect(await parseCrawl(melon, body)).toEqual([
      {
        name: '2026 대구힙합페스티벌',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=213665',
        date: '2026.12.25 - 2026.12.26',
        venue: '대구 엑스코(EXCO)',
      },
      {
        name: 'WONDERLIVET 2026 (원더리벳 2026)',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
        date: '2026.11.20 - 2026.11.22',
        venue: 'KINTEX HALL 7/8/9/10',
      },
    ]);
  });

  it('reads the YES24 Korean festival category cards without requiring a festival word', async () => {
    const yes24 = source('ticket-list', 'discovery');
    yes24.url =
      'https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx?genre=15464&sort=0&area=&genretype=2&pCurPage=1&pPageSize=30';
    const html = `<div class='ms-list-imgs'>
      <a onclick='jsf_base_GoToPerfDetail(60590);' title='COUNTDOWN FANTASY 2026-2027'><div>
        <p class='list-b-tit1 v2'>COUNTDOWN FANTASY 2026-2027</p>
        <p class='list-b-tit2 v2'>2026.12.31 ~ 2026.12.31</p>
        <p class='list-b-tit2 v2'>킨텍스 제2전시장 7홀, 8홀</p></div></a>
      <a onclick='jsf_base_GoToPerfDetail(59840);' title='WONDERLIVET 2026 (원더리벳 2026)'><div class='list-bigger-wrap'><img class='lazyload' data-src='//tkfile.yes24.com/upload2/PerfBlog/202608/20260820/20260820-59840.png/dims/quality/70/' alt='WONDERLIVET 2026 (원더리벳 2026)' />
        <p class='list-b-tit1'>WONDERLIVET 2026 (원더리벳 2026)</p>
        <p class='list-b-tit2'>2026.11.20 ~ 2026.11.22</p>
        <p class='list-b-tit2'>KINTEX HALL 7/8/9/10</p></div></a>
      <a onclick='jsf_base_GoToPerfDetail(60000);'><div><p class='list-b-tit1'>단독 콘서트</p></div></a>
      <a onclick='jsf_base_GoToPerfDetail(60590);'><div><p class='list-b-tit1'>COUNTDOWN FANTASY 2026-2027</p></div></a>
    </div><input name="ListTotalCnt" type="hidden" id="ListTotalCnt" value="4" />`;
    expect(await parseCrawl(yes24, html)).toEqual([
      {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url: 'https://ticket.yes24.com/Perf/60590',
        date: '2026.12.31 ~ 2026.12.31',
        venue: '킨텍스 제2전시장 7홀, 8홀',
      },
      {
        name: 'WONDERLIVET 2026 (원더리벳 2026)',
        url: 'https://ticket.yes24.com/Perf/59840',
        date: '2026.11.20 ~ 2026.11.22',
        venue: 'KINTEX HALL 7/8/9/10',
      },
    ]);
  });

  it('reads a YES24 English concert card without confusing the Booking link with a festival', async () => {
    const yes24 = source('ticket-list', 'discovery');
    yes24.url = 'https://ticket.yes24.com/English/Genre/Concert';
    const html = `<ul class="list_wrap">
      <li class="poster"><a href="/English/Perf/60745"><img alt="poster"></a></li>
      <li class="conlist"><h3><a href="/English/Perf/60745">COUNTDOWN FANTASY 2026-2027</a></h3>
        <ul class="con_txt"><li><span>Genre</span>: [Festival]</li><li><span>Date/Time</span>: Dec 31, 2026</li><li><span>Venue</span>: KINTEX HALL 7·8</li></ul>
      </li></ul><div class="btn"><a href="/English/Perf/60745">Booking</a></div>`;
    expect(await parseCrawl(yes24, html)).toEqual([
      {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url: 'https://ticket.yes24.com/English/Perf/60745',
        date: 'Dec 31, 2026',
        venue: 'KINTEX HALL 7·8',
      },
    ]);
  });

  it('reads Mint Paper festival records and their official cover images from SSR data', async () => {
    const mint = source('ticket-list', 'discovery');
    mint.url = 'https://mintpaper.co.kr/festivals';
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          apolloState: {
            data: {
              ROOT_QUERY: {
                'festivals({"where":{"year":2026}})': [
                  { __ref: 'Festival:178' },
                  { __ref: 'Festival:172' },
                  { __ref: 'Other:1' },
                ],
              },
              'Festival:178': {
                id: '178',
                title: '𝗖𝗢𝗨𝗡𝗧𝗗𝗢𝗪𝗡 𝗙𝗔𝗡𝗧𝗔𝗦𝗬 𝟮𝟬𝟮𝟲-𝟮𝟬𝟮𝟳',
                place: 'KINTEX',
                startDate: '2026-12-31T03:00:00.000Z',
                endDate: '2027-01-01T03:00:00.000Z',
                coverImage: { __ref: 'UploadFile:1' },
              },
              'Festival:172': {
                id: '172',
                title: 'Grand Mint Festival 2026',
                place: 'Olympic Park',
                startDate: '2026-10-17T03:00:00.000Z',
                endDate: '2026-10-18T03:00:00.000Z',
              },
              'UploadFile:1': {
                url: 'https://mintpaper.s3.ap-northeast-2.amazonaws.com/poster.jpg',
              },
            },
          },
        },
      },
    )}</script>`;
    expect(await parseCrawl(mint, html)).toEqual([
      {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url: 'https://mintpaper.co.kr/festivals/178',
        date: '2026-12-31 ~ 2027-01-01',
        venue: 'KINTEX',
        posterUrl:
          'https://mintpaper.s3.ap-northeast-2.amazonaws.com/poster.jpg',
      },
      {
        name: 'Grand Mint Festival 2026',
        url: 'https://mintpaper.co.kr/festivals/172',
        date: '2026-10-17 ~ 2026-10-18',
        venue: 'Olympic Park',
      },
    ]);
  });

  it('reads only a Mint Paper festival detail info link as its Instagram account', async () => {
    const mint = source('ticket-list', 'discovery');
    mint.url = 'https://mintpaper.co.kr/festivals/178';
    const html = `<a href="https://www.instagram.com/mintpaper_">footer</a>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          apolloState: {
            data: {
              ROOT_QUERY: {
                'festival({"id":"178"})': { __ref: 'Festival:178' },
              },
              'Festival:178': {
                id: '178',
                title: 'COUNTDOWN FANTASY 2026-2027',
                place: 'KINTEX',
                startDate: '2026-12-31T03:00:00.000Z',
                endDate: '2027-01-01T03:00:00.000Z',
                info: '<a href="https://www.instagram.com/singer_account/">아티스트 공식 인스타그램</a><a href="https://www.instagram.com/countdown_fantasy/?utm_source=site">공식 인스타그램</a>',
                lineup: [
                  { instagram: 'https://www.instagram.com/singer_account/' },
                ],
              },
            },
          },
        },
      })}</script>`;
    expect(await parseCrawl(mint, html)).toEqual([
      {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url: 'https://mintpaper.co.kr/festivals/178',
        date: '2026-12-31 ~ 2027-01-01',
        venue: 'KINTEX',
        officialInstagramUrl: 'https://www.instagram.com/countdown_fantasy/',
      },
    ]);
    await expect(
      parseCrawl(mint, '<script id="__NEXT_DATA__">{bad}</script>'),
    ).rejects.toThrow('공개 예매 링크');
  });

  it('recognizes a festival-named Instagram account in Mint Paper detail info', async () => {
    const mint = source('ticket-list', 'discovery');
    mint.url = 'https://mintpaper.co.kr/festivals/172';
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          apolloState: {
            data: {
              ROOT_QUERY: {
                'festival({"id":"172"})': { __ref: 'Festival:172' },
              },
              'Festival:172': {
                id: '172',
                title: 'Grand Mint Festival 2026',
                info: '<a href="https://www.instagram.com/grandmintfestival/">@grandmintfestival</a>',
                lineup: [
                  { instagram: 'https://www.instagram.com/singer_account/' },
                ],
              },
            },
          },
        },
      },
    )}</script>`;
    expect(await parseCrawl(mint, html)).toEqual([
      {
        name: 'Grand Mint Festival 2026',
        url: 'https://mintpaper.co.kr/festivals/172',
        officialInstagramUrl: 'https://www.instagram.com/grandmintfestival/',
      },
    ]);
    mint.url = 'https://mintpaper.co.kr/festivals/172/lineup';
    expect(await parseCrawl(mint, html)).toEqual([
      {
        name: 'Grand Mint Festival 2026',
        url: 'https://mintpaper.co.kr/festivals/172',
        officialInstagramUrl: 'https://www.instagram.com/grandmintfestival/',
      },
    ]);
  });

  it('rejects a listing without a real festival candidate', async () => {
    await expect(
      parseCrawl(
        source('ticket-list', 'discovery'),
        '<a href="/festival">페스티벌</a><a href="https://tickets.example.com/1">예매하기</a>',
      ),
    ).rejects.toThrow('공개 예매 링크');
  });

  it('stops a catastrophic regex without blocking the event loop', async () => {
    const slow = parseCrawl(
      source('regex-days', 'days', {
        pattern: '(a|aa)+$',
      }),
      'a'.repeat(4999) + '!',
    );
    const responsive = await new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(true), 20),
    );
    expect(responsive).toBe(true);
    await expect(slow).rejects.toThrow('시간이 초과');
  }, 4000);
});
