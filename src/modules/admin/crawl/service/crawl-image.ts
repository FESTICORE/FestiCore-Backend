import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { checkedUrl } from './crawl-fetch';
import { yes24EventJson } from './crawl-parser';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES_PER_RUN = 8;

export function selectRunImages(
  urls: URL[],
  pageUrl: string,
  day: string,
): URL[] {
  if (urls.length <= MAX_IMAGES_PER_RUN) return urls;
  const page = new URL(pageUrl);
  if (
    page.hostname === 'ticket.melon.com' &&
    page.pathname === '/search/index.htm'
  ) {
    const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
    const start = Number.isFinite(dayNumber) ? dayNumber % urls.length : 0;
    return Array.from(
      { length: MAX_IMAGES_PER_RUN },
      (_, index) => urls[(start + index) % urls.length],
    );
  }
  if (
    page.hostname !== 'ticket.melon.com' ||
    page.pathname !== '/performance/index.htm'
  )
    return urls.slice(0, MAX_IMAGES_PER_RUN);
  const poster = urls[0];
  const artists = urls.slice(1);
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const start =
    (Number.isFinite(dayNumber) ? dayNumber * (MAX_IMAGES_PER_RUN - 1) : 0) %
    artists.length;
  return [
    poster,
    ...Array.from(
      { length: MAX_IMAGES_PER_RUN - 1 },
      (_, index) => artists[(start + index) % artists.length],
    ),
  ];
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

function melonSearchImages(html: string, pageUrl: string): URL[] | null {
  const page = new URL(pageUrl);
  if (
    page.hostname !== 'ticket.melon.com' ||
    page.pathname !== '/search/index.htm'
  )
    return null;
  const urls: URL[] = [];
  const seen = new Set<string>();
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const raw = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(row[1])?.[1];
    if (!raw) continue;
    try {
      const image = checkedUrl(new URL(raw, page).toString());
      if (
        image.hostname !== 'cdnticket.melon.co.kr' ||
        !image.pathname.startsWith('/resource/image/upload/product/') ||
        seen.has(image.toString())
      )
        continue;
      seen.add(image.toString());
      urls.push(image);
      if (urls.length >= 100) break;
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
    !/^\/Perf\/\d+$/.test(page.pathname)
  )
    return null;
  const event = yes24EventJson(html);
  if (!event) return [];
  try {
    if (typeof event.image !== 'string') return [];
    const image = checkedUrl(new URL(event.image, page).toString());
    return image.hostname === 'tkfile.yes24.com' &&
      image.pathname.startsWith('/upload2/PerfBlog/')
      ? [image]
      : [];
  } catch {
    return [];
  }
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
  const officialImages = mintPaperImages(html, pageUrl);
  if (officialImages) return officialImages;
  const melonImages = melonDetailImages(html, pageUrl);
  if (melonImages) return melonImages;
  const melonSearchPosters = melonSearchImages(html, pageUrl);
  if (melonSearchPosters) return melonSearchPosters;
  const yes24Images = yes24DetailImages(html, pageUrl);
  if (yes24Images) return yes24Images;
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
      throw new Error('JPEG, PNG 또는 WebP 이미지 형식이 일치하지 않습니다.');
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
