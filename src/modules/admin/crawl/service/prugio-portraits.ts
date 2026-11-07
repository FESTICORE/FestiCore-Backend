import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { checkedUrl } from './crawl-fetch';
import { PRUGIO_LINEUP_URL } from './prugio-lineup';

export const PRUGIO_PORTRAIT_PAGE_URL =
  'https://ticket.melon.com/performance/index.htm?prodId=213868';
export const PRUGIO_PORTRAIT_SEED = 'prugio-official-portraits';

const POSTER_PATH =
  /^\/resource\/image\/upload\/product\/20[0-9]{2}\/(?:0[1-9]|1[0-2])\/[0-9]{14}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpe?g$/i;
const MAX_POSTER_BYTES = 5 * 1024 * 1024;

export const PRUGIO_PORTRAIT_PUBLIC_IMAGE_SQL = `(
  source.kind = 'artist-image'
  AND source.enabled = true
  AND source.url = '${PRUGIO_PORTRAIT_PAGE_URL}'
  AND source."parserConfig"->>'seed' = '${PRUGIO_PORTRAIT_SEED}'
  AND source."parserConfig"->>'festivalSourceUrl' = '${PRUGIO_LINEUP_URL}'
  AND source."parserConfig"->>'artistName' ~ '^[가-힣]{2,12}$'
  AND EXISTS (
    SELECT 1 FROM crawl_sources gallery
    WHERE gallery.kind = 'artist-gallery' AND gallery.enabled = true
      AND gallery.url = source.url
      AND gallery."parserConfig"->>'seed' = '${PRUGIO_PORTRAIT_SEED}'
      AND gallery."parserConfig"->>'festivalSourceUrl' = '${PRUGIO_LINEUP_URL}'
  )
  AND image."originUrl" ~* '^https://cdnticket[.]melon[.]co[.]kr/resource/image/upload/product/20[0-9]{2}/(0[1-9]|1[0-2])/[0-9]{14}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpe?g$'
)`;

export function prugioPortraitConfig(
  pageUrl: string,
  config: Record<string, string>,
  artist: boolean,
): boolean {
  try {
    return (
      checkedUrl(pageUrl).toString() === PRUGIO_PORTRAIT_PAGE_URL &&
      config.seed === PRUGIO_PORTRAIT_SEED &&
      config.festivalSourceUrl === PRUGIO_LINEUP_URL &&
      (!artist || /^[가-힣]{2,12}$/.test(config.artistName ?? '')) &&
      Object.keys(config).every((key) =>
        [
          'seed',
          'festivalSourceUrl',
          ...(artist ? ['artistName'] : []),
        ].includes(key),
      )
    );
  } catch {
    return false;
  }
}

export function prugioPortraitPosterUrl(html: string): URL | null {
  if (
    Buffer.byteLength(html) > 2_000_000 ||
    !html.includes('푸르지오아트홀 뮤직페스티벌')
  )
    return null;
  const section =
    /<div\b[^>]*class=["'][^"']*\bbox_img_content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    )?.[1];
  if (!section) return null;
  const candidates = [
    ...section.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi),
  ]
    .map((match) => match[2].replace(/&amp;/g, '&'))
    .filter((value) => /\/melon\/quality\/90\/optimize$/.test(value))
    .map((value) => value.replace(/\/melon\/quality\/90\/optimize$/, ''))
    .filter((value) => {
      try {
        const url = checkedUrl(value);
        return (
          url.hostname === 'cdnticket.melon.co.kr' &&
          POSTER_PATH.test(url.pathname) &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    });
  if (candidates.length !== 1) return null;
  try {
    return checkedUrl(candidates[0]);
  } catch {
    return null;
  }
}

export type PrugioNameOcr = (image: Buffer) => Promise<string>;

export async function runPrugioNameOcr(image: Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      'tesseract',
      ['stdin', 'stdout', '-l', 'kor', '--psm', '7'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let size = 0;
    let stderrSize = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error('푸르지오 이름 OCR 제한 시간(5초)을 초과했습니다.')),
      5_000,
    );
    child.on('error', fail);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_384)
        fail(new Error('푸르지오 이름 OCR 출력이 너무 큽니다.'));
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = 1_024 - stderrSize;
      if (remaining <= 0) return;
      const part = chunk.subarray(0, remaining);
      stderrChunks.push(part);
      stderrSize += part.length;
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const detail = Buffer.concat(stderrChunks)
          .toString('utf8')
          .replace(/\p{Cc}/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 256);
        reject(
          new Error(
            `푸르지오 이름 OCR에 실패했습니다 (종료 코드 ${code ?? '없음'}${detail ? `: ${detail}` : ''}).`,
          ),
        );
      } else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.on('error', fail);
    child.stdin.end(image);
  });
}

function recognizedName(text: string): string | null {
  const match = /^\s*([가-힣\s]{2,24})\s*[|ㅣI]/.exec(text.normalize('NFKC'));
  return match ? match[1].replace(/\s/g, '') : null;
}

function photoRows(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
  offset: number,
): number[] {
  const starts: number[] = [];
  const expected = width;
  let start = -1;
  for (let y = 0; y <= height; y++) {
    let dark = 0;
    if (y < height)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels;
        if (pixels[i] < 235 || pixels[i + 1] < 235 || pixels[i + 2] < 235)
          dark++;
      }
    const active = dark > width * 0.13;
    if (active && start < 0) start = y;
    if (!active && start >= 0) {
      const length = y - start;
      if (length >= expected * 0.85 && length <= expected * 1.1)
        starts.push(offset + start);
      start = -1;
    }
  }
  return starts;
}

/** Fail closed unless the current official poster has one adjacent portrait per roster name. */
export async function extractPrugioPortraits(
  bytes: Buffer,
  expectedNames: readonly string[],
  ocr: PrugioNameOcr = runPrugioNameOcr,
): Promise<{ artistName: string; body: Buffer }[]> {
  if (!bytes.length || bytes.length > MAX_POSTER_BYTES)
    throw new Error('푸르지오 공식 포스터 크기가 올바르지 않습니다.');
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: 8_000_000 });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    metadata.format !== 'jpeg' ||
    width < 650 ||
    width > 750 ||
    height < 9500 ||
    height > 11000 ||
    expectedNames.length < 1 ||
    expectedNames.length > 30 ||
    new Set(expectedNames).size !== expectedNames.length ||
    expectedNames.some((name) => !/^[가-힣]{2,12}$/.test(name))
  )
    throw new Error('푸르지오 공식 포스터 또는 출연진 형식이 바뀌었습니다.');

  // Photo pixels locate each profile row. OCR reads only the adjacent name line.
  // All coordinates scale with the image; no performer is assigned a fixed row.
  const profileTop = Math.round(height * 0.55);
  const photoLeft = Math.round(width * (94 / 700));
  const photoWidth = Math.round(width * (150 / 700));
  const { data, info } = await sharp(bytes)
    .extract({
      left: photoLeft,
      top: profileTop,
      width: photoWidth,
      height: height - profileTop,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rows = photoRows(
    data,
    info.width,
    info.height,
    info.channels,
    profileTop,
  );
  if (rows.length < expectedNames.length || rows.length > 30)
    throw new Error('푸르지오 공식 프로필 사진 구획이 바뀌었습니다.');
  const expected = new Set(expectedNames);
  const output = new Map<string, Buffer>();
  const textLeft = Math.round(width * (250 / 700));
  const textWidth = Math.round(width * (300 / 700));
  for (const row of rows) {
    let artistName: string | null = null;
    for (const variant of [
      { offset: -12, height: 35 },
      { offset: -15, height: 30 },
    ]) {
      const top = row + Math.round((variant.offset * width) / 700);
      const lineHeight = Math.round((variant.height * width) / 700);
      if (top < 0 || top + lineHeight > height) continue;
      const nameLine = await sharp(bytes)
        .extract({ left: textLeft, top, width: textWidth, height: lineHeight })
        .resize({ width: textWidth * 4 })
        .png()
        .toBuffer();
      const candidate = recognizedName(await ocr(nameLine));
      if (candidate && expected.has(candidate)) {
        artistName = candidate;
        break;
      }
    }
    if (!artistName) continue; // Extra profiles absent from the official roster are ignored.
    if (output.has(artistName))
      throw new Error(`푸르지오 공식 OCR에서 ${artistName} 사진이 중복됩니다.`);
    const body = await sharp(bytes)
      .extract({
        left: photoLeft,
        top: row,
        width: photoWidth,
        height: photoWidth,
      })
      .jpeg({ quality: 88 })
      .toBuffer();
    output.set(artistName, body);
  }
  if (output.size !== expectedNames.length)
    throw new Error(
      `푸르지오 공식 OCR에서 명단 ${output.size}/${expectedNames.length}명만 검증됐습니다.`,
    );
  return expectedNames.map((artistName) => ({
    artistName,
    body: output.get(artistName)!,
  }));
}
