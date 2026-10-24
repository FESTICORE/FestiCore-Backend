import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isPublicAddress } from './crawl-fetch';

const MODAL_URL = new URL('https://xmfestival.com/ajax/get_modal_menu.cm');
const MAX_CARDS = 50;
const MAX_HTML_BYTES = 2_000_000;
// Imweb modal responses include the site's full layout; observed official
// responses are about 250-470 KiB even though the artist title is small.
const MAX_MODAL_BYTES = 750_000;

export interface ArtistGalleryEntry {
  artistName: string;
  imageUrl: URL;
  officialSiteKeys: string[];
}

interface GalleryCard {
  menuCode: string;
  baseMenuCode: string;
  imageUrl: URL;
}

export function isOfficialModalContentType(value: string | undefined): boolean {
  const type = value?.split(';', 1)[0]?.trim().toLowerCase();
  return type === 'application/json' || type === 'text/html';
}

function decodeHtml(value: string): string {
  return value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt|nbsp|middot);/gi,
    (entity, code: string) => {
      const named: Record<string, string> = {
        amp: '&',
        quot: '"',
        apos: "'",
        lt: '<',
        gt: '>',
        nbsp: ' ',
        middot: '·',
      };
      if (code.startsWith('#')) {
        const hex = code[1]?.toLowerCase() === 'x';
        const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : entity;
      }
      return named[code.toLowerCase()] ?? entity;
    },
  );
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  ).exec(tag);
  return match ? decodeHtml(match[1] ?? match[2]) : null;
}

function parseCards(html: string): GalleryCard[] {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return [];
  const cards: GalleryCard[] = [];
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const className = attribute(anchor[1], 'class') ?? '';
    if (!className.split(/\s+/).includes('item_container')) continue;
    const href = attribute(anchor[1], 'href') ?? '';
    const modal =
      /SITE\.openModalMenu\(\s*(['"])([A-Za-z0-9_-]{1,80})\1\s*,\s*(['"])([A-Za-z0-9_-]{1,80})\3\s*\)/.exec(
        href,
      );
    if (!modal) {
      if (href.includes('openModalMenu'))
        throw new Error('공식 갤러리 카드 형식이 변경되었습니다.');
      continue;
    }
    const imageTag = /<div\b([^>]*)>/gi;
    let imageUrl: URL | null = null;
    for (const div of anchor[2].matchAll(imageTag)) {
      const divClass = attribute(div[1], 'class') ?? '';
      if (!divClass.split(/\s+/).includes('img_wrap')) continue;
      const src = attribute(div[1], 'data-src');
      if (!src) continue;
      try {
        const url = new URL(src);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'cdn.imweb.me' ||
          url.username ||
          url.password ||
          url.port ||
          !/\.(?:jpe?g|png|webp)$/i.test(url.pathname)
        )
          continue;
        imageUrl = url;
        break;
      } catch {
        // Ignore malformed image URLs in the untrusted gallery document.
      }
    }
    if (!imageUrl)
      throw new Error('공식 갤러리 카드 이미지를 확인하지 못했습니다.');
    cards.push({ menuCode: modal[2], baseMenuCode: modal[4], imageUrl });
    if (cards.length > MAX_CARDS)
      throw new Error('공식 갤러리 카드 수가 허용 범위를 초과했습니다.');
  }
  return cards;
}

async function fetchOfficialModal(
  menuCode: string,
  baseMenuCode: string,
): Promise<string> {
  const addresses = await lookup(MODAL_URL.hostname, {
    all: true,
    verbatim: true,
  });
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw new Error('공식 모달 호스트가 공개 IP로 해석되지 않았습니다.');
  }
  const selected = addresses[0];
  const body = new URLSearchParams({
    menu_code: menuCode,
    base_menu_code: baseMenuCode,
  }).toString();
  return new Promise((resolve, reject) => {
    const req = request(
      MODAL_URL,
      {
        method: 'POST',
        timeout: 10_000,
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'content-length': Buffer.byteLength(body),
          accept: 'application/json',
          'user-agent':
            'FestiCoreCrawler/0.1 (+https://festicore.up.railway.app)',
        },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          !isOfficialModalContentType(response.headers['content-type'])
        ) {
          response.resume();
          reject(new Error('공식 모달 응답이 유효하지 않습니다.'));
          return;
        }
        const length = Number(response.headers['content-length']);
        if (Number.isFinite(length) && length > MAX_MODAL_BYTES) {
          req.destroy(new Error('공식 모달 응답 크기 제한을 초과했습니다.'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_MODAL_BYTES)
            req.destroy(new Error('공식 모달 응답 크기 제한을 초과했습니다.'));
          else chunks.push(chunk);
        });
        response.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf8')),
        );
        response.on('error', reject);
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error('공식 모달 요청 시간이 초과되었습니다.')),
    );
    req.on('error', reject);
    req.end(body);
  });
}

function modalArtist(
  raw: string,
): Pick<ArtistGalleryEntry, 'artistName' | 'officialSiteKeys'> | null {
  if (Buffer.byteLength(raw, 'utf8') > MAX_MODAL_BYTES) return null;
  try {
    const payload = JSON.parse(raw) as { msg?: unknown; html?: unknown };
    if (payload.msg !== 'SUCCESS' || typeof payload.html !== 'string')
      return null;
    const title = /<h4\b([^>]*)>([\s\S]*?)<\/h4\s*>/gi;
    for (const match of payload.html.matchAll(title)) {
      if (
        !(attribute(match[1], 'class') ?? '')
          .split(/\s+/)
          .includes('modal-title')
      )
        continue;
      const text = decodeHtml(match[2].replace(/<[^>]*>/g, '')).trim();
      const name = text.replace(/^artist_/, '').trim();
      if (
        name &&
        name.length <= 120 &&
        ![...name].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      ) {
        const officialSiteKeys = new Set<string>();
        for (const link of payload.html.matchAll(
          /<a\b[^>]*\bhref\s*=\s*["'](https:\/\/[^"']+)["']/gi,
        )) {
          try {
            const url = new URL(decodeHtml(link[1]));
            const labels = url.hostname.replace(/^www\./, '').split('.');
            if (
              url.protocol !== 'https:' ||
              url.username ||
              url.password ||
              url.port ||
              labels.length !== 2
            )
              continue;
            const key = labels[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
            if (key.length >= 4 && key.length <= 80) officialSiteKeys.add(key);
          } catch {
            // An invalid link cannot establish an artist identity.
          }
        }
        return { artistName: name, officialSiteKeys: [...officialSiteKeys] };
      }
    }
  } catch {
    // Invalid modal JSON cannot establish an artist identity.
  }
  return null;
}

export async function crawlArtistGallery(
  html: string,
  pageUrl: string,
  fetchModal: (
    menuCode: string,
    baseMenuCode: string,
  ) => Promise<string> = fetchOfficialModal,
): Promise<ArtistGalleryEntry[]> {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  if (
    page.protocol !== 'https:' ||
    page.hostname !== 'xmfestival.com' ||
    page.username ||
    page.password ||
    page.port
  )
    return [];
  const cards = parseCards(html);
  if (!cards.length) throw new Error('공식 갤러리 카드를 확인하지 못했습니다.');
  const results: ArtistGalleryEntry[] = [];
  for (const card of cards) {
    try {
      const artist = modalArtist(
        await fetchModal(card.menuCode, card.baseMenuCode),
      );
      if (!artist)
        throw new Error('공식 모달에서 출연진 이름을 확인하지 못했습니다.');
      results.push({ ...artist, imageUrl: card.imageUrl });
    } catch (error) {
      throw new Error('공식 출연진 모달 일부를 확인하지 못했습니다.', {
        cause: error,
      });
    }
  }
  return results;
}
