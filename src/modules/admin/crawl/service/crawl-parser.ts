import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { CrawlSource } from '../entity/crawl-source.entity';

const REGEX_TIMEOUT_MS = 1000;
const MAX_REGEX_WORKERS = 10;
let activeRegexWorkers = 0;

function matchDaysPattern(
  pattern: string,
  input: string,
): Promise<Record<string, string> | null> {
  if (activeRegexWorkers >= MAX_REGEX_WORKERS) {
    throw new Error('정규식 파서 동시 실행 한도를 초과했습니다.');
  }
  // The configured expression and remote page run only in this disposable worker.
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    try {
      const match = new RegExp(workerData.pattern).exec(workerData.input);
      parentPort.postMessage({ groups: match?.groups ?? null });
    } catch (error) {
      parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  `,
    {
      eval: true,
      workerData: { pattern, input },
      resourceLimits: { maxOldGenerationSizeMb: 16 },
    },
  );
  activeRegexWorkers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      error: Error | null,
      groups: Record<string, string> | null = null,
    ) => {
      if (settled) return;
      settled = true;
      activeRegexWorkers--;
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(error);
      else resolve(groups);
    };
    const timeout = setTimeout(
      () => finish(new Error('정규식 파서 실행 시간이 초과되었습니다.')),
      REGEX_TIMEOUT_MS,
    );
    worker.once(
      'message',
      (result: { groups?: Record<string, string> | null; error?: string }) => {
        if (result.error) finish(new Error(result.error));
        else finish(null, result.groups ?? null);
      },
    );
    worker.once('error', (error: unknown) =>
      finish(error instanceof Error ? error : new Error(String(error))),
    );
    worker.once('exit', (code) => {
      finish(new Error(`정규식 파서 워커 종료: ${code}`));
    });
  });
}

export function plainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

type FestivalCandidate = {
  name: string;
  url: string;
  date?: string;
  venue?: string;
  posterUrl?: string;
  officialInstagramUrl?: string;
  artists?: { name: string; sourceUrl?: string }[];
};

const FESTIVAL_TITLE = /(?:페스티벌|축제|festival|\bfest\b)/i;
const GENERIC_TITLE =
  /^(?:페스티벌|축제|festival|fest|예매하기|상세보기|더보기|티켓)$/i;
const FESTIVAL_GROUP_NAME = /(?:페스티벌|festival)\s*(?:오케스트라|orchestra)/i;
const CONCERT_TITLE = /(?:콘서트|\bconcert\b|오케스트라|\borchestra\b)/i;
const VERIFIED_FESTIVAL_BRAND =
  /^(?:WONDERLIVET|원더리벳|COUNTDOWN FANTASY)(?:\s|$)/i;
const DATE_TEXT =
  /\b20\d{2}[.\-/]\s?(?:0?[1-9]|1[0-2])[.\-/]\s?(?:[0-2]?\d|3[01])(?:\s?[-~–]\s?(?:(?:20\d{2})[.\-/]\s?)?(?:0?[1-9]|1[0-2])[.\-/]\s?(?:[0-2]?\d|3[01]))?/;
const NOL_EVENT_DATE =
  /^(20\d{2}|\d{2})\.(\d{2})\.(\d{2})(?:\s*[~–-]\s*(?:(20\d{2}|\d{2})\.)?(\d{2})\.(\d{2}))?$/;

function nolEventDate(value: string): string | undefined {
  const match = NOL_EVENT_DATE.exec(value.trim());
  if (!match) return undefined;
  const valid = (year: string, month: string, day: string) => {
    const fullYear = Number(year.length === 2 ? `20${year}` : year);
    const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
    return (
      date.getUTCFullYear() === fullYear &&
      date.getUTCMonth() + 1 === Number(month) &&
      date.getUTCDate() === Number(day)
    );
  };
  if (!valid(match[1], match[2], match[3])) return undefined;
  const year = (part: string) => (part.length === 2 ? `20${part}` : part);
  const first = `${year(match[1])}.${match[2]}.${match[3]}`;
  if (!match[5]) return first;
  const lastYear = match[4] ?? match[1];
  if (!valid(lastYear, match[5], match[6])) return undefined;
  const last = `${year(lastYear)}.${match[5]}.${match[6]}`;
  return last >= first ? `${first} - ${last}` : undefined;
}

function mintPaperCandidates(
  body: string,
  base: string,
): FestivalCandidate[] | null {
  const source = new URL(base);
  if (
    source.hostname !== 'mintpaper.co.kr' ||
    !/^\/festivals(?:\/\d+(?:\/lineup)?)?\/?$/.test(source.pathname)
  )
    return null;
  if (body.length > 2_000_000) return [];
  const script =
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      body,
    )?.[1];
  if (!script) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(script);
  } catch {
    return [];
  }
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const props = record(record(payload)?.props);
  const data = record(record(props?.apolloState)?.data);
  const root = record(data?.ROOT_QUERY);
  if (!data || !root) return [];
  const refs: unknown[] = [];
  if (source.pathname === '/festivals' || source.pathname === '/festivals/') {
    for (const [key, value] of Object.entries(root)) {
      if (key.startsWith('festivals(') && Array.isArray(value))
        refs.push(...(value as unknown[]).slice(0, 100));
    }
  } else {
    const id = source.pathname.match(
      /^\/festivals\/(\d+)(?:\/lineup)?\/?$/,
    )?.[1];
    if (id) refs.push({ __ref: `Festival:${id}` });
  }
  const candidates = new Map<string, FestivalCandidate>();
  for (const item of refs.slice(0, 100)) {
    const ref = record(item)?.__ref;
    if (typeof ref !== 'string' || !/^Festival:\d+$/.test(ref)) continue;
    const festival = record(data[ref]);
    if (!festival || String(festival.id) !== ref.slice(9)) continue;
    const name =
      typeof festival.title === 'string'
        ? festival.title.normalize('NFKC').replace(/\s+/g, ' ').trim()
        : '';
    if (!name || name.length > 160) continue;
    const url = new URL(`/festivals/${ref.slice(9)}`, source.origin).toString();
    const candidate: FestivalCandidate = { name, url };
    const start = festival.startDate;
    const end = festival.endDate;
    if (
      typeof start === 'string' &&
      typeof end === 'string' &&
      /^20\d\d-\d\d-\d\dT/.test(start) &&
      /^20\d\d-\d\d-\d\dT/.test(end) &&
      !Number.isNaN(Date.parse(start)) &&
      !Number.isNaN(Date.parse(end))
    ) {
      candidate.date = `${start.slice(0, 10)} ~ ${end.slice(0, 10)}`;
    }
    if (typeof festival.place === 'string' && festival.place.trim())
      candidate.venue = festival.place.normalize('NFKC').trim();
    const coverRef = record(festival.coverImage)?.__ref;
    const poster =
      typeof coverRef === 'string' ? record(data[coverRef])?.url : undefined;
    if (typeof poster === 'string') {
      try {
        const image = new URL(poster);
        if (image.protocol === 'https:' && !image.username && !image.password)
          candidate.posterUrl = image.toString();
      } catch {
        /* Ignore malformed remote image URLs. */
      }
    }
    // Only the festival's own info field can identify its official account.
    // Links in lineup or the site footer often belong to artists or the organizer.
    if (typeof festival.info === 'string') {
      for (const match of festival.info.matchAll(
        /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      )) {
        try {
          const account = new URL(match[1].replace(/&amp;/g, '&'));
          const handle = account.pathname.replace(/^\/|\/$/g, '').toLowerCase();
          const titleHandle = name
            .toLowerCase()
            .replace(/\b20\d{2}\b/g, '')
            .replace(/[^a-z0-9가-힣]/g, '');
          const normalizedHandle = handle.replace(/[^a-z0-9가-힣]/g, '');
          if (
            account.protocol === 'https:' &&
            (account.hostname === 'instagram.com' ||
              account.hostname === 'www.instagram.com') &&
            /^\/[A-Za-z0-9._]+\/?$/.test(account.pathname) &&
            titleHandle.length >= 8 &&
            normalizedHandle === titleHandle
          ) {
            candidate.officialInstagramUrl = `${account.origin}${account.pathname}`;
            break;
          }
        } catch {
          /* Ignore malformed remote links. */
        }
      }
    }
    candidates.set(url, candidate);
  }
  return [...candidates.values()];
}

function xmfNoticeCandidates(
  body: string,
  base: string,
): FestivalCandidate[] | null {
  const source = new URL(base);
  if (source.hostname !== 'xmfestival.com' || source.pathname !== '/notice')
    return null;
  if (body.length > 2_000_000) return [];

  // The organizer publishes several announcements on this page. Read only the
  // final-lineup announcement so notices for other years cannot add performers.
  const heading = /\[\s*(XMF\s+(20\d{2}))\s+최종\s+라인업\s+공개\s*\]/i.exec(
    body,
  );
  if (!heading) return [];
  const nextNotice = body.indexOf(
    'class="acd_row',
    heading.index + heading[0].length,
  );
  const announcement = plainText(
    body.slice(
      heading.index,
      nextNotice < 0
        ? heading.index + 20_000
        : Math.min(nextNotice, heading.index + 20_000),
    ),
  );
  const dates = /(\d{1,2})월\s*(\d{1,2})일부터\s*(\d{1,2})일까지/.exec(
    announcement,
  );
  const venue = /이틀간\s+(.{2,80}?)에서\s+열리는/.exec(announcement)?.[1];
  if (!dates || !venue) return [];
  const year = Number(heading[2]);
  const first = Number(dates[2]);
  const last = Number(dates[3]);
  const monthNumber = Number(dates[1]);
  const validDay = (day: number) =>
    day > 0 &&
    new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDate() === day &&
    new Date(Date.UTC(year, monthNumber - 1, day)).getUTCMonth() + 1 ===
      monthNumber;
  if (!validDay(first) || !validDay(last) || last < first) return [];

  const dayOne =
    /첫날인\s+\d{1,2}월\s+\d{1,2}일에는\s+(.+?)\s+등\s+(\d{1,2})팀/.exec(
      announcement,
    );
  const dayTwo =
    /둘째\s+날인\s+\d{1,2}일\s+무대는\s+(.+?)\s+등\s+(\d{1,2})팀/.exec(
      announcement,
    );
  if (!dayOne || !dayTwo) return [];
  const names = [dayOne, dayTwo].flatMap((day) => {
    const artists = day[1]
      .split(/\s*,\s*/)
      .map((name) => name.replace(/\s*\([^()]*\)\s*$/, '').trim());
    return artists.length === Number(day[2]) ? artists : [];
  });
  if (names.length !== Number(dayOne[2]) + Number(dayTwo[2])) return [];
  const openingDjs =
    /첫날은\s+(DJ\s+[^,]+?)\s*,\s*둘째\s+날은\s+(.+?)가\s+오프닝\s+무대/.exec(
      announcement,
    );
  if (openingDjs) {
    names.push(
      openingDjs[1].replace(/\s*\([^()]*\)\s*$/, '').trim(),
      openingDjs[2].replace(/\s*\([^()]*\)\s*$/, '').trim(),
    );
  }
  if (names.some((name) => !name || name.length > 160)) return [];
  const day = (value: number) =>
    `${year}.${String(monthNumber).padStart(2, '0')}.${String(value).padStart(2, '0')}`;
  return [
    {
      name: heading[1],
      url: source.toString(),
      date: `${day(first)} - ${day(last)}`,
      venue,
      artists: [...new Set(names)].map((name) => ({ name })),
    },
  ];
}

function officialLineupCandidates(
  body: string,
  base: string,
  config: Record<string, string>,
): FestivalCandidate[] | null {
  const source = new URL(base);
  const isMintPost =
    (source.hostname === 'mintpaper.co.kr' ||
      source.hostname === 'www.mintpaper.co.kr') &&
    source.pathname === '/posts/4819';
  const isOnewayNotice =
    source.hostname === 'ticket.melon.com' &&
    source.pathname === '/csoon/detail.htm' &&
    source.searchParams.get('csoonId') === '12728';
  if (!isMintPost && !isOnewayNotice) return null;
  if (body.length > 2_000_000) return [];
  let festivalUrl: URL;
  try {
    festivalUrl = new URL(config.festivalSourceUrl);
  } catch {
    return [];
  }
  if (
    festivalUrl.protocol !== 'https:' ||
    festivalUrl.username ||
    festivalUrl.password
  )
    return [];

  if (isMintPost) {
    const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1];
    const article =
      /<div\b[^>]*class=["'][^"']*\bPostContent_content\S*[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
        body,
      )?.[1];
    if (!title || !article) return [];
    const name = plainText(title)
      .normalize('NFKC')
      .replace(/\s*1차 라인업 공개\s*$/, '')
      .trim();
    if (!/^COUNTDOWN FANTASY 20\d{2}-20\d{2}$/.test(name)) return [];
    const lineup = article.split(/<br\s*\/?\s*>/i);
    const day = lineup.findIndex((line) =>
      /12[.．]31/i.test(plainText(line).normalize('NFKC')),
    );
    if (day < 0) return [];
    const artists: { name: string }[] = [];
    for (const line of lineup.slice(day + 1, day + 81)) {
      if (/and\s+many\s+more/i.test(plainText(line).normalize('NFKC'))) break;
      if (
        !/<a\b[^>]*href=["']https:\/\/www\.instagram\.com\/[A-Za-z0-9._]+\/?["']/i.test(
          line,
        )
      )
        continue;
      const artistName = plainText(line.split(/<a\b/i)[0])
        .normalize('NFKC')
        .trim();
      if (artistName && artistName.length <= 160)
        artists.push({ name: artistName });
    }
    if (artists.length !== 12) return [];
    return [{ name, url: source.toString(), artists }];
  }

  const content =
    /<div\b[^>]*class=["'][^"']*\bconcert_info_txt\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      body,
    )?.[1];
  const info =
    /<div\b[^>]*class=["'][^"']*\bdata_txt\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      body,
    )?.[1];
  if (
    !content ||
    !info ||
    !/공\s*연\s*명\s*:\s*원웨이 페스티벌 2026/.test(plainText(info))
  )
    return [];
  const text = plainText(content);
  const lineup = /\[1차 라인업\]\s*(.+?)\s*그리고 이게 끝이 아닙니다\./.exec(
    text,
  )?.[1];
  if (!lineup) return [];
  const names = lineup.split(/\s*,\s*|\s+and\s+/i).map((name) => name.trim());
  if (names.length !== 11 || names.some((name) => !name || name.length > 160))
    return [];
  return [
    {
      name: '원웨이 페스티벌 2026',
      url: source.toString(),
      artists: names.map((name) => ({ name })),
    },
  ];
}

function seoulCultureLineupCandidates(
  body: string,
  base: string,
  config: Record<string, string>,
): FestivalCandidate[] | null {
  const source = new URL(base);
  const isCulturePortal =
    source.hostname === 'culture.seoul.go.kr' &&
    source.pathname === '/culture/culture/cultureEvent/view.do' &&
    source.searchParams.get('cultcode') === '159493';
  const isFunSeoul =
    source.hostname === 'festival.seoul.go.kr' &&
    source.pathname === '/festival/main/festivalView.do' &&
    source.searchParams.get('festacode') === '848';
  if (!isCulturePortal && !isFunSeoul) return null;
  if (body.length > 2_000_000) return [];

  const text = plainText(body);
  const name = /(20\d{2} 서울뮤직페스티벌)/.exec(text)?.[1];
  if (!name) return [];
  const alt = [...body.matchAll(/<img\b[^>]*\balt="([^"]{1,500})"[^>]*>/gi)]
    .map((match) => match[1])
    .find((value) => value.includes('LINE UP IN '));
  const lineup = /LINE UP IN\s+([^"<>]+)/.exec(alt ?? '')?.[1];
  if (!lineup) return [];
  const dateParts = /(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(alt ?? '');
  if (!dateParts || !name.startsWith(dateParts[1])) return [];
  const [, year, month, day] = dateParts;
  const parsedDate = new Date(Date.UTC(+year, +month - 1, +day));
  if (
    parsedDate.getUTCFullYear() !== +year ||
    parsedDate.getUTCMonth() + 1 !== +month ||
    parsedDate.getUTCDate() !== +day
  )
    return [];
  const names = lineup.split('|').map((name) => name.trim());
  const expectedArtists = Number(config.expectedArtists);
  if (
    !Number.isInteger(expectedArtists) ||
    expectedArtists < 1 ||
    expectedArtists > 80 ||
    names.length !== expectedArtists ||
    new Set(names).size !== expectedArtists ||
    names.some((name) => !name || name.length > 80)
  )
    return [];
  return [
    {
      name,
      url: source.toString(),
      date: `${year}.${month.padStart(2, '0')}.${day.padStart(2, '0')}`,
      artists: names.map((name) => ({ name })),
    },
  ];
}

function taggedText(html: string, tagOrClass: string): string | undefined {
  const match = new RegExp(
    `<(?:${tagOrClass})\\b[^>]*>([\\s\\S]*?)<\\/(?:${tagOrClass})>`,
    'i',
  ).exec(html);
  return match ? plainText(match[1]) : undefined;
}

function classText(html: string, classes: string): string | undefined {
  const match = new RegExp(
    `<[a-z][^>]*class=["'][^"']*\\b(?:${classes})\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[a-z][^>]*>`,
    'i',
  ).exec(html);
  return match ? plainText(match[1]) : undefined;
}

function festivalTitle(
  anchor: string,
  card: string,
  attributes: string,
): string {
  const imageAlt = /<img\b[^>]*alt=["']([^"']+)["']/i.exec(anchor)?.[1];
  const attributeTitle = /\btitle=["']([^"']+)["']/i.exec(attributes)?.[1];
  return (
    taggedText(anchor, 'h[1-6]') ||
    classText(anchor, 'title|name') ||
    imageAlt ||
    attributeTitle ||
    taggedText(card, 'h[1-6]') ||
    classText(card, 'title|name') ||
    plainText(anchor)
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function isFestivalTitle(name: string): boolean {
  return (
    FESTIVAL_TITLE.test(name) &&
    !GENERIC_TITLE.test(name) &&
    !FESTIVAL_GROUP_NAME.test(name) &&
    name.length <= 160
  );
}

function melonFestivalCandidates(
  body: string,
  base: string,
): FestivalCandidate[] | null {
  const source = new URL(base);
  if (
    source.hostname !== 'ticket.melon.com' ||
    source.pathname !== '/performance/ajax/prodList.json' ||
    source.searchParams.get('perfGenreCode') !== 'GENRE_CON_FESTIVAL'
  )
    return null;
  if (body.length > 2_000_000) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload))
    return null;
  const rows = payload.data;
  if (!Array.isArray(rows)) return [];
  const origin = source.origin;
  const candidates = new Map<string, FestivalCandidate>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const product = row as Record<string, unknown>;
    const name = product.title;
    const id = product.prodId;
    if (
      typeof name !== 'string' ||
      CONCERT_TITLE.test(name) ||
      !(isFestivalTitle(name) || VERIFIED_FESTIVAL_BRAND.test(name)) ||
      (typeof id !== 'string' && typeof id !== 'number') ||
      !/^\d+$/.test(String(id))
    )
      continue;
    const url = new URL(
      `/performance/index.htm?prodId=${id}`,
      origin,
    ).toString();
    const candidate: FestivalCandidate = { name, url };
    if (
      typeof product.periodInfo === 'string' &&
      DATE_TEXT.test(product.periodInfo)
    )
      candidate.date = product.periodInfo.trim();
    if (typeof product.placeName === 'string' && product.placeName.trim())
      candidate.venue = product.placeName.trim();
    candidates.set(url, candidate);
    if (candidates.size >= 100) break;
  }
  return [...candidates.values()];
}

export function melonSearchCandidates(
  body: string,
  base: string,
): FestivalCandidate[] | null {
  const source = new URL(base);
  if (
    source.hostname !== 'ticket.melon.com' ||
    source.pathname !== '/search/index.htm'
  )
    return null;
  const candidates = new Map<string, FestivalCandidate>();
  for (const row of body
    .slice(0, 2_000_000)
    .matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const id =
      /href=["'][^"']*\/performance\/index\.htm\?prodId=(\d+)["']/i.exec(
        row[1],
      )?.[1];
    const title =
      /class=["'][^"']*\bshow_title\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        row[1],
      )?.[1];
    const name =
      title &&
      plainText(
        title
          .replace(/<\/?(?:span|em|strong|b)\b[^>]*>/gi, '')
          .replace(/&#40;/gi, '(')
          .replace(/&#41;/gi, ')'),
      );
    if (
      !id ||
      !name ||
      CONCERT_TITLE.test(name) ||
      !(isFestivalTitle(name) || VERIFIED_FESTIVAL_BRAND.test(name))
    )
      continue;
    const date = classText(row[1], 'show_date');
    if (!date || !DATE_TEXT.test(date)) continue;
    const candidate: FestivalCandidate = {
      name,
      url: new URL(
        `/performance/index.htm?prodId=${id}`,
        source.origin,
      ).toString(),
      date,
    };
    const venue = classText(row[1], 'show_loc');
    if (venue) candidate.venue = venue;
    const poster = /<img\b[^>]*\bsrc=["'](https:\/\/[^"']+)["']/i.exec(
      row[1],
    )?.[1];
    if (poster) {
      try {
        const image = new URL(poster);
        if (
          image.hostname === 'cdnticket.melon.co.kr' &&
          image.pathname.startsWith('/resource/image/upload/product/') &&
          !image.username &&
          !image.password
        )
          candidate.posterUrl = image.toString();
      } catch {
        /* Ignore malformed poster URLs. */
      }
    }
    candidates.set(candidate.url, candidate);
    if (candidates.size >= 100) break;
  }
  return [...candidates.values()];
}

function melonDetailCandidates(
  body: string,
  base: string,
): FestivalCandidate[] | null {
  const source = new URL(base);
  if (
    source.hostname !== 'ticket.melon.com' ||
    source.pathname !== '/performance/index.htm' ||
    !/^\d+$/.test(source.searchParams.get('prodId') ?? '')
  )
    return null;
  const rawName = classText(body, 'tit');
  const name = rawName?.replace(/&#40;/g, '(').replace(/&#41;/g, ')').trim();
  const date = classText(body, 'txt_info') || undefined;
  const venue = classText(body, 'place');
  if (
    !name ||
    CONCERT_TITLE.test(name) ||
    !(isFestivalTitle(name) || VERIFIED_FESTIVAL_BRAND.test(name)) ||
    !date ||
    !DATE_TEXT.test(date) ||
    !venue
  )
    return [];
  const candidate: FestivalCandidate = {
    name,
    url: source.toString(),
    date,
    venue,
  };
  const poster =
    /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(
      body,
    )?.[1];
  if (poster) {
    try {
      const image = new URL(poster, source);
      if (
        image.protocol === 'https:' &&
        image.hostname === 'cdnticket.melon.co.kr'
      )
        candidate.posterUrl = image.toString();
    } catch {
      /* Ignore malformed poster URLs. */
    }
  }
  const artistList =
    /<ul\b[^>]*class=["'][^"']*\blist_artist\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(
      body,
    )?.[1];
  if (artistList) {
    const artists = new Map<string, { name: string; sourceUrl?: string }>();
    for (const row of artistList.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const artistName = classText(row[1], 'singer');
      if (!artistName || artistName.length > 160) continue;
      const artist: { name: string; sourceUrl?: string } = { name: artistName };
      const rawImage = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(row[1])?.[1];
      if (rawImage) {
        try {
          const image = new URL(rawImage, source);
          if (
            image.protocol === 'https:' &&
            image.hostname === 'cdnimg.melon.co.kr'
          )
            artist.sourceUrl = image.toString();
        } catch {
          /* Ignore malformed artist images. */
        }
      }
      artists.set(artistName, artist);
      if (artists.size >= 80) break;
    }
    if (artists.size) candidate.artists = [...artists.values()];
  }
  return [candidate];
}

export function yes24EventJson(body: string): Record<string, unknown> | null {
  const scripts = body.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  let examined = 0;
  for (const match of scripts) {
    if (++examined > 10) break;
    if (match[1].length > 20_000) continue;
    try {
      const value = JSON.parse(match[1]) as unknown;
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>)['@type'] === 'Event'
      )
        return value as Record<string, unknown>;
    } catch {
      /* Ignore malformed structured data. */
    }
  }
  return null;
}

export function eventPerformers(
  event: Record<string, unknown> | null,
  pageUrl: string,
): { name: string; sourceUrl?: string }[] {
  const value = event?.performer;
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const artists = new Map<string, { name: string; sourceUrl?: string }>();
  for (const entry of entries.slice(0, 160)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const performer = entry as Record<string, unknown>;
    if (
      !['Person', 'MusicGroup', 'PerformingGroup'].includes(
        String(performer['@type']),
      ) ||
      typeof performer.name !== 'string'
    )
      continue;
    const name = performer.name.trim();
    if (
      !name ||
      name.length > 160 ||
      /[<>\\]/.test(name) ||
      [...name].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    )
      continue;
    const artist: { name: string; sourceUrl?: string } = { name };
    if (typeof performer.image === 'string') {
      try {
        const image = new URL(performer.image, pageUrl);
        const page = new URL(pageUrl);
        const trusted =
          (page.hostname === 'ticket.yes24.com' &&
            ['tkfile.yes24.com', 'stkfile.yes24.com'].includes(
              image.hostname,
            )) ||
          (page.hostname === 'nol.yanolja.com' &&
            image.hostname === 'ticketimage.interpark.com');
        if (
          image.protocol === 'https:' &&
          !image.username &&
          !image.password &&
          !image.port &&
          trusted
        )
          artist.sourceUrl = image.toString();
      } catch {
        /* Ignore malformed performer image URLs. */
      }
    }
    if (
      !artists.has(name) ||
      (!artists.get(name)?.sourceUrl && artist.sourceUrl)
    )
      artists.set(name, artist);
  }
  return [...artists.values()];
}

function yes24DetailCandidates(
  body: string,
  base: string,
): FestivalCandidate[] | null {
  const source = new URL(base);
  if (
    source.hostname !== 'ticket.yes24.com' ||
    !/^\/(?:English\/)?Perf\/\d+$/.test(source.pathname)
  )
    return null;
  const event = yes24EventJson(body);
  if (!event) return [];
  const name = event.name;
  const start = event.startDate;
  const end = event.endDate;
  const location = event.location;
  const venue =
    location && typeof location === 'object' && 'name' in location
      ? location.name
      : null;
  if (
    typeof name !== 'string' ||
    CONCERT_TITLE.test(name) ||
    !(isFestivalTitle(name) || VERIFIED_FESTIVAL_BRAND.test(name)) ||
    typeof start !== 'string' ||
    typeof end !== 'string' ||
    !/^20\d\d-\d\d-\d\d$/.test(start) ||
    !/^20\d\d-\d\d-\d\d$/.test(end) ||
    typeof venue !== 'string' ||
    !venue.trim()
  )
    return [];
  const candidate: FestivalCandidate = {
    name,
    url: source.toString(),
    date: `${start} ~ ${end}`,
    venue: venue.trim(),
  };
  const artists = eventPerformers(event, base);
  if (artists.length) candidate.artists = artists;
  if (typeof event.image === 'string') {
    try {
      const image = new URL(event.image, source);
      if (image.protocol === 'https:' && image.hostname === 'tkfile.yes24.com')
        candidate.posterUrl = image.toString();
    } catch {
      /* Ignore malformed poster URLs. */
    }
  }
  return [candidate];
}

function nolDetailCandidates(
  body: string,
  base: string,
): FestivalCandidate[] | null {
  const source = new URL(base);
  if (
    source.hostname !== 'nol.yanolja.com' ||
    !/^\/ticket\/(?:products\/\d+|meta\/performance\/[\w%.-]+)$/.test(
      source.pathname,
    )
  )
    return null;
  if (body.length > 2_000_000) return [];

  const event = yes24EventJson(body);
  const text = plainText(body);
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1];
  const name =
    (typeof event?.name === 'string' ? event.name : null) ??
    (heading ? plainText(heading) : '');
  if (
    CONCERT_TITLE.test(name) ||
    !(isFestivalTitle(name) || VERIFIED_FESTIVAL_BRAND.test(name))
  )
    return [];

  const dateText =
    /(?:^|\s)(?:기간|일시)\s+(20\d{2}\.\d{2}\.\d{2}(?:\s*[~–-]\s*20\d{2}\.\d{2}\.\d{2})?)/.exec(
      text,
    )?.[1];
  const start = typeof event?.startDate === 'string' ? event.startDate : '';
  const end = typeof event?.endDate === 'string' ? event.endDate : start;
  const structuredDate =
    /^20\d{2}-\d{2}-\d{2}$/.test(start) && /^20\d{2}-\d{2}-\d{2}$/.test(end)
      ? nolEventDate(
          `${start.replaceAll('-', '.')} ~ ${end.replaceAll('-', '.')}`,
        )
      : undefined;
  const date = structuredDate ?? (dateText && nolEventDate(dateText));
  const location = event?.location;
  const structuredVenue =
    location && typeof location === 'object' && 'name' in location
      ? location.name
      : null;
  const venueText =
    /(?:^|\s)장소\s+(.{2,160}?)\s+(?:기간|일시)\s+20\d{2}\./.exec(text)?.[1];
  const venue =
    typeof structuredVenue === 'string'
      ? structuredVenue.trim()
      : venueText?.replace(/^장소\s+/, '').trim();
  if (
    !date ||
    !venue ||
    venue.length > 160 ||
    /^(?:장소|기간|일시)$/.test(venue) ||
    /[<>\\]/.test(venue)
  )
    return [];
  const candidate: FestivalCandidate = {
    name,
    url: source.toString(),
    date,
    venue,
  };
  const artists = eventPerformers(event, base);
  if (artists.length) candidate.artists = artists;
  const poster = nolPosterUrl(body, source);
  if (poster) candidate.posterUrl = poster;
  return [candidate];
}

export function nolPosterUrl(body: string, source: URL): string | null {
  if (
    source.hostname !== 'nol.yanolja.com' ||
    !/^\/ticket\/products\/\d+$/.test(source.pathname)
  )
    return null;
  const event = yes24EventJson(body);
  const poster =
    (typeof event?.image === 'string' ? event.image : null) ??
    /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(
      body,
    )?.[1];
  if (poster) {
    try {
      const image = new URL(poster, source);
      if (
        image.protocol === 'https:' &&
        image.hostname === 'ticketimage.interpark.com' &&
        /^\/Play\/image\/large\/\d+\/\d+_p\.(?:gif|jpe?g|png|webp)$/i.test(
          image.pathname,
        )
      )
        return image.toString();
    } catch {
      /* Ignore malformed poster URLs. */
    }
  }
  return null;
}

function canonicalNolProductUrl(url: URL): URL {
  if (url.hostname !== 'nol.yanolja.com') return url;
  const match = /^\/ticket\/places\/\d+\/products\/(\d+)$/.exec(url.pathname);
  if (match) {
    url.pathname = `/ticket/products/${match[1]}`;
    url.search = '';
  }
  return url;
}

function yes24FestivalCandidates(
  body: string,
  base: string,
): FestivalCandidate[] | null {
  const source = new URL(base);
  if (
    source.hostname !== 'ticket.yes24.com' ||
    source.pathname !== '/New/Genre/Ajax/GenreList_Data.aspx' ||
    source.searchParams.get('genre') !== '15464'
  )
    return null;
  const candidates = new Map<string, FestivalCandidate>();
  // Four individually bounded YES24 pages may be joined into one snapshot.
  const bounded = body.slice(0, 8_000_003);
  for (const match of bounded.matchAll(
    /<a\b([^>]*\bonclick=["']jsf_base_GoToPerfDetail\((\d+)\);?["'][^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    const name =
      classText(match[3], 'list-b-tit1') ||
      /\btitle=["']([^"']+)["']/i.exec(match[1])?.[1]?.trim();
    if (
      !name ||
      name.length > 160 ||
      name.length <= 3 ||
      GENERIC_TITLE.test(name) ||
      CONCERT_TITLE.test(name) ||
      !(isFestivalTitle(name) || VERIFIED_FESTIVAL_BRAND.test(name))
    )
      continue;
    const details = [
      ...match[3].matchAll(
        /<p\b[^>]*class=["'][^"']*\blist-b-tit2\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi,
      ),
    ]
      .slice(0, 2)
      .map((item) => plainText(item[1]));
    const candidate: FestivalCandidate = {
      name,
      url: `https://ticket.yes24.com/Perf/${match[2]}`,
    };
    if (details[0] && DATE_TEXT.test(details[0])) candidate.date = details[0];
    if (details[1]) candidate.venue = details[1];
    const rawPoster = /<img\b[^>]*\bdata-src=["']([^"']+)["']/i.exec(
      match[3],
    )?.[1];
    if (rawPoster) {
      try {
        const image = new URL(rawPoster, source);
        if (
          image.protocol === 'https:' &&
          image.hostname === 'tkfile.yes24.com' &&
          image.pathname.startsWith('/upload2/PerfBlog/')
        )
          candidate.posterUrl = image.toString();
      } catch {
        /* Ignore malformed poster URLs. */
      }
    }
    const previous = candidates.get(candidate.url);
    if (
      !previous ||
      Object.keys(candidate).length > Object.keys(previous).length
    )
      candidates.set(candidate.url, candidate);
    if (candidates.size >= 100) break;
  }
  return [...candidates.values()];
}

export function ticketCandidates(
  body: string,
  base: string,
  config: Record<string, string> = {},
): FestivalCandidate[] {
  const seoulCultureLineup = seoulCultureLineupCandidates(body, base, config);
  if (seoulCultureLineup) return seoulCultureLineup;
  const officialLineup = officialLineupCandidates(body, base, config);
  if (officialLineup) return officialLineup;
  const xmfNotice = xmfNoticeCandidates(body, base);
  if (xmfNotice) return xmfNotice;
  const mintPaper = mintPaperCandidates(body, base);
  if (mintPaper) return mintPaper;
  const melonSearch = melonSearchCandidates(body, base);
  if (melonSearch) return melonSearch;
  const melonDetail = melonDetailCandidates(body, base);
  if (melonDetail) return melonDetail;
  const yes24Detail = yes24DetailCandidates(body, base);
  if (yes24Detail) return yes24Detail;
  const nolDetail = nolDetailCandidates(body, base);
  if (nolDetail) return nolDetail;
  const melon = melonFestivalCandidates(body, base);
  if (melon) return melon;
  const yes24 = yes24FestivalCandidates(body, base);
  if (yes24) return yes24;
  const yes24Cards = [
    ...body.matchAll(
      /<li\b[^>]*class=["'][^"']*\bconlist\b[^"']*["'][^>]*>[\s\S]*?<\/ul>\s*<\/li>/gi,
    ),
  ].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    html: match[0],
  }));
  const cards = [
    ...yes24Cards,
    ...[...body.matchAll(/<(li|article)\b[^>]*>[\s\S]*?<\/\1>/gi)].map(
      (match) => ({
        start: match.index,
        end: match.index + match[0].length,
        html: match[0],
      }),
    ),
  ];
  const candidates = new Map<string, FestivalCandidate>();
  const sourceUrl = new URL(base);
  for (const match of body.matchAll(
    /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    let url: URL;
    try {
      url = new URL(match[2], base);
    } catch {
      continue;
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.origin === sourceUrl.origin &&
        url.pathname === sourceUrl.pathname &&
        url.search === sourceUrl.search)
    )
      continue;
    url.hash = '';
    canonicalNolProductUrl(url);
    const card =
      cards.find((item) => match.index >= item.start && match.index < item.end)
        ?.html ?? match[0];
    const name = festivalTitle(match[4], card, match[1] + match[3]);
    const yes24Festival =
      sourceUrl.hostname === 'ticket.yes24.com' &&
      /<span>\s*Genre\s*<\/span>\s*:\s*\[Festival\]/i.test(card) &&
      !/(?:\bconcert\b|콘서트)/i.test(name);
    if (!isFestivalTitle(name) && !yes24Festival) continue;
    const date =
      classText(card, 'date|period|schedule') ||
      /<span>\s*Date\/Time\s*<\/span>\s*:\s*([^<]+)/i.exec(card)?.[1]?.trim() ||
      DATE_TEXT.exec(plainText(card))?.[0];
    const venue =
      classText(card, 'venue|place|location') ||
      /<span>\s*Venue\s*<\/span>\s*:\s*([^<]+)/i.exec(card)?.[1]?.trim();
    const entry: FestivalCandidate = { name, url: url.toString() };
    if (date) entry.date = date;
    if (venue) entry.venue = venue;
    const previous = candidates.get(entry.url);
    if (!previous || Object.keys(entry).length > Object.keys(previous).length)
      candidates.set(entry.url, entry);
    if (candidates.size >= 100) break;
  }
  // Some ticket listings serialize product cards without anchors. NOL dateInfo
  // can also be the ticket opening time, so accept only complete calendar dates.
  const pageData = body.replace(/\\"/g, '"');
  for (const match of pageData.matchAll(
    /"action":\{[^{}]{0,500}?"web":"([^"]+)"\}[^{}]{0,1000}?"title":"([^"]+)"([^{}]{0,500})/g,
  )) {
    let url: URL;
    try {
      url = new URL(match[1], base);
    } catch {
      continue;
    }
    const name = match[2].trim();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !isFestivalTitle(name)
    )
      continue;
    url.hash = '';
    canonicalNolProductUrl(url);
    const entry: FestivalCandidate = { name, url: url.toString() };
    if (
      sourceUrl.hostname === 'nol.yanolja.com' &&
      url.hostname === 'nol.yanolja.com' &&
      /^\/ticket\/products\/\d+$/.test(url.pathname)
    ) {
      const productId = url.pathname.split('/').at(-1);
      const thumbnail = /"thumbnail":"([^"]{1,500})"/.exec(match[0])?.[1];
      if (thumbnail && productId) {
        try {
          const image = new URL(thumbnail);
          const posterProductId =
            /^\/Play\/image\/large\/\d+\/(\d+)_p\.(?:gif|jpe?g|png|webp)$/i.exec(
              image.pathname,
            )?.[1];
          if (
            image.protocol === 'https:' &&
            image.hostname === 'ticketimage.interpark.com' &&
            posterProductId === productId
          )
            entry.posterUrl = image.toString();
        } catch {
          /* Ignore malformed card thumbnails. */
        }
      }
      const dateInfo = /"dateInfo":"([^"]{1,80})"/.exec(match[3])?.[1];
      const date = dateInfo && nolEventDate(dateInfo);
      if (date) entry.date = date;
      const location = /"locationDetails":\["([^"]{1,160})"\]/
        .exec(match[3])?.[1]
        ?.trim();
      if (location && !/[<>\\]/.test(location)) entry.venue = location;
    }
    const previous = candidates.get(entry.url);
    if (!previous || Object.keys(entry).length > Object.keys(previous).length)
      candidates.set(entry.url, entry);
    if (candidates.size >= 100) break;
  }
  return [...candidates.values()];
}

export async function parseCrawl(
  source: CrawlSource,
  body: string,
): Promise<unknown> {
  const config = source.parserConfig;
  if (source.parser === 'html-text') {
    const text = plainText(body).slice(0, 10000);
    if (!text) throw new Error('파싱 결과가 비었습니다.');
    return text;
  }
  if (source.parser === 'html-table') {
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) =>
        [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
          (cell) => plainText(cell[1]),
        ),
      )
      .filter((cells) => cells.length);
    if (!rows.length) throw new Error('타임테이블 행을 찾지 못했습니다.');
    if (source.kind !== 'timetable') return rows;
    const date = config.date;
    const stageId = config.stageId;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !stageId) {
      throw new Error(
        '타임테이블 파서는 parserConfig.date/stageId가 필요합니다.',
      );
    }
    const artistIndex = Number(config.artistColumn ?? 0);
    const startIndex = Number(config.startColumn ?? 1);
    const endIndex = Number(config.endColumn ?? 2);
    const time = (value: string) => {
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(value))
        throw new Error(`시간 형식 오류: ${value}`);
      return `${date}T${value.padStart(5, '0')}:00+09:00`;
    };
    const sets = rows
      .filter((row) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(row[startIndex] ?? ''))
      .map((row) => {
        const artist = row[artistIndex];
        if (!artist) throw new Error('아티스트명이 비었습니다.');
        const id =
          'set_' +
          createHash('sha256')
            .update(`${stageId}:${date}:${artist}`)
            .digest('hex')
            .slice(0, 10);
        return {
          id,
          stageId,
          artist,
          startsAt: time(row[startIndex]),
          endsAt: time(row[endIndex]),
          note: null,
        };
      });
    if (!sets.length) throw new Error('유효한 공연 행이 없습니다.');
    return sets;
  }
  if (source.parser === 'regex-days') {
    const pattern = config.pattern;
    if (!pattern || pattern.length > 500)
      throw new Error('parserConfig.pattern(500자 이하)이 필요합니다.');
    const groups = await matchDaysPattern(
      pattern,
      plainText(body).slice(0, 5000),
    );
    if (!groups?.date || !groups.startsAt || !groups.endsAt) {
      throw new Error('date/startsAt/endsAt 이름 캡처를 찾지 못했습니다.');
    }
    return {
      date: groups.date,
      startsAt: groups.startsAt,
      endsAt: groups.endsAt,
    };
  }
  if (source.parser === 'ticket-list') {
    const links = ticketCandidates(body, source.url, config);
    if (!links.length) throw new Error('공개 예매 링크를 찾지 못했습니다.');
    return links;
  }
  throw new Error(
    `파서 ${source.parser}는 OCR 서비스 연동 전까지 사용할 수 없습니다.`,
  );
}
