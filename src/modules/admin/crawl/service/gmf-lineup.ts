import { normalizeArtistName } from '../../../../common/artist-name';
import { checkedUrl } from './crawl-fetch';

export const GMF_LINEUP_URL =
  'https://www.mintpaper.co.kr/festivals/172/lineup';
export const GMF_NOTICE_URL =
  'https://www.mintpaper.co.kr/festivals/172/notice/4802';
export const GMF_FESTIVAL_URL = 'https://mintpaper.co.kr/festivals/172';
export const GMF_IMAGE_ORIGIN =
  'https://mintpaper.s3.ap-northeast-2.amazonaws.com';

export interface GmfArtistImage {
  artistName: string;
  imageUrl: URL;
}

function apolloData(body: string): Record<string, unknown> {
  if (Buffer.byteLength(body, 'utf8') > 2_000_000)
    throw new Error('GMF 공식 페이지 크기 제한을 초과했습니다.');
  const match =
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      body,
    );
  if (!match) throw new Error('GMF 공식 페이지 데이터가 없습니다.');
  try {
    const payload = JSON.parse(match[1]) as {
      props?: { apolloState?: { data?: Record<string, unknown> } };
    };
    const data = payload.props?.apolloState?.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    // Report invalid data with one stable error to callers.
  }
  throw new Error('GMF 공식 페이지 데이터를 해석하지 못했습니다.');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: string): string {
  const entities: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
  };
  return value
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(nbsp|amp|quot|apos|lt|gt);/gi,
      (_match, name: string) => entities[name.toLowerCase()],
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, value: string) => {
      const codePoint =
        value[0].toLowerCase() === 'x'
          ? Number.parseInt(value.slice(1), 16)
          : Number(value);
      return codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
}

function instagramHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = checkedUrl(raw.replace(/&amp;/gi, '&'));
    if (!['www.instagram.com', 'instagram.com'].includes(url.hostname))
      return null;
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length === 1 && /^[a-z0-9._]{1,30}$/i.test(segments[0])
      ? segments[0].toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function noticeArtists(body: string) {
  const post = record(apolloData(body)['Post:4802']);
  if (typeof post?.content !== 'string')
    throw new Error('GMF 공식 공지 본문이 없습니다.');
  const rows: { name: string; handles: string[] }[] = [];
  for (const line of post.content.split(/<br\s*\/?>/i)) {
    const nameMarkup = /<span\b[^>]*>([^<]+)<\/span>/i.exec(line)?.[1];
    if (!nameMarkup) continue;
    const name = text(nameMarkup);
    if (!name || name.length > 160) continue;
    const handles = [...line.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)]
      .map((match) => instagramHandle(match[1]))
      .filter((handle): handle is string => !!handle);
    rows.push({ name, handles });
  }
  return rows;
}

function thumbnailArtistNames(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const match =
    /^thumbnail_GMF2026_아티개별_(?:[1-9]차_)?[토일]_(.+)\.jpe?g$/i.exec(value);
  if (!match) return [];
  const original = text(match[1].replace(/\(edit\)$/i, ''));
  return [...new Set([original, original.replace(/_2$/, '')])];
}

export function parseGmfLineup(
  lineupBody: string,
  noticeBody: string,
): GmfArtistImage[] {
  const data = apolloData(lineupBody);
  const festival = record(data['Festival:172']);
  if (!Array.isArray(festival?.lineup))
    throw new Error('GMF 공식 라인업 카드가 없습니다.');
  const notice = noticeArtists(noticeBody);
  const entries: GmfArtistImage[] = [];
  const usedNames = new Set<string>();
  const usedImages = new Set<string>();
  for (const group of festival.lineup) {
    const banners = record(group)?.banners;
    if (!Array.isArray(banners))
      throw new Error('GMF 공식 카드 그룹이 잘못되었습니다.');
    for (const bannerValue of banners) {
      const banner = record(bannerValue);
      const imageRef = record(banner?.image)?.__ref;
      const upload =
        typeof imageRef === 'string' ? record(data[imageRef]) : null;
      if (typeof upload?.url !== 'string')
        throw new Error('GMF 공식 카드 이미지 참조가 잘못되었습니다.');
      let imageUrl: URL;
      try {
        imageUrl = checkedUrl(upload.url);
      } catch {
        throw new Error('GMF 공식 카드 이미지 URL이 잘못되었습니다.');
      }
      if (
        imageUrl.origin !== GMF_IMAGE_ORIGIN ||
        !/^\/GMF_2026_[a-zA-Z0-9_]+\.jpe?g$/.test(imageUrl.pathname) ||
        imageUrl.search ||
        imageUrl.hash ||
        usedImages.has(imageUrl.href)
      )
        throw new Error('GMF 공식 카드 이미지 출처가 잘못되거나 중복됩니다.');
      const handle = instagramHandle(banner?.link);
      let matches = handle
        ? notice.filter((row) => row.handles.includes(handle))
        : [];
      if (!matches.length && !handle) {
        const thumbnails = thumbnailArtistNames(
          record(record(upload.formats)?.thumbnail)?.name,
        );
        matches = notice.filter((row) =>
          thumbnails.some(
            (thumbnail) =>
              normalizeArtistName(row.name.replace(/\s*\([^)]*\)$/, '')) ===
              normalizeArtistName(thumbnail),
          ),
        );
      }
      if (matches.length !== 1)
        throw new Error(
          'GMF 카드와 공식 공지 출연진을 유일하게 연결하지 못했습니다.',
        );
      const artistName = matches[0].name;
      const key = normalizeArtistName(artistName);
      if (!key || usedNames.has(key))
        throw new Error('GMF 공식 카드에 중복 출연진이 있습니다.');
      usedNames.add(key);
      usedImages.add(imageUrl.href);
      entries.push({ artistName, imageUrl });
    }
  }
  if (entries.length < 48 || entries.length > 100)
    throw new Error(
      `GMF 공식 라인업 최소 48개를 확인하지 못했습니다: ${entries.length}개`,
    );
  return entries;
}
