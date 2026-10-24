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
  thumbUrl: string | null;
  ticketLinks: { label: string; url: string }[];
  status: 'discovered';
  sourceUrl: string;
  officialInstagramUrl?: string;
  posterUrl?: string;
  artists?: {
    name: string;
    sourceUrl?: string;
    profileUrl?: string;
    imageUrl?: string | null;
  }[];
  sortAt: string;
}

function ticketLabel(hostname: string): string {
  return (
    {
      'ticket.melon.com': '멜론티켓',
      'ticket.yes24.com': '예스24',
      'nol.yanolja.com': 'NOL',
      'mintpaper.co.kr': '공식 사이트',
    }[hostname] ?? '공식 사이트'
  );
}

function officialInstagramUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      !['www.instagram.com', 'instagram.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      !/^\/[A-Za-z0-9._]+\/?$/.test(url.pathname)
    )
      return null;
    return `https://www.instagram.com${url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`}`;
  } catch {
    return null;
  }
}

function officialPosterUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    const trusted =
      url.hostname === 'mintpaper.s3.ap-northeast-2.amazonaws.com' ||
      (url.hostname === 'tkfile.yes24.com' &&
        url.pathname.startsWith('/upload2/PerfBlog/')) ||
      (url.hostname === 'cdnticket.melon.co.kr' &&
        url.pathname.startsWith('/resource/image/upload/product/')) ||
      (url.hostname === 'ticketimage.interpark.com' &&
        /^\/Play\/image\/large\/\d+\/\d+_p\.(?:gif|jpe?g|png|webp)$/i.test(
          url.pathname,
        ));
    return url.protocol === 'https:' &&
      trusted &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function verifiedArtists(
  raw: unknown,
  sourceUrl: string,
): { name: string; sourceUrl?: string; profileUrl?: string }[] {
  if (!Array.isArray(raw)) return [];
  const sourceHost = new URL(sourceUrl).hostname;
  const artists: {
    name: string;
    sourceUrl?: string;
    profileUrl?: string;
  }[] = [];
  for (const value of raw.slice(0, 80)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const name = (value as Record<string, unknown>).name;
    if (typeof name !== 'string' || !name.trim() || name.length > 160) continue;
    const artist: {
      name: string;
      sourceUrl?: string;
      profileUrl?: string;
    } = { name: name.trim() };
    if (sourceUrl === 'https://www.mintpaper.co.kr/posts/4819') {
      const profile = officialInstagramUrl(
        (value as Record<string, unknown>).profileUrl,
      );
      if (profile) artist.profileUrl = profile;
    }
    const rawUrl = (value as Record<string, unknown>).sourceUrl;
    if (typeof rawUrl === 'string') {
      try {
        const url = new URL(rawUrl);
        const trusted =
          (sourceHost === 'ticket.melon.com' &&
            url.hostname === 'cdnimg.melon.co.kr') ||
          (sourceHost === 'ticket.yes24.com' &&
            ['tkfile.yes24.com', 'stkfile.yes24.com'].includes(url.hostname)) ||
          (sourceHost === 'nol.yanolja.com' &&
            url.hostname === 'ticketimage.interpark.com');
        if (
          url.protocol === 'https:' &&
          trusted &&
          !url.username &&
          !url.password &&
          !url.port
        )
          artist.sourceUrl = url.toString();
      } catch {
        /* Ignore malformed artist image URLs. */
      }
    }
    artists.push(artist);
  }
  return artists;
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
      /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s*[-~–]\s*(?:(\d{4})[./-])?(\d{1,2})[./-](\d{1,2}))?$/,
    );
  let first: string | null = null;
  let last: string | null = null;
  if (korean) {
    first = date(Number(korean[1]), Number(korean[2]), Number(korean[3]));
    const endYear = korean[4]
      ? Number(korean[4])
      : Number(korean[1]) +
        (korean[5] && Number(korean[5]) < Number(korean[2]) ? 1 : 0);
    last = korean[5]
      ? date(endYear, Number(korean[5]), Number(korean[6]))
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
    if (typeof url !== 'string') continue;
    const existing = byUrl.get(url);
    if (!existing) {
      byUrl.set(url, row);
      continue;
    }
    if (row.decision === 'rejected' || row.proposalStatus === 'rejected')
      continue;
    const account = officialInstagramUrl(
      (row.candidate as Record<string, unknown>).officialInstagramUrl,
    );
    const poster = officialPosterUrl(
      (row.candidate as Record<string, unknown>).posterUrl,
    );
    if (existing.candidate && typeof existing.candidate === 'object') {
      const first = existing.candidate as Record<string, unknown>;
      const additions = {
        ...(account && !officialInstagramUrl(first.officialInstagramUrl)
          ? { officialInstagramUrl: account }
          : {}),
        ...(poster && !officialPosterUrl(first.posterUrl)
          ? { posterUrl: poster }
          : {}),
      };
      if (Object.keys(additions).length)
        byUrl.set(url, {
          ...existing,
          candidate: { ...first, ...additions },
        });
    }
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
      ![
        'ticket.melon.com',
        'ticket.yes24.com',
        'nol.yanolja.com',
        'mintpaper.co.kr',
      ].includes(url.hostname)
    )
      continue;
    const name = cleanName(value.name);
    const key = candidateKey(name, value.venue, dates);
    if (publishedKeys.has(key)) continue;
    const instagramUrl = officialInstagramUrl(value.officialInstagramUrl);
    const posterUrl = officialPosterUrl(value.posterUrl);
    const artists = verifiedArtists(
      value.artists,
      typeof value.artistSourceUrl === 'string'
        ? value.artistSourceUrl
        : url.toString(),
    );
    const existing = found.get(key);
    if (existing) {
      if (
        existing.ticketLinks.length < 5 &&
        !existing.ticketLinks.some((link) => link.url === url.toString())
      )
        existing.ticketLinks.push({
          label: ticketLabel(url.hostname),
          url: url.toString(),
        });
      if (instagramUrl && !existing.officialInstagramUrl)
        existing.officialInstagramUrl = instagramUrl;
      if (
        instagramUrl &&
        existing.ticketLinks.length < 5 &&
        !existing.ticketLinks.some((link) => link.url === instagramUrl)
      )
        existing.ticketLinks.push({
          label: '공식 인스타그램',
          url: instagramUrl,
        });
      if (posterUrl && !existing.posterUrl) existing.posterUrl = posterUrl;
      if (artists.length) {
        const merged = new Map(
          existing.artists?.map((artist) => [artist.name, artist]) ?? [],
        );
        for (const artist of artists) {
          const current = merged.get(artist.name);
          if (current) {
            if (!current.sourceUrl && artist.sourceUrl)
              current.sourceUrl = artist.sourceUrl;
            if (!current.profileUrl && artist.profileUrl)
              current.profileUrl = artist.profileUrl;
          } else if (merged.size < 80) merged.set(artist.name, artist);
        }
        existing.artists = [...merged.values()];
      }
      continue;
    }
    const id = `fst_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    found.set(key, {
      id,
      name,
      venue: value.venue.trim(),
      ...dates,
      packVersion: 0,
      flagsEnabled: false,
      thumbUrl: null,
      ticketLinks: [
        { label: ticketLabel(url.hostname), url: url.toString() },
        ...(instagramUrl
          ? [{ label: '공식 인스타그램', url: instagramUrl }]
          : []),
      ],
      status: 'discovered',
      sourceUrl: url.toString(),
      ...(instagramUrl ? { officialInstagramUrl: instagramUrl } : {}),
      ...(posterUrl ? { posterUrl } : {}),
      ...(artists.length ? { artists } : {}),
      // 정렬 전용 날짜 하한. 실제 공연 시작 시각으로 반환하지 않는다.
      sortAt: `${dates.firstDate}T00:00:00+09:00`,
    });
  }
  return [...found.values()];
}
