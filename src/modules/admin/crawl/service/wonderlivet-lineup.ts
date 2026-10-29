import { normalizeArtistName } from '../../../../common/artist-name';
import { checkedUrl } from './crawl-fetch';
import { imageTagAttributes } from './image-tag-attributes';

export const WONDERLIVET_LINEUP_URL = 'https://www.wonderli.vet/lineup';
export const WONDERLIVET_FESTIVAL_URL = 'https://www.wonderli.vet/lineup';
export const WONDERLIVET_IMAGE_ORIGIN =
  'https://mcnqglozya2x8j6x.public.blob.vercel-storage.com';

export interface WonderlivetArtist {
  artistName: string;
  imageUrl: URL;
}

export function wonderlivetBundleUrl(html: string): URL {
  if (Buffer.byteLength(html, 'utf8') > 2_000_000)
    throw new Error('공식 라인업 페이지 크기 제한을 초과했습니다.');
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map(([tag]) => ({
      src: imageTagAttributes(tag, ['src']),
      type: imageTagAttributes(tag, ['type']),
    }))
    .filter(({ type }) => type.length === 1 && type[0] === 'module');
  if (scripts.length !== 1 || scripts[0].src.length !== 1)
    throw new Error('공식 라인업 번들 연결을 확인하지 못했습니다.');
  let url: URL;
  try {
    url = checkedUrl(new URL(scripts[0].src[0], WONDERLIVET_LINEUP_URL).href);
  } catch {
    throw new Error('공식 라인업 번들 URL이 올바르지 않습니다.');
  }
  if (
    url.origin !== 'https://www.wonderli.vet' ||
    !/^\/assets\/index-[A-Za-z0-9_-]{6,40}\.js$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error('공식 라인업 번들 출처가 올바르지 않습니다.');
  return url;
}

function jsStringAt(
  body: string,
  start: number,
): { value: string; end: number } {
  let value = '';
  for (let i = start; i < body.length; i++) {
    const char = body[i];
    if (char === "'") return { value, end: i + 1 };
    if (char !== '\\') {
      value += char;
      continue;
    }
    const escaped = body[++i];
    if (!escaped) break;
    if (escaped === 'u') {
      const digits = body.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(digits)) break;
      value += String.fromCharCode(Number.parseInt(digits, 16));
      i += 4;
    } else if (escaped === 'x') {
      const digits = body.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(digits)) break;
      value += String.fromCharCode(Number.parseInt(digits, 16));
      i += 2;
    } else {
      const simple: Record<string, string> = {
        "'": "'",
        '"': '"',
        '\\': '\\',
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        v: '\v',
        '0': '\0',
      };
      if (!(escaped in simple)) break;
      value += simple[escaped];
    }
  }
  throw new Error('공식 라인업 번들 문자열이 완전하지 않습니다.');
}

export function parseWonderlivetBundleLineup(
  body: string,
): WonderlivetArtist[] {
  if (Buffer.byteLength(body, 'utf8') > 1_000_000)
    throw new Error('공식 라인업 번들 크기 제한을 초과했습니다.');
  const candidates: unknown[] = [];
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' =
    'code';
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    const next = body[i + 1];
    if (state === 'line') {
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        i++;
      }
      continue;
    }
    if (state !== 'code') {
      if (char === '\\') {
        i++;
        continue;
      }
      if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      )
        state = 'code';
      continue;
    }
    if (char === '/' && next === '/') {
      state = 'line';
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block';
      i++;
      continue;
    }
    if (char === "'") {
      state = 'single';
      continue;
    }
    if (char === '"') {
      state = 'double';
      continue;
    }
    if (char === '`') {
      state = 'template';
      continue;
    }
    const token = "JSON.parse('";
    if (!body.startsWith(token, i) || body[i - 1] !== '=') continue;
    const parsed = jsStringAt(body, i + token.length);
    if (body[parsed.end] !== ')')
      throw new Error('공식 라인업 번들 JSON 호출이 완전하지 않습니다.');
    try {
      const object: unknown = JSON.parse(parsed.value);
      if (
        object &&
        typeof object === 'object' &&
        'artists' in object &&
        'dataState' in object
      )
        candidates.push(object);
    } catch {
      throw new Error('공식 라인업 번들 JSON을 해석하지 못했습니다.');
    }
    i = parsed.end;
  }
  if (candidates.length !== 1)
    throw new Error('공식 라인업 번들 데이터가 유일하지 않습니다.');
  const lineup = candidates[0] as {
    dataState?: unknown;
    isComingSoon?: unknown;
    artists?: unknown;
  };
  if (
    lineup.dataState !== 'ready' ||
    lineup.isComingSoon !== false ||
    !Array.isArray(lineup.artists) ||
    !lineup.artists.length ||
    lineup.artists.length > 100
  )
    throw new Error('공식 라인업이 완전한 게시 상태가 아닙니다.');
  const names = new Set<string>();
  const ids = new Set<number>();
  return lineup.artists.map((row: unknown) => {
    if (!row || typeof row !== 'object')
      throw new Error('공식 라인업 출연진 형식이 올바르지 않습니다.');
    const artist = row as Record<string, unknown>;
    if (
      !Number.isSafeInteger(artist.id) ||
      Number(artist.id) < 1 ||
      ids.has(Number(artist.id))
    )
      throw new Error('공식 라인업 출연진 ID가 올바르지 않습니다.');
    ids.add(Number(artist.id));
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
    const artistName = name.normalize('NFC').trim().replace(/\s+/g, ' ');
    const key = normalizeArtistName(artistName);
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
    return { artistName, imageUrl };
  });
}
