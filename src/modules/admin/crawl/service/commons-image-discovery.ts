import { checkedUrl } from './crawl-fetch';

export const COMMONS_DISCOVERY_URL =
  'https://api.wikimedia.org/core/v1/commons/search/page';
export const COMMONS_DISCOVERY_SEED = 'commons-image-discovery-v1';
export const MAX_COMMONS_TARGETS = 40;
export const MAX_COMMONS_CANDIDATES = 2;
export const MAX_COMMONS_SEARCH_RESULTS = 20;

export interface CommonsDiscoveryCandidate {
  status: 'pending';
  fileId: number;
  fileTitle: string;
  filePageUrl: string;
  originalUrl: string;
  mimeType: string;
  byteSize: number | null;
  author: null;
  license: null;
  licenseUrl: null;
  rightsStatus: 'unverified';
}

export interface CommonsDiscoveryTarget {
  festivalId: string;
  festivalSourceUrl: string;
  artistName: string;
  status: 'candidates' | 'no-results' | 'failed';
  candidates: CommonsDiscoveryCandidate[];
  httpStatus?: number;
  error?:
    | 'SEARCH_HTTP'
    | 'SEARCH_RESPONSE'
    | 'FILE_HTTP'
    | 'FILE_RESPONSE'
    | 'NETWORK';
}

export interface CommonsDiscoveryEvidence {
  totalMissing: number;
  deferredCount: number;
  targets: CommonsDiscoveryTarget[];
}

type SearchFile = {
  id: number;
  key: string;
  title: string;
  mimeType: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function commonsSearchUrl(artistName: string): URL {
  if (!artistName.trim() || artistName.length > 160)
    throw new Error('INVALID_ARTIST');
  const url = new URL(COMMONS_DISCOVERY_URL);
  url.searchParams.set('q', `${artistName} filetype:bitmap`);
  url.searchParams.set('limit', String(MAX_COMMONS_SEARCH_RESULTS));
  return url;
}

export function commonsFileUrl(key: string): URL {
  if (!/^File:[^/?#]{1,250}$/u.test(key)) throw new Error('INVALID_FILE_KEY');
  return new URL(
    `https://api.wikimedia.org/core/v1/commons/file/${encodeURIComponent(key)}`,
  );
}

export function parseCommonsSearch(body: string): SearchFile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('SEARCH_RESPONSE');
  }
  const pages = record(parsed)?.pages;
  if (!Array.isArray(pages) || pages.length > MAX_COMMONS_SEARCH_RESULTS)
    throw new Error('SEARCH_RESPONSE');
  return pages
    .flatMap((item: unknown) => {
      const page = record(item);
      const thumb = record(page?.thumbnail);
      if (
        !page ||
        !Number.isSafeInteger(page.id) ||
        typeof page.key !== 'string' ||
        typeof page.title !== 'string'
      )
        throw new Error('SEARCH_RESPONSE');
      if (
        !thumb ||
        typeof thumb.mimetype !== 'string' ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(thumb.mimetype)
      )
        return [];
      try {
        commonsFileUrl(page.key);
      } catch {
        return [];
      }
      return [
        {
          id: page.id as number,
          key: page.key,
          title: page.title,
          mimeType: thumb.mimetype,
        },
      ];
    })
    .slice(0, MAX_COMMONS_CANDIDATES);
}

export function parseCommonsFile(
  body: string,
  file: SearchFile,
): CommonsDiscoveryCandidate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('FILE_RESPONSE');
  }
  const entry = record(parsed);
  const original = record(entry?.original);
  if (
    !entry ||
    entry.title !== file.key.slice(5).replaceAll('_', ' ') ||
    original?.mediatype !== 'BITMAP' ||
    typeof original.url !== 'string' ||
    typeof entry.file_description_url !== 'string'
  )
    throw new Error('FILE_RESPONSE');
  const origin = checkedUrl(original.url);
  // Core REST exposes only a broad original mediatype. Derive the MIME from
  // the original file extension, never from its potentially converted thumbnail.
  const extension = origin.pathname
    .match(/\.([a-z0-9]+)$/i)?.[1]
    ?.toLowerCase();
  const fileExtension = file.key.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const mimeType =
    extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : null;
  if (
    !entry.file_description_url.startsWith('//commons.wikimedia.org/wiki/File:')
  )
    throw new Error('FILE_RESPONSE');
  const filePage = checkedUrl(`https:${entry.file_description_url}`);
  if (
    origin.hostname !== 'upload.wikimedia.org' ||
    !mimeType ||
    fileExtension !== extension ||
    filePage.hostname !== 'commons.wikimedia.org' ||
    !filePage.pathname.startsWith('/wiki/File:')
  )
    throw new Error('FILE_RESPONSE');
  const byteSize = original.size;
  if (
    byteSize !== null &&
    (!Number.isSafeInteger(byteSize) || (byteSize as number) < 0)
  )
    throw new Error('FILE_RESPONSE');
  return {
    status: 'pending',
    fileId: file.id,
    fileTitle: file.title,
    filePageUrl: filePage.href,
    originalUrl: origin.href,
    mimeType,
    byteSize: typeof byteSize === 'number' ? byteSize : null,
    author: null,
    license: null,
    licenseUrl: null,
    rightsStatus: 'unverified',
  };
}

export function dailyCommonsTargets<T>(
  targets: T[],
  date: string,
): { selected: T[]; deferredCount: number } {
  if (!targets.length) return { selected: [], deferredCount: 0 };
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const offset = (day * MAX_COMMONS_TARGETS) % targets.length;
  const rotated = [...targets.slice(offset), ...targets.slice(0, offset)];
  return {
    selected: rotated.slice(0, MAX_COMMONS_TARGETS),
    deferredCount: Math.max(0, targets.length - MAX_COMMONS_TARGETS),
  };
}
