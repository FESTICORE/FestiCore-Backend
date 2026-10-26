import { createHash } from 'node:crypto';
import { checkedUrl } from './crawl-fetch';
import { prepareCrawlImage } from './crawl-image';
import { runTesseract } from './timetable-image-ocr';

export const NOL_LINEUP_PARSER_VERSION = 'nol-world-detail-ocr:v1';
const MAX_IMAGES = 3;
const MAX_LINES = 80;

export interface NolLineupEvidence {
  sourceUrl: string;
  imageUrl: string;
  imageHash: string | null;
  parserVersion: string;
  status: 'ok' | 'empty' | 'failed';
  failureReason:
    | 'robots'
    | 'network'
    | 'http'
    | 'invalid-image'
    | 'ocr'
    | 'missing-image'
    | null;
  rawLines: string[];
}

export function nolWorldDetailImageUrls(html: string, pageUrl: string): URL[] {
  const page = checkedUrl(pageUrl);
  const productId = /^\/en\/ticket\/products\/(\d+)$/.exec(page.pathname)?.[1];
  if (
    page.origin !== 'https://world.nol.com' ||
    !productId ||
    page.search ||
    page.hash
  )
    return [];
  const urls = new Map<string, URL>();
  const normalized = html
    .slice(0, 2_000_000)
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
  for (const match of normalized.matchAll(
    /https:\/\/ticketimage\.interpark\.com\/Play\/image\/etc\/[\w./-]+\.(?:jpe?g|png|webp)/gi,
  )) {
    try {
      const image = checkedUrl(match[0]);
      if (
        image.hostname !== 'ticketimage.interpark.com' ||
        !new RegExp(
          `^/Play/image/etc/\\d{2}/${productId}(?:[-_][\\w-]+)?\\.(?:jpe?g|png|webp)$`,
          'i',
        ).test(image.pathname)
      )
        continue;
      urls.set(image.toString(), image);
      if (urls.size === MAX_IMAGES) break;
    } catch {
      // Ignore malformed image references from untrusted HTML.
    }
  }
  return [...urls.values()];
}

function linesFromTsv(tsv: string): string[] {
  const rows = new Map<string, { left: number; top: number; text: string }[]>();
  for (const row of tsv.split(/\r?\n/).slice(1)) {
    const cells = row.split('\t');
    if (cells[0] !== '5' || cells.length < 12) continue;
    const left = Number(cells[6]);
    const top = Number(cells[7]);
    const word = cells.slice(11).join('\t').trim();
    if (!Number.isFinite(left) || !Number.isFinite(top) || !word) continue;
    const key = cells.slice(1, 5).join(':');
    rows.set(key, [...(rows.get(key) ?? []), { left, top, text: word }]);
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        Math.min(...a.map((word) => word.top)) -
        Math.min(...b.map((word) => word.top)),
    )
    .slice(0, MAX_LINES)
    .map((row) =>
      row
        .sort((a, b) => a.left - b.left)
        .map((word) => word.text)
        .join(' ')
        .slice(0, 200),
    )
    .filter(Boolean);
}

export async function collectNolWorldLineupEvidence(
  html: string,
  pageUrl: string,
  previous: NolLineupEvidence[] | null,
  dependencies: {
    checkRobots: (url: string) => Promise<void>;
    getImage: (
      url: URL,
    ) => Promise<{ status: number; body: Buffer; contentType: string }>;
    ocr?: (image: Buffer) => Promise<string>;
  },
): Promise<NolLineupEvidence[]> {
  const results: NolLineupEvidence[] = [];
  const images = nolWorldDetailImageUrls(html, pageUrl);
  for (const image of images) {
    const entry: NolLineupEvidence = {
      sourceUrl: pageUrl,
      imageUrl: image.toString(),
      imageHash: null,
      parserVersion: NOL_LINEUP_PARSER_VERSION,
      status: 'failed',
      failureReason: null,
      rawLines: [],
    };
    results.push(entry);
    try {
      await dependencies.checkRobots(entry.imageUrl);
    } catch {
      entry.failureReason = 'robots';
      continue;
    }
    let response: { status: number; body: Buffer; contentType: string };
    try {
      response = await dependencies.getImage(image);
    } catch {
      entry.failureReason = 'network';
      continue;
    }
    if (response.status !== 200) {
      entry.failureReason = 'http';
      continue;
    }
    entry.imageHash = createHash('sha256').update(response.body).digest('hex');
    let prepared: Awaited<ReturnType<typeof prepareCrawlImage>>;
    try {
      prepared = await prepareCrawlImage(response.body, response.contentType);
    } catch {
      entry.failureReason = 'invalid-image';
      continue;
    }
    const reusable = previous?.find(
      (old) =>
        old.sourceUrl === pageUrl &&
        old.imageUrl === entry.imageUrl &&
        old.imageHash === entry.imageHash &&
        old.parserVersion === NOL_LINEUP_PARSER_VERSION &&
        (old.status === 'ok' || old.status === 'empty') &&
        Array.isArray(old.rawLines) &&
        old.rawLines.length <= MAX_LINES &&
        old.rawLines.every(
          (line) => typeof line === 'string' && line.length <= 200,
        ),
    );
    if (reusable) {
      entry.status = reusable.status;
      entry.rawLines = reusable.rawLines;
      continue;
    }
    try {
      entry.rawLines = linesFromTsv(
        await (dependencies.ocr ?? runTesseract)(prepared.body),
      );
      entry.status = entry.rawLines.length ? 'ok' : 'empty';
    } catch {
      entry.failureReason = 'ocr';
    }
  }
  const seen = new Set(images.map(String));
  for (const old of previous?.slice(0, MAX_IMAGES) ?? []) {
    if (
      old.sourceUrl !== pageUrl ||
      seen.has(old.imageUrl) ||
      nolWorldDetailImageUrls(old.imageUrl, pageUrl).length !== 1
    )
      continue;
    results.push({
      sourceUrl: pageUrl,
      imageUrl: old.imageUrl,
      imageHash: null,
      parserVersion: NOL_LINEUP_PARSER_VERSION,
      status: 'failed',
      failureReason: 'missing-image',
      rawLines: [],
    });
    seen.add(old.imageUrl);
  }
  return results;
}
