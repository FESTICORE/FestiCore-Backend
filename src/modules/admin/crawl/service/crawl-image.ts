import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { checkedUrl } from './crawl-fetch';
import {
  eventPerformers,
  melonSearchCandidates,
  nolPosterUrl,
  ticketCandidates,
  yes24EventJson,
} from './crawl-parser';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES_PER_RUN = 8;
const MAX_MELON_DETAIL_IMAGES = 81;

export function selectRunImages(
  urls: URL[],
  pageUrl: string,
  day: string,
): URL[] {
  const page = new URL(pageUrl);
  if (
    page.hostname === 'ticket.melon.com' &&
    page.pathname === '/performance/index.htm'
  )
    return urls.slice(0, MAX_MELON_DETAIL_IMAGES);
  if (
    (page.hostname === 'ticket.yes24.com' &&
      /^\/(?:English\/)?Perf\/\d+$/.test(page.pathname)) ||
    (page.hostname === 'nol.yanolja.com' &&
      /^\/ticket\/(?:products\/\d+|meta\/performance\/[\w%.-]+)$/.test(
        page.pathname,
      ))
  )
    return urls.slice(0, MAX_MELON_DETAIL_IMAGES);
  if (urls.length <= MAX_IMAGES_PER_RUN) return urls;
  if (
    (page.hostname === 'ticket.melon.com' &&
      page.pathname === '/search/index.htm') ||
    (page.hostname === 'ticket.yes24.com' &&
      page.pathname === '/English/Genre/Concert')
  ) {
    const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
    const start = Number.isFinite(dayNumber) ? dayNumber % urls.length : 0;
    return Array.from(
      { length: MAX_IMAGES_PER_RUN },
      (_, index) => urls[(start + index) % urls.length],
    );
  }
  return urls.slice(0, MAX_IMAGES_PER_RUN);
}

function melonDetailImages(html: string, pageUrl: string): URL[] | null {
  const page = new URL(pageUrl);
  if (
    page.hostname !== 'ticket.melon.com' ||
    page.pathname !== '/performance/index.htm' ||
    !/^\d+$/.test(page.searchParams.get('prodId') ?? '')
  )
    return null;
  const urls: URL[] = [];
  const add = (raw: string, hostname: string) => {
    try {
      const url = checkedUrl(new URL(raw, page).toString());
      if (
        url.hostname === hostname &&
        !urls.some((item) => item.toString() === url.toString())
      )
        urls.push(url);
    } catch {
      /* Ignore malformed or unsafe image locations. */
    }
  };
  const poster =
    /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(
      html,
    )?.[1];
  if (poster) add(poster, 'cdnticket.melon.co.kr');
  const artistList =
    /<ul\b[^>]*class=["'][^"']*\blist_artist\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(
      html,
    )?.[1];
  for (const tag of artistList?.match(/<img\b[^>]*>/gi) ?? []) {
    const image = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (image) add(image, 'cdnimg.melon.co.kr');
    if (urls.length >= 81) break;
  }
  return urls;
}

export function artistProfileImageUrl(
  html: string,
  pageUrl: string,
  imageHint: string,
): URL | null {
  const page = html.slice(0, 2_000_000);
  const tags: string[] = page.match(/<(?:img|meta|a|div)\b[^>]*>/gi) ?? [];
  const candidates = [
    ...tags.map(
      (tag) => /\b(?:data-src|src|content)=["']([^"']+)["']/i.exec(tag)?.[1],
    ),
    ...[...page.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)].map(
      (match) => match[1],
    ),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const url = checkedUrl(
        new URL(raw.replace(/&amp;/gi, '&'), pageUrl).toString(),
      );
      if (
        new URL(pageUrl).hostname === 'xmfestival.com' &&
        (url.hostname !== 'cdn.imweb.me' ||
          url.pathname !== `/thumbnail/${imageHint}`)
      )
        continue;
      if (url.pathname.includes(imageHint)) return url;
    } catch {
      // Ignore unsafe or malformed image locations.
    }
  }
  return null;
}

function melonSearchImages(html: string, pageUrl: string): URL[] | null {
  const candidates = melonSearchCandidates(html, pageUrl);
  if (candidates === null) return null;
  const urls: URL[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.posterUrl) continue;
    try {
      const image = checkedUrl(candidate.posterUrl);
      if (seen.has(image.toString())) continue;
      seen.add(image.toString());
      urls.push(image);
    } catch {
      /* Ignore malformed or unsafe image locations. */
    }
  }
  return urls;
}

function yes24DetailImages(html: string, pageUrl: string): URL[] | null {
  const page = new URL(pageUrl);
  if (
    page.hostname !== 'ticket.yes24.com' ||
    !/^\/(?:English\/)?Perf\/\d+$/.test(page.pathname)
  )
    return null;
  const event = yes24EventJson(html);
  if (!event) return [];
  const urls = eventPerformers(event, pageUrl).flatMap((artist) =>
    artist.sourceUrl ? [checkedUrl(artist.sourceUrl)] : [],
  );
  try {
    if (typeof event.image !== 'string') return urls;
    const image = checkedUrl(new URL(event.image, page).toString());
    return image.hostname === 'tkfile.yes24.com' &&
      image.pathname.startsWith('/upload2/PerfBlog/')
      ? [image, ...urls]
      : urls;
  } catch {
    return urls;
  }
}

function nolDetailImages(html: string, pageUrl: string): URL[] | null {
  const page = new URL(pageUrl);
  if (
    page.hostname !== 'nol.yanolja.com' ||
    !/^\/ticket\/(?:products\/\d+|meta\/performance\/[\w%.-]+)$/.test(
      page.pathname,
    )
  )
    return null;
  const event = yes24EventJson(html);
  const poster = nolPosterUrl(html, page);
  return [
    ...new Map(
      [
        ...(poster ? [checkedUrl(poster)] : []),
        ...eventPerformers(event, pageUrl).flatMap((artist) =>
          artist.sourceUrl ? [checkedUrl(artist.sourceUrl)] : [],
        ),
      ].map((url) => [url.toString(), url]),
    ).values(),
  ];
}

function yes24EnglishFestivalImages(
  html: string,
  pageUrl: string,
): URL[] | null {
  const page = new URL(pageUrl);
  if (
    page.hostname !== 'ticket.yes24.com' ||
    page.pathname !== '/English/Genre/Concert'
  )
    return null;
  const urls: URL[] = [];
  const seen = new Set<string>();
  for (const card of html
    .slice(0, 2_000_000)
    .matchAll(
      /<ul\b[^>]*class=["'][^"']*\blist_wrap\b[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["'][^"']*\bbtn\b/gi,
    )) {
    if (!/<span>\s*Genre\s*<\/span>\s*:\s*\[Festival\]/i.test(card[1]))
      continue;
    const productId =
      /<h3>\s*<a\b[^>]*href=["']\/English\/Perf\/(\d+)["']/i.exec(card[1])?.[1];
    const poster =
      /<li\b[^>]*class=["']poster["'][^>]*>\s*<a\b[^>]*>\s*<img\b[^>]*src=["']([^"']+)["']/i.exec(
        card[1],
      )?.[1];
    if (!productId || !poster) continue;
    try {
      const image = checkedUrl(new URL(poster, page).toString());
      const imageProductId =
        /^\/upload2\/PerfBlog\/\d{6}\/\d{8}\/\d{8}-(\d+)\.(?:jpe?g|png|webp)$/i.exec(
          image.pathname,
        )?.[1];
      if (
        image.hostname !== 'stkfile.yes24.com' ||
        imageProductId !== productId ||
        seen.has(image.toString())
      )
        continue;
      seen.add(image.toString());
      urls.push(image);
    } catch {
      /* Ignore malformed or unsafe poster locations. */
    }
  }
  return urls;
}

function mintPaperImages(html: string, pageUrl: string): URL[] | null {
  const page = new URL(pageUrl);
  if (
    page.hostname !== 'mintpaper.co.kr' ||
    !page.pathname.startsWith('/festivals')
  )
    return null;
  const script =
    /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    )?.[1];
  if (!script || script.length > 2_000_000) return [];
  try {
    const payload = JSON.parse(script) as {
      props?: { apolloState?: { data?: Record<string, unknown> } };
    };
    const data = payload.props?.apolloState?.data;
    if (!data) return [];
    const urls: URL[] = [];
    const seen = new Set<string>();
    const add = (ref: unknown) => {
      if (!ref || typeof ref !== 'object' || !('__ref' in ref)) return;
      const key = ref.__ref;
      if (typeof key !== 'string' || !key.startsWith('UploadFile:')) return;
      const image = data[key];
      if (!image || typeof image !== 'object' || !('url' in image)) return;
      if (typeof image.url !== 'string') return;
      try {
        const url = checkedUrl(image.url);
        if (!seen.has(url.toString())) {
          seen.add(url.toString());
          urls.push(url);
        }
      } catch {
        // Ignore untrusted image locations.
      }
    };
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('Festival:') || !value || typeof value !== 'object')
        continue;
      if ('coverImage' in value) add(value.coverImage);
      if (urls.length >= MAX_IMAGES_PER_RUN) break;
    }
    return urls.slice(0, MAX_IMAGES_PER_RUN);
  } catch {
    return [];
  }
}

export function discoverImageUrls(html: string, pageUrl: string): URL[] {
  if (pageUrl === 'https://www.mintpaper.co.kr/posts/4821') return [];
  const officialImages = mintPaperImages(html, pageUrl);
  if (officialImages) return officialImages;
  const melonImages = melonDetailImages(html, pageUrl);
  if (melonImages) return melonImages;
  const melonSearchPosters = melonSearchImages(html, pageUrl);
  if (melonSearchPosters) return melonSearchPosters;
  const yes24EnglishPosters = yes24EnglishFestivalImages(html, pageUrl);
  if (yes24EnglishPosters) return yes24EnglishPosters;
  const yes24Images = yes24DetailImages(html, pageUrl);
  if (yes24Images) return yes24Images;
  const nolImages = nolDetailImages(html, pageUrl);
  if (nolImages) return nolImages;
  const page = new URL(pageUrl);
  if (page.hostname === 'nol.yanolja.com' && page.pathname === '/ticket') {
    return ticketCandidates(html, pageUrl).flatMap((candidate) =>
      candidate.posterUrl ? [checkedUrl(candidate.posterUrl)] : [],
    );
  }
  const nolPoster = nolPosterUrl(html, new URL(pageUrl));
  if (nolPoster) return [checkedUrl(nolPoster)];
  const urls: URL[] = [];
  const seen = new Set<string>();
  if (
    pageUrl.startsWith('https://ticket.melon.com/') &&
    html.trimStart().startsWith('{')
  ) {
    try {
      const data = JSON.parse(html) as {
        data?: { title?: string; posterImg?: string }[];
      };
      for (const product of data.data ?? []) {
        if (
          typeof product.posterImg !== 'string' ||
          !/(?:페스티벌|축제|festival|\bfest\b)/i.test(product.title ?? '')
        )
          continue;
        const raw = product.posterImg.startsWith('/resource/image/upload/')
          ? `https://cdnticket.melon.co.kr${product.posterImg}`
          : product.posterImg;
        try {
          const url = checkedUrl(raw);
          if (!seen.has(url.toString())) {
            seen.add(url.toString());
            urls.push(url);
          }
        } catch {
          continue;
        }
        if (urls.length >= MAX_IMAGES_PER_RUN) return urls;
      }
    } catch {
      // Invalid or changed JSON leaves the run without unverified image URLs.
    }
    return urls;
  }
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const attributes = [
      ...tag.matchAll(/\b(src|data-src|srcset)\s*=\s*(["'])(.*?)\2/gi),
    ];
    for (const attribute of attributes) {
      const value = attribute[3];
      if (value.trim().startsWith('data:')) continue;
      const candidates =
        attribute[1].toLowerCase() === 'srcset' ? value.split(',') : [value];
      for (const candidate of candidates) {
        const raw = candidate
          .trim()
          .split(/\s+/, 1)[0]
          ?.replace(/&amp;/gi, '&');
        if (!raw) continue;
        try {
          const url = checkedUrl(new URL(raw, pageUrl).toString());
          if (!seen.has(url.toString())) {
            seen.add(url.toString());
            urls.push(url);
          }
        } catch {
          // data:, non-HTTPS, credentials, local hosts, and malformed URLs are ignored.
        }
        if (urls.length >= MAX_IMAGES_PER_RUN) return urls;
      }
    }
  }
  return urls;
}

export async function prepareCrawlImage(
  bytes: Buffer,
  declaredType: string,
): Promise<{
  body: Buffer;
  hash: string;
  key: string;
}> {
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES)
    throw new Error('이미지 입력 크기 제한을 초과했습니다.');
  const types: Record<string, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  try {
    const image = sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      types[metadata.format] !== declaredType ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new Error(
        'JPEG, PNG, GIF 또는 WebP 이미지 형식이 일치하지 않습니다.',
      );
    }
    const body = await image
      .rotate()
      .resize(2000, 2000, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    if (body.length > MAX_OUTPUT_BYTES)
      throw new Error('변환 이미지 크기 제한을 초과했습니다.');
    const hash = createHash('sha256').update(body).digest('hex');
    return { body, hash, key: `crawl/${hash}.webp` };
  } catch (error) {
    if (error instanceof Error && error.message.includes('크기 제한'))
      throw error;
    throw new Error('이미지를 안전하게 디코딩할 수 없습니다.');
  }
}
