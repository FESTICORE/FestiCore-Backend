import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { checkedUrl } from './crawl-fetch';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES_PER_RUN = 8;

export function discoverImageUrls(html: string, pageUrl: string): URL[] {
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
