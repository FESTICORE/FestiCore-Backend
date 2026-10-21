import { createHash } from 'node:crypto';

interface DateRange {
  firstDate: string;
  lastDate: string;
}

export interface DiscoveryRow {
  candidate: unknown;
  decision?: string;
  proposalStatus?: string;
}

export interface PublishedDiscoveryRow {
  name: string | null;
  venue: string | null;
  firstDate: string | null;
  lastDate: string | null;
  sourceUrl: string | null;
}

export interface DiscoverySummary {
  id: string;
  name: string;
  venue: string;
  firstDate: string;
  lastDate: string;
  packVersion: 0;
  flagsEnabled: false;
  thumbUrl: null;
  status: 'discovered';
  sourceUrl: string;
  sortAt: string;
}

const months: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function date(year: number, month: number, day: number): string | null {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  )
    return null;
  return parsed.toISOString().slice(0, 10);
}

export function ticketDateRange(raw: unknown): DateRange | null {
  if (typeof raw !== 'string') return null;
  const korean = raw
    .trim()
    .match(
      /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s*[-~–]\s*(\d{4})[./-](\d{1,2})[./-](\d{1,2}))?$/,
    );
  let first: string | null = null;
  let last: string | null = null;
  if (korean) {
    first = date(Number(korean[1]), Number(korean[2]), Number(korean[3]));
    last = korean[4]
      ? date(Number(korean[4]), Number(korean[5]), Number(korean[6]))
      : first;
  } else {
    const english = raw
      .trim()
      .match(
        /^([A-Za-z]{3})\s+(\d{1,2})(?:\s*[-~–]\s*(\d{1,2}))?,?\s+(\d{4})$/,
      );
    if (!english) return null;
    const month = months[english[1].toLowerCase()];
    if (!month) return null;
    first = date(Number(english[4]), month, Number(english[2]));
    last = english[3]
      ? date(Number(english[4]), month, Number(english[3]))
      : first;
  }
  if (!first || !last || last < first) return null;
  const span =
    (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
    86_400_000;
  if (span > 6) return null;
  return { firstDate: first, lastDate: last };
}

function cleanName(name: string): string {
  return name.replace(/\s*[-–]\s*(?:슈퍼)?얼리버드\s*$/i, '').trim();
}

function candidateKey(name: string, venue: string, dates: DateRange): string {
  return `${cleanName(name).toLowerCase()}|${venue.trim().toLowerCase()}|${dates.firstDate}|${dates.lastDate}`;
}

export function discoverySummaries(
  rows: DiscoveryRow[],
  published: PublishedDiscoveryRow[] = [],
): DiscoverySummary[] {
  // The query supplies only the newest proposal for each ticket URL.
  const byUrl = new Map<string, DiscoveryRow>();
  for (const row of rows) {
    if (
      !row.candidate ||
      typeof row.candidate !== 'object' ||
      Array.isArray(row.candidate)
    )
      continue;
    const url = (row.candidate as Record<string, unknown>).url;
    if (typeof url === 'string' && !byUrl.has(url)) byUrl.set(url, row);
  }
  const publishedKeys = new Set<string>();
  for (const row of published) {
    if (row.name && row.venue && row.firstDate && row.lastDate) {
      publishedKeys.add(
        candidateKey(row.name, row.venue, {
          firstDate: row.firstDate,
          lastDate: row.lastDate,
        }),
      );
    }
    const source = row.sourceUrl ? byUrl.get(row.sourceUrl)?.candidate : null;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const value = source as Record<string, unknown>;
      const dates = ticketDateRange(value.date);
      if (
        typeof value.name === 'string' &&
        typeof value.venue === 'string' &&
        dates
      )
        publishedKeys.add(candidateKey(value.name, value.venue, dates));
    }
  }
  const found = new Map<string, DiscoverySummary>();
  for (const { candidate, decision, proposalStatus } of byUrl.values()) {
    if (decision === 'rejected' || proposalStatus === 'rejected') continue;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      continue;
    const value = candidate as Record<string, unknown>;
    if (
      typeof value.name !== 'string' ||
      typeof value.venue !== 'string' ||
      typeof value.url !== 'string' ||
      value.name.length < 1 ||
      value.name.length > 160 ||
      value.venue.length < 1 ||
      value.venue.length > 160
    )
      continue;
    const dates = ticketDateRange(value.date);
    if (!dates) continue;
    let url: URL;
    try {
      url = new URL(value.url);
    } catch {
      continue;
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['ticket.melon.com', 'ticket.yes24.com', 'nol.yanolja.com'].includes(
        url.hostname,
      )
    )
      continue;
    const name = cleanName(value.name);
    const key = candidateKey(name, value.venue, dates);
    if (found.has(key) || publishedKeys.has(key)) continue;
    const id = `fst_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    found.set(key, {
      id,
      name,
      venue: value.venue.trim(),
      ...dates,
      packVersion: 0,
      flagsEnabled: false,
      thumbUrl: null,
      status: 'discovered',
      sourceUrl: url.toString(),
      // 정렬 전용 날짜 하한. 실제 공연 시작 시각으로 반환하지 않는다.
      sortAt: `${dates.firstDate}T00:00:00+09:00`,
    });
  }
  return [...found.values()];
}
