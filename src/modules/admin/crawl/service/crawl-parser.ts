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
};

const FESTIVAL_TITLE = /(?:페스티벌|축제|festival|\bfest\b)/i;
const GENERIC_TITLE =
  /^(?:페스티벌|축제|festival|fest|예매하기|상세보기|더보기|티켓)$/i;
const FESTIVAL_GROUP_NAME = /(?:페스티벌|festival)\s*(?:오케스트라|orchestra)/i;
const DATE_TEXT =
  /\b20\d{2}[.\-/]\s?(?:0?[1-9]|1[0-2])[.\-/]\s?(?:[0-2]?\d|3[01])(?:\s?[-~–]\s?(?:(?:20\d{2})[.\-/]\s?)?(?:0?[1-9]|1[0-2])[.\-/]\s?(?:[0-2]?\d|3[01]))?/;

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
    source.pathname !== '/performance/ajax/prodList.json'
  )
    return null;
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
      !isFestivalTitle(name) ||
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

function ticketCandidates(body: string, base: string): FestivalCandidate[] {
  const melon = melonFestivalCandidates(body, base);
  if (melon) return melon;
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
  // Some ticket listings render cards without anchors and serialize the product
  // action in their page data. dateInfo is often the ticket opening time, so it
  // must not be presented as the festival date.
  const pageData = body.replace(/\\"/g, '"');
  for (const match of pageData.matchAll(
    /"action":\{[^{}]{0,500}?"web":"([^"]+)"\}[^{}]{0,1000}?"title":"([^"]+)"/g,
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
    if (!candidates.has(url.toString()))
      candidates.set(url.toString(), { name, url: url.toString() });
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
    const links = ticketCandidates(body, source.url);
    if (!links.length) throw new Error('공개 예매 링크를 찾지 못했습니다.');
    return links;
  }
  throw new Error(
    `파서 ${source.parser}는 OCR 서비스 연동 전까지 사용할 수 없습니다.`,
  );
}
