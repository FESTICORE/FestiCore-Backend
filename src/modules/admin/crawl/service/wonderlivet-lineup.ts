import { normalizeArtistName } from '../../../../common/artist-name';
import { checkedUrl } from './crawl-fetch';

export const WONDERLIVET_LINEUP_URL =
  'https://www.wonderli.vet/api/trpc/lineup.list';
export const WONDERLIVET_FESTIVAL_URL = 'https://www.wonderli.vet/lineup';
export const WONDERLIVET_IMAGE_ORIGIN =
  'https://mcnqglozya2x8j6x.public.blob.vercel-storage.com';

export interface WonderlivetArtist {
  artistName: string;
  imageUrl: URL;
}

export function parseWonderlivetLineup(body: string): WonderlivetArtist[] {
  if (Buffer.byteLength(body, 'utf8') > 2_000_000)
    throw new Error('공식 라인업 응답 크기 제한을 초과했습니다.');
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('공식 라인업 JSON을 해석하지 못했습니다.');
  }
  const json = (payload as { result?: { data?: { json?: unknown } } })?.result
    ?.data?.json as
    | { dataState?: unknown; isComingSoon?: unknown; artists?: unknown }
    | undefined;
  if (
    json?.dataState !== 'ready' ||
    json.isComingSoon !== false ||
    !Array.isArray(json.artists) ||
    !json.artists.length ||
    json.artists.length > 100
  )
    throw new Error('공식 라인업이 완전한 게시 상태가 아닙니다.');

  const entries: WonderlivetArtist[] = [];
  const names = new Set<string>();
  for (const row of json.artists as unknown[]) {
    if (!row || typeof row !== 'object')
      throw new Error('공식 라인업 출연진 형식이 올바르지 않습니다.');
    const artist = row as Record<string, unknown>;
    if (typeof artist.isPublished !== 'boolean')
      throw new Error('공식 라인업 게시 상태가 없습니다.');
    if (!artist.isPublished) continue;
    const name = artist.name;
    const day = artist.performanceDay;
    const rawImage = artist.imageUrl;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 160 ||
      [...name].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }) ||
      !['DAY1', 'DAY2', 'DAY3'].includes(String(day)) ||
      typeof rawImage !== 'string'
    )
      throw new Error('공식 라인업 출연진 정보가 불완전합니다.');
    const canonicalName = name.normalize('NFC').trim().replace(/\s+/g, ' ');
    const key = normalizeArtistName(canonicalName);
    if (!key || names.has(key))
      throw new Error('공식 라인업에 중복 출연진 이름이 있습니다.');
    let imageUrl: URL;
    try {
      imageUrl = checkedUrl(rawImage);
    } catch {
      throw new Error('공식 라인업 이미지 URL이 올바르지 않습니다.');
    }
    if (
      imageUrl.origin !== WONDERLIVET_IMAGE_ORIGIN ||
      !new RegExp(
        `^/lineup/artists/production/live/${String(day).toLowerCase()}/[a-z0-9-]{1,110}\\.webp$`,
      ).test(imageUrl.pathname) ||
      imageUrl.search ||
      imageUrl.hash
    )
      throw new Error('공식 라인업 이미지 출처가 올바르지 않습니다.');
    names.add(key);
    entries.push({ artistName: canonicalName, imageUrl });
  }
  if (!entries.length)
    throw new Error('게시된 공식 라인업 출연진을 확인하지 못했습니다.');
  return entries;
}
