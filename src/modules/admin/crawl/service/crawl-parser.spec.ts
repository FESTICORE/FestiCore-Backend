import { CrawlSource } from '../entity/crawl-source.entity';
import { parseCrawl, xmfNoticeArtistAliases } from './crawl-parser';

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

const CDF_OFFICIAL_HTML =
  '<h1 class="NormalView_title__3ywx_">𝗖𝗢𝗨𝗡𝗧𝗗𝗢𝗪𝗡 𝗙𝗔𝗡𝗧𝗔𝗦𝗬 𝟮𝟬𝟮𝟲-𝟮𝟬𝟮𝟳 1차 라인업 공개</h1><div class="mb-20 PostContent_content__1w8Py"><figure class="image"><img src="https://mintpaper.s3.ap-northeast-2.amazonaws.com/CDF_2627_1_927427bb10.jpg"></figure><p>&nbsp;</p><p><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">𝗖𝗢𝗨𝗡𝗧𝗗𝗢𝗪𝗡&nbsp;𝗙𝗔𝗡𝗧𝗔𝗦𝗬&nbsp;𝟮𝟬𝟮𝟲-𝟮𝟬𝟮𝟳</span><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">1차&nbsp;라인업을&nbsp;공개합니다.</span><br><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">✦°｡⋆⸜&nbsp;🪩&nbsp;⸝⋆｡°✦</span><br><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">⊹&nbsp;𝟭𝟮.𝟯𝟭&nbsp;𝙏𝙃𝙐</span><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">극동아시아타이거즈&nbsp;</span><a href="https://www.instagram.com/far_east_asian_tigers/">@far_east_asian_tigers</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">LOW&nbsp;HIGH&nbsp;LOW&nbsp;</span><a href="https://www.instagram.com/band_lowhighlow/">@band_lowhighlow</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">THE&nbsp;SOLUTIONS&nbsp;</span><a href="https://www.instagram.com/the_solutions/">@the_solutions</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">실리카겔&nbsp;</span><a href="https://www.instagram.com/silicagel.official/">@silicagel.official</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">AxMxP&nbsp;</span><a href="https://www.instagram.com/axmxp_official/">@axmxp_official</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">FTISLAND&nbsp;</span><a href="https://www.instagram.com/ftisland/">@ftisland</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">OYSTERS&nbsp;</span><a href="https://www.instagram.com/oysters.999/">@oysters.999</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">ONEWE(원위)&nbsp;</span><a href="https://www.instagram.com/official_onewe/">@official_onewe</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">IDIOTAPE&nbsp;</span><a href="https://www.instagram.com/idiotapeofficial/">@idiotapeofficial</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">KARDI&nbsp;</span><a href="https://www.instagram.com/bandkardi_/">@bandkardi_</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">포져군단&nbsp;</span><a href="https://www.instagram.com/poseridiott/">@poseridiott</a><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">혁오&nbsp;</span><a href="https://www.instagram.com/hyukohofficial/">@hyukohofficial</a><br><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">𝚊𝚗𝚍&nbsp;𝚖𝚊𝚗𝚢&nbsp;𝚖𝚘𝚛𝚎..</span><br><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">⌁&nbsp;─────&nbsp;⚠️&nbsp;─────&nbsp;⌁</span><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">⊹&nbsp;주요&nbsp;일정</span><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">10월&nbsp;13일(화)&nbsp;티켓&nbsp;오픈</span><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">11월&nbsp;3일(화)&nbsp;2차&nbsp;라인업&nbsp;발표</span><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">12월&nbsp;31일(목)&nbsp;CDF2026-2027</span><br><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">𝗖𝗢𝗨𝗡𝗧𝗗𝗢𝗪𝗡&nbsp;𝗙𝗔𝗡𝗧𝗔𝗦𝗬&nbsp;𝟮𝟬𝟮𝟲-𝟮𝟬𝟮𝟳</span><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">𝟭𝟮.𝟯𝟭(𝗧𝗛𝗨)&nbsp;𝗮𝘁&nbsp;𝗞𝗜𝗡𝗧𝗘𝗫&nbsp;𝗛𝗔𝗟𝗟&nbsp;𝟳-𝟴</span><br><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">🎫┃𝙉𝙊𝙇&nbsp;·&nbsp;𝙔𝙀𝙎𝟮𝟰&nbsp;·&nbsp;𝙉𝘼𝙑𝙀𝙍&nbsp;·&nbsp;𝟮𝙏𝙈</span><br><br><a href="https://www.instagram.com/explore/tags/countdownfantasy/">#COUNTDOWNFANTASY</a><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">&nbsp;</span><a href="https://www.instagram.com/explore/tags/%EC%B9%B4%EC%9A%B4%ED%8A%B8%EB%8B%A4%EC%9A%B4%ED%8C%90%ED%83%80%EC%A7%8020262027/">#카운트다운판타지20262027</a><span style="background-color:rgb(255,255,255);color:rgb(12,16,20);">&nbsp;</span><a href="https://www.instagram.com/explore/tags/cdf20262027/">#CDF20262027</a></p><p>&nbsp;</p><hr><p style="margin-left:0px;">&nbsp;</p><p style="margin-left:0px;">&nbsp;</p><p style="margin-left:0px;"><a href="https://www.mintpaper.co.kr/"><span class="text-small" style="background-color:transparent!important;color:rgb(153,153,153);"><u>www.mintpaper.com</u></span></a><br><span class="text-small" style="background-color:rgb(244,244,244);color:rgb(153,153,153);">facebook </span><a href="https://www.facebook.com/GrandMintFest/" target="_blank" rel="noopener noreferrer"><span class="text-small" style="background-color:transparent!important;color:rgb(153,153,153);"><u>@grandmintfestival</u></span></a><br><span class="text-small" style="background-color:rgb(244,244,244);color:rgb(153,153,153);">instagram </span><a href="https://www.instagram.com/grandmintfestival/" target="_blank" rel="noopener noreferrer"><span class="text-small" style="background-color:transparent!important;color:rgb(153,153,153);"><u>@grandmintfestival</u></span></a></p></div>';
const ONEWAY_OFFICIAL_HTML =
  '<div class="data_txt">\n                                \t<p class="" style="font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">원웨이 페스티벌 2026 - 슈퍼얼리버드</span></p><p class="" style="font: 13px " helvetica="" neue";="" min-height:="" 15px;="" margin:="" 0px;"=""><br></p><p class="" style="font: 13px " helvetica="" neue";="" min-height:="" 15px;="" margin:="" 0px;"=""><br></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">- 공 연 명 : 원웨이 페스티벌 2026</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">- 공연일시 : 2026. 12. 26- 12. 27</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">- 공연장소 : 킨텍스 제2전시장 10홀</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">&nbsp;</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">*슈퍼 얼리버드 티켓은 양일권(2일권)입니다.</span></p><p class="" style="font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">*한 ID당 8매까지 예매 가능합니다.</span></p><p class="" style="font: 13px " apple="" sd="" gothic="" neo";="" margin:="" 0px;"=""><span class="" style="font-size: 11pt;" helvetica="" neue";"="">*</span><span style="font-size: 11pt;">한정</span><span class="" style="font-size: 11pt;" helvetica="" neue";"=""> </span><span style="font-size: 11pt;">수량으로</span><span class="" style="font-size: 11pt;" helvetica="" neue";"=""> </span><span style="font-size: 11pt;">조기</span><span class="" style="font-size: 11pt;" helvetica="" neue";"=""> </span><span style="font-size: 11pt;">매진될</span><span class="" style="font-size: 11pt;" helvetica="" neue";"=""> </span><span style="font-size: 11pt;">수</span><span class="" style="font-size: 11pt;" helvetica="" neue";"=""> </span><span style="font-size: 11pt;">있습니다</span><span class="" style="font-size: 11pt;" helvetica="" neue";"="">.</span></p></div><div class="concert_info_txt">\n                                \t<p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">2026년의 마지막 주말과 주일</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">수많은 워십 아티스트와 그리스도인들이 한자리에 모여</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">함께 하나님을 예배하고, 교제하고, 문화를 나누는</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">그리스도인들의 워십 페스티벌</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">&nbsp;</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">ONE WAY FESTIVAL 2026은</span><br><span style="font-size: 11pt;">찬양과 예배만을 위한 집회도,</span><br><span style="font-size: 11pt;">공연만을 위한 페스티벌도 아닙니다.</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">그리스도인들이 함께 머물고 즐기고 나누는</span><br><span style="font-size: 11pt;">새로운 축제의 문화입니다.</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">&nbsp;</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">[1차 라인업]</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">마커스워십, 기프티드, 커피소년X제이레빗 혜선, 레비스탕스, 위클레시아, 달빛마을, 홀라이프 워십, 브리지임팩트, 히스플랜, 시온의대로 and 소향 그리고 이게 끝이 아닙니다. 더 많은 팀들이 출연할 예정입니다.</span></p><p class="" style="text-align: justify; font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span style="font-size: 11pt;">&nbsp;</span></p><p class="" style="font: 13px " helvetica="" neue";="" margin:="" 0px;"=""><span class="" style="font-size: 11pt;" apple="" sd="" gothic="" neo";"="">인스타그램</span><span style="font-size: 11pt;">: instagram.com/oneway_festival</span></p></div>';

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

  it('uses only the matching NOL product poster from a public listing card', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket';
    const html = String.raw`<script>self.__next_f.push([1,\"action\":{\"web\":\"https://nol.yanolja.com/ticket/products/26015181\"},\"thumbnail\":\"https://ticketimage.interpark.com/Play/image/large/26/26015181_p.gif\",\"title\":\"썸띵 뉴 뮤직 페스티벌 2026\",\"dateInfo\":\"내일 17:00\"},{\"action\":{\"web\":\"https://nol.yanolja.com/ticket/products/26013510\"},\"thumbnail\":\"https://ticketimage.interpark.com/Play/image/large/26/99999999_p.gif\",\"title\":\"서울 뮤직 페스티벌 2026\",\"dateInfo\":\"26.11.07 ~ 26.11.08\",\"locationDetails\":[\"인천남동체육관\"]}]);</script>`;
    expect(await parseCrawl(nol, html)).toEqual([
      {
        name: '썸띵 뉴 뮤직 페스티벌 2026',
        url: 'https://nol.yanolja.com/ticket/products/26015181',
        posterUrl:
          'https://ticketimage.interpark.com/Play/image/large/26/26015181_p.gif',
      },
      {
        name: '서울 뮤직 페스티벌 2026',
        url: 'https://nol.yanolja.com/ticket/products/26013510',
        date: '2026.11.07 - 2026.11.08',
        venue: '인천남동체육관',
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

  it('normalizes NOL place-product links to a single detail URL', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket/genre/concert';
    const html = String.raw`<script>self.__next_f.push([1,"action":{"web":"https://nol.yanolja.com/ticket/places/25000827/products/26011660"},"title":"서울 뮤직 페스티벌","dateInfo":"26.11.07 ~ 26.11.08","locationDetails":["서울 공연장"]}]);</script>`;

    expect(await parseCrawl(nol, html)).toEqual([
      {
        name: '서울 뮤직 페스티벌',
        url: 'https://nol.yanolja.com/ticket/products/26011660',
        date: '2026.11.07 - 2026.11.08',
        venue: '서울 공연장',
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

  it('reads a NOL product detail event date and venue rather than ticket opening time', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket/products/26007651';
    const html = `<html><head><title>NOL 티켓</title></head><body>
      <p>오픈 예정 2026.10.01 12:00</p><h1>NOL FESTIVAL : DAY 1 - K-POP STAGE</h1>
      <nav>공지사항 상품상세 장소</nav>
      <dl><dt>장소</dt><dd>일산 킨텍스 제 2전시장</dd><dt>기간</dt><dd>2026.10.17</dd></dl>
    </body></html>`;
    expect(await parseCrawl(nol, html)).toEqual([
      {
        name: 'NOL FESTIVAL : DAY 1 - K-POP STAGE',
        url: nol.url,
        date: '2026.10.17',
        venue: '일산 킨텍스 제 2전시장',
      },
    ]);
  });

  it('uses a NOL product poster from the official ticket image host', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket/products/26013406';
    const html = `<meta property="og:image" content="https://ticketimage.interpark.com/Play/image/large/26/26013406_p.gif" />
      <h1>NOL FESTIVAL 2026</h1><div>장소 킨텍스 일시 2026.10.17</div>`;

    expect(await parseCrawl(nol, html)).toEqual([
      {
        name: 'NOL FESTIVAL 2026',
        url: nol.url,
        date: '2026.10.17',
        venue: '킨텍스',
        posterUrl:
          'https://ticketimage.interpark.com/Play/image/large/26/26013406_p.gif',
      },
    ]);
  });

  it('reads a NOL performance page only when its event date and venue are valid', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket/products/26014568';
    const html = `<h1>COUNTDOWN FANTASY 2026-2027</h1>
      <div>장르 콘서트 &gt; 페스티벌</div>
      <div>장소 킨텍스 제2전시장 7홀, 8홀 일시 2026.12.31~2026.12.31</div>`;
    expect(await parseCrawl(nol, html)).toEqual([
      {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url: nol.url,
        date: '2026.12.31 - 2026.12.31',
        venue: '킨텍스 제2전시장 7홀, 8홀',
      },
    ]);
    await expect(
      parseCrawl(
        nol,
        '<h1>COUNTDOWN FANTASY 2026-2027</h1><p>장소 킨텍스 일시 2026.02.30</p>',
      ),
    ).rejects.toThrow('공개 예매 링크를 찾지 못했습니다.');
  });

  it('rejects a NOL concert and navigation text masquerading as a venue', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket/products/26014568';
    await expect(
      parseCrawl(
        nol,
        '<h1>재즈 페스티벌 콘서트</h1><p>장소 킨텍스 일시 2026.12.31</p>',
      ),
    ).rejects.toThrow('공개 예매 링크를 찾지 못했습니다.');
    await expect(
      parseCrawl(
        nol,
        '<h1>COUNTDOWN FANTASY 2026-2027</h1><nav>장소</nav><p>기간 2026.12.31</p>',
      ),
    ).rejects.toThrow('공개 예매 링크를 찾지 못했습니다.');
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

  it('reads the Melon search result row for Wonderlivet with dates and venue', async () => {
    const melon = source('ticket-list', 'discovery');
    melon.url = 'https://ticket.melon.com/search/index.htm?q=WONDERLIVET';
    const html = `<table><tr>
      <td><div class="show_infor">
        <a href="../performance/index.htm?prodId=213793" class="inner">
          <img src="https://cdnticket.melon.co.kr/resource/image/upload/product/2026/poster.png" alt="WONDERLIVET" />
        </a>
        <a href="../performance/index.htm?prodId=213793" class="inner">
          <span class="show_title"><span>WONDERLIVET</span> 2026 (원더리벳 2026)</span>
        </a>
      </div></td>
      <td class="show_date">2026.11.20 - 2026.11.22</td>
      <td class="show_loc">KINTEX HALL 7/8/9/10</td>
    </tr></table>`;
    expect(await parseCrawl(melon, html)).toEqual([
      {
        name: 'WONDERLIVET 2026 (원더리벳 2026)',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
        date: '2026.11.20 - 2026.11.22',
        venue: 'KINTEX HALL 7/8/9/10',
        posterUrl:
          'https://cdnticket.melon.co.kr/resource/image/upload/product/2026/poster.png',
      },
    ]);
  });

  it('preserves Melon search titles with in-word highlights and rejects untrusted posters', async () => {
    const melon = source('ticket-list', 'discovery');
    melon.url =
      'https://ticket.melon.com/search/index.htm?q=%ED%8E%98%EC%8A%A4%ED%8B%B0%EB%B2%8C';
    const html = `<table>
      <tr><td><a href="../performance/index.htm?prodId=213665">
        <img src="https://cdnticket.melon.co.kr/resource/image/upload/product/2026/10/poster.jpg">
        <span class="show_title">2026 대구힙합<span>페스티벌</span></span>
      </a></td><td class="show_date">2026.12.25 - 2026.12.26</td><td class="show_loc">대구 엑스코(EXCO)</td></tr>
      <tr><td><a href="../performance/index.htm?prodId=214100">
        <img src="https://evil.example/poster.jpg">
        <span class="show_title">원웨이 페스티벌 2026 &#40;얼리버드&#41;</span>
      </a></td><td class="show_date">2026.12.26 - 2026.12.27</td><td class="show_loc">일산 킨텍스</td></tr>
      <tr><td><a href="../performance/index.htm?prodId=214101">
        <img src="https://cdnticket.melon.co.kr/resource/image/web/common/logo.png">
        <span class="show_title">경로 오류 페스티벌</span>
      </a></td><td class="show_date">2026.12.26</td><td class="show_loc">서울</td></tr>
      <tr><td><a href="../performance/index.htm?prodId=214102">
        <img src="https://u:p@cdnticket.melon.co.kr/resource/image/upload/product/poster.jpg">
        <span class="show_title">계정 오류 페스티벌</span>
      </a></td><td class="show_date">2026.12.26</td><td class="show_loc">서울</td></tr>
      <tr><td><a href="../performance/index.htm?prodId=214106">
        <span class="show_title">클로버 뮤직 스테이션</span>
      </a></td><td class="show_date">2026.11.07</td><td class="show_loc">부산</td></tr>
    </table>`;
    expect(await parseCrawl(melon, html)).toEqual([
      {
        name: '2026 대구힙합페스티벌',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=213665',
        date: '2026.12.25 - 2026.12.26',
        venue: '대구 엑스코(EXCO)',
        posterUrl:
          'https://cdnticket.melon.co.kr/resource/image/upload/product/2026/10/poster.jpg',
      },
      {
        name: '원웨이 페스티벌 2026 (얼리버드)',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=214100',
        date: '2026.12.26 - 2026.12.27',
        venue: '일산 킨텍스',
      },
      {
        name: '경로 오류 페스티벌',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=214101',
        date: '2026.12.26',
        venue: '서울',
      },
      {
        name: '계정 오류 페스티벌',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=214102',
        date: '2026.12.26',
        venue: '서울',
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
        posterUrl:
          'https://tkfile.yes24.com/upload2/PerfBlog/202608/20260820/20260820-59840.png/dims/quality/70/',
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

  it('reads a Melon detail page with verified artist images', async () => {
    const melon = source('ticket-list', 'discovery');
    melon.url = 'https://ticket.melon.com/performance/index.htm?prodId=213793';
    const html = `<meta property="og:image" content="https://cdnticket.melon.co.kr/resource/image/upload/product/poster.jpg">
      <strong class="tit">WONDERLIVET 2026 (원더리벳 2026)</strong>
      <span class="txt_info">2026.11.20 - 2026.11.22</span>
      <span class="place">KINTEX HALL 7/8/9/10</span>
      <ul class="list_artist"><li><img src="https://cdnimg.melon.co.kr/artist/1.jpg"><span class="singer">THE ORAL CIGARETTES</span></li></ul>`;
    expect(await parseCrawl(melon, html)).toEqual([
      expect.objectContaining({
        name: 'WONDERLIVET 2026 (원더리벳 2026)',
        artists: [
          {
            name: 'THE ORAL CIGARETTES',
            sourceUrl: 'https://cdnimg.melon.co.kr/artist/1.jpg',
          },
        ],
      }),
    ]);
  });

  it('reads only the XMF official final-lineup notice and verifies both day counts', async () => {
    const xmf = source('ticket-list', 'discovery');
    xmf.url = 'https://xmfestival.com/notice';
    const html = `<div class="acd_row"><h4>[XMF 2027 개최 고지]</h4><p>2027. 07 TOKYO</p></div>
      <div class="acd_row"><h4>[XMF 2026 최종 라인업 공개]</h4><div class="board_contents">
      <p>XMF 조직위원회는 10월 3일부터 4일까지 이틀간 인천 파라다이스시티에서 열리는 XMF 2026의 출연진을 공개했다.</p>
      <p>첫날인 10월 3일에는 아도(Ado), 루시(LUCY), 윤하(YOUNHA), 콜드레인(coldrain), FT아일랜드(FTISLAND), 나카시마 미카(MIKA NAKASHIMA), 하츠웨이브(hrtz.wav), 마이 헤어 이즈 배드(My Hair is Bad), 노벨브라이트(Novelbright), 원위(ONEWE), 피플 원(PEOPLE 1) 등 11팀이 관객과 만난다.</p>
      <p>둘째 날인 4일 무대는 데이식스(DAY6), 원오크록(ONE OK ROCK), YB, 우버월드(UVERworld), 에에! 그룹(Ae! group), 하이파이유니콘(Hi-Fi Un!corn), 마르시(Marcy), 사우시 독(Saucy Dog), 에스플릿(Splayit), 더 픽스(THE FIX), 엑스디너리 히어로즈(Xdinary Heroes) 등 11팀이 공연을 이어간다. 이와 함께 첫날은 DJ 야베 유나(YUNA YABE), 둘째 날은 에무뉴(EMNW)가 오프닝 무대를 맡는다.</p>
      </div></div>`;
    const candidate = (await parseCrawl(xmf, html)) as {
      name: string;
      url: string;
      date: string;
      venue: string;
      artists: { name: string; profileUrl: string }[];
    }[];
    expect(candidate).toHaveLength(1);
    expect(candidate[0]).toMatchObject({
      name: 'XMF 2026',
      url: xmf.url,
      date: '2026.10.03 - 2026.10.04',
      venue: '인천 파라다이스시티',
    });
    expect(candidate[0].artists).toHaveLength(24);
    expect(candidate[0].artists.map((artist) => artist.name)).toEqual(
      expect.arrayContaining([
        '아도',
        'YB',
        '엑스디너리 히어로즈',
        'DJ 야베 유나',
        '에무뉴',
      ]),
    );
    expect(xmfNoticeArtistAliases(html, xmf.url, 2026)).toEqual(
      expect.arrayContaining([
        { name: '아도', alias: 'Ado' },
        { name: '루시', alias: 'LUCY' },
        { name: '데이식스', alias: 'DAY6' },
        { name: 'DJ 야베 유나', alias: 'YUNA YABE' },
      ]),
    );
    expect(xmfNoticeArtistAliases(html, xmf.url, 2027)).toBeNull();
    expect(
      xmfNoticeArtistAliases(
        html.replace('등 11팀이 공연을', '등 12팀이 공연을'),
        xmf.url,
        2026,
      ),
    ).toBeNull();
    await expect(
      parseCrawl(xmf, html.replace('등 11팀이 공연을', '등 12팀이 공연을')),
    ).rejects.toThrow('공개 예매 링크');
    const swappedCounts = html
      .replace('등 11팀이 관객과', '등 12팀이 관객과')
      .replace('등 11팀이 공연을', '등 10팀이 공연을');
    expect(xmfNoticeArtistAliases(swappedCounts, xmf.url, 2026)).toBeNull();
    await expect(parseCrawl(xmf, swappedCounts)).rejects.toThrow(
      '공개 예매 링크',
    );
  });

  it('reads a YES24 detail Event without inventing a timetable', async () => {
    const yes24 = source('ticket-list', 'discovery');
    yes24.url = 'https://ticket.yes24.com/Perf/60590';
    const html = `<script type="application/ld+json">{"@type":"Organization"}</script><script type="application/ld+json">${JSON.stringify(
      {
        '@type': 'Event',
        name: 'COUNTDOWN FANTASY 2026-2027',
        startDate: '2026-12-31',
        endDate: '2026-12-31',
        location: { name: '킨텍스 제2전시장 7홀, 8홀' },
        image: 'https://tkfile.yes24.com/upload2/PerfBlog/cdf.jpg',
      },
    )}</script>`;
    expect(await parseCrawl(yes24, html)).toEqual([
      {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url: yes24.url,
        date: '2026-12-31 ~ 2026-12-31',
        venue: '킨텍스 제2전시장 7홀, 8홀',
        posterUrl: 'https://tkfile.yes24.com/upload2/PerfBlog/cdf.jpg',
      },
    ]);
  });

  it('reads only valid, unique Event performers from a YES24 detail', async () => {
    const yes24 = source('ticket-list', 'discovery');
    yes24.url = 'https://ticket.yes24.com/Perf/60590';
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Event',
      name: 'COUNTDOWN FANTASY 2026-2027',
      startDate: '2026-12-31',
      endDate: '2026-12-31',
      location: { name: '킨텍스' },
      performer: [
        { '@type': 'MusicGroup', name: '밴드 A' },
        {
          '@type': 'MusicGroup',
          name: '밴드 A',
          image: 'https://tkfile.yes24.com/artists/band-a.jpg',
        },
        { '@type': 'Person', name: '가수 B' },
        { '@type': 'MusicGroup', name: '<img onerror=bad>' },
        { '@type': 'Organization', name: '예매처' },
        {
          '@type': 'MusicGroup',
          name: '외부 링크가 있는 가수',
          url: 'https://evil.example',
          image: 'https://evil.example/not-artist.jpg',
        },
      ],
    })}</script>`;
    const result = (await parseCrawl(yes24, html)) as {
      artists?: { name: string }[];
    }[];
    expect(result[0].artists).toEqual([
      {
        name: '밴드 A',
        sourceUrl: 'https://tkfile.yes24.com/artists/band-a.jpg',
      },
      { name: '가수 B' },
      { name: '외부 링크가 있는 가수' },
    ]);
  });

  it('reads paired performers from the English YES24 detail route', async () => {
    const yes24 = source('ticket-list', 'discovery');
    yes24.url = 'https://ticket.yes24.com/English/Perf/60590';
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Event',
      name: 'COUNTDOWN FANTASY 2026-2027',
      startDate: '2026-12-31',
      endDate: '2026-12-31',
      location: { name: '킨텍스' },
      performer: [
        {
          '@type': 'MusicGroup',
          name: '밴드 A',
          image: 'https://tkfile.yes24.com/artists/band-a.jpg',
        },
      ],
    })}</script>`;
    const result = (await parseCrawl(yes24, html)) as {
      artists?: { name: string; sourceUrl?: string }[];
    }[];
    expect(result[0].artists).toEqual([
      {
        name: '밴드 A',
        sourceUrl: 'https://tkfile.yes24.com/artists/band-a.jpg',
      },
    ]);
  });

  it('reads a single structured performer from a NOL event without creating set times', async () => {
    const nol = source('ticket-list', 'discovery');
    nol.url = 'https://nol.yanolja.com/ticket/products/26014568';
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Event',
      name: 'COUNTDOWN FANTASY 2026-2027',
      startDate: '2026-12-31',
      endDate: '2026-12-31',
      location: { name: '킨텍스' },
      performer: {
        '@type': 'Person',
        name: '가수 C',
        image: 'https://ticketimage.interpark.com/artist/c.jpg',
      },
    })}</script>`;
    expect(await parseCrawl(nol, html)).toEqual([
      {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url: nol.url,
        date: '2026.12.31 - 2026.12.31',
        venue: '킨텍스',
        artists: [
          {
            name: '가수 C',
            sourceUrl: 'https://ticketimage.interpark.com/artist/c.jpg',
          },
        ],
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

  it('reads Seoul festival performers from the city portal image description', async () => {
    const city = source('ticket-list', 'discovery', {
      expectedArtists: '6',
    });
    city.url =
      'https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=159493&menuNo=200011';
    const html = `<h2>2026 서울뮤직페스티벌</h2><img alt="2026 서울뮤직페스티벌 2026년 10월 24일 노들섬 부대행사 | 12:00 PM~ 본 공연 | 05:00 PM~ LINE UP IN 폴킴 | 권진아 | 옥상달빛 | 너드커넥션 | 추다해차지스 | 김창완밴드">`;
    expect(await parseCrawl(city, html)).toEqual([
      {
        name: '2026 서울뮤직페스티벌',
        url: city.url,
        date: '2026.10.24',
        artists: [
          '폴킴',
          '권진아',
          '옥상달빛',
          '너드커넥션',
          '추다해차지스',
          '김창완밴드',
        ].map((name) => ({ name })),
      },
    ]);
    city.url =
      'https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848';
    const funSeoul = (await parseCrawl(city, html)) as {
      name: string;
      url: string;
      date: string;
      artists: { name: string }[];
    }[];
    expect(funSeoul[0]).toMatchObject({
      name: '2026 서울뮤직페스티벌',
      url: city.url,
      date: '2026.10.24',
    });
    expect(funSeoul[0].artists).toHaveLength(6);
    await expect(
      parseCrawl(city, html.replace('2026년', '2025년')),
    ).rejects.toThrow('공개 예매 링크');
    city.parserConfig.expectedArtists = '7';
    await expect(parseCrawl(city, html)).rejects.toThrow('공개 예매 링크');
  });

  it('extracts 12 CDF performers from the official Mint Paper post HTML', async () => {
    const mint = source('ticket-list', 'discovery', {
      festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
    });
    mint.url = 'https://www.mintpaper.co.kr/posts/4819';
    const html = CDF_OFFICIAL_HTML;
    const candidates = (await parseCrawl(mint, html)) as {
      name: string;
      url: string;
      artists: { name: string }[];
    }[];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].url).toBe(mint.url);
    expect(candidates[0].name).toBe('COUNTDOWN FANTASY 2026-2027');
    expect(candidates[0].artists).toHaveLength(12);
    expect(candidates[0].artists).toEqual(
      [
        ['극동아시아타이거즈', 'far_east_asian_tigers'],
        ['LOW HIGH LOW', 'band_lowhighlow'],
        ['THE SOLUTIONS', 'the_solutions'],
        ['실리카겔', 'silicagel.official'],
        ['AxMxP', 'axmxp_official'],
        ['FTISLAND', 'ftisland'],
        ['OYSTERS', 'oysters.999'],
        ['ONEWE(원위)', 'official_onewe'],
        ['IDIOTAPE', 'idiotapeofficial'],
        ['KARDI', 'bandkardi_'],
        ['포져군단', 'poseridiott'],
        ['혁오', 'hyukohofficial'],
      ].map(([name, handle]) => ({
        name,
        profileUrl: `https://www.instagram.com/${handle}/`,
      })),
    );
    expect(candidates[0].artists).not.toContainEqual(
      expect.objectContaining({
        profileUrl: 'https://www.instagram.com/grandmintfestival/',
      }),
    );
    await expect(
      parseCrawl(
        mint,
        html.replace(
          'https://www.instagram.com/hyukohofficial/',
          'https://evil.example/hyukohofficial/',
        ),
      ),
    ).rejects.toThrow('공개 예매 링크');
    await expect(parseCrawl(mint, html.replace('혁오', ''))).rejects.toThrow(
      '공개 예매 링크',
    );
  });

  it('discovers only the NOL product linked by the official CDF ticket notice', async () => {
    const mint = source('ticket-list', 'discovery', {
      seed: 'official-ticket-links',
    });
    mint.url = 'https://www.mintpaper.co.kr/posts/4821';
    const post = {
      title: 'CDF2026-2027 TICKET | 예매 안내, 입장 안내, 관람 안내',
      content:
        '<p>COUNTDOWN FANTASY 2026-2027 일시 : 2026년 12월 31일(목)</p>' +
        '<a href="https://nol.yanolja.com/ticket/products/26014568">NOL</a>' +
        '<a href="https://nol.yanolja.com/ticket/products/26014568">NOL 중복</a>',
    };
    const html = (value: typeof post) =>
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { apolloState: { data: { 'Post:4821': value } } } })}</script>`;
    expect(await parseCrawl(mint, html(post))).toEqual([
      {
        name: 'COUNTDOWN FANTASY 2026-2027',
        url: 'https://nol.yanolja.com/ticket/products/26014568',
      },
    ]);
    for (const invalid of [
      'https://nol.yanolja.com/ticket/products/999?ref=other',
      'https://nol.yanolja.com/ticket/products/999/',
      'http://nol.yanolja.com/ticket/products/999',
      'https://NOL.yanolja.com/ticket/products/999',
      'https://nol.yanolja.com/ticket/places/999',
    ]) {
      await expect(
        parseCrawl(
          mint,
          html({
            ...post,
            content: `${post.content}<a href="${invalid}">NOL</a>`,
          }),
        ),
      ).rejects.toThrow('공개 예매 링크');
    }
    await expect(
      parseCrawl(
        mint,
        html({
          ...post,
          content: `${post.content}<a href=https://nol.yanolja.com/ticket/places/999>NOL</a>`,
        }),
      ),
    ).rejects.toThrow('공개 예매 링크');
    await expect(
      parseCrawl(
        mint,
        html({
          ...post,
          content: `${post.content}${Array.from({ length: 5 }, (_, i) => `<a href="https://nol.yanolja.com/ticket/products/${i + 1}">NOL</a>`).join('')}`,
        }),
      ),
    ).rejects.toThrow('공개 예매 링크');
    await expect(
      parseCrawl(mint, html({ ...post, title: '다른 공연 안내' })),
    ).rejects.toThrow('공개 예매 링크');
    await expect(
      parseCrawl(
        mint,
        html({
          ...post,
          content: post.content.replace('2026년 12월 31일', '2026년 2월 30일'),
        }),
      ),
    ).rejects.toThrow('공개 예매 링크');
    await expect(
      parseCrawl(
        mint,
        html({
          ...post,
          content: post.content.replace('2026년 12월 31일', '2027년 1월 1일'),
        }),
      ),
    ).rejects.toThrow('공개 예매 링크');
  });

  it('extracts 11 Oneway performers from the official Melon notice HTML', async () => {
    const melon = source('ticket-list', 'discovery', {
      festivalSourceUrl:
        'https://ticket.melon.com/performance/index.htm?prodId=213769',
    });
    melon.url = 'https://ticket.melon.com/csoon/detail.htm?csoonId=12728';
    const candidates = (await parseCrawl(melon, ONEWAY_OFFICIAL_HTML)) as {
      name: string;
      url: string;
      artists: { name: string }[];
    }[];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].url).toBe(melon.url);
    expect(candidates[0].artists).toHaveLength(11);
    expect(candidates[0].artists.map((artist) => artist.name)).toEqual(
      expect.arrayContaining(['마커스워십', '커피소년X제이레빗 혜선', '소향']),
    );
    await expect(
      parseCrawl(melon, ONEWAY_OFFICIAL_HTML.replace('and 소향', '')),
    ).rejects.toThrow('공개 예매 링크');
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
