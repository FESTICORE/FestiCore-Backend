import { spawn } from 'node:child_process';
import sharp from 'sharp';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 30_000_000;
const MAX_TSV_BYTES = 2 * 1024 * 1024;

export interface TimetableImageColumn {
  stageId: string;
  /** Fractional rectangle, relative to the original image. One stage only. */
  left: number;
  top: number;
  width: number;
  height: number;
  artistPosition?: 'before' | 'after';
}

export interface TimetableImageOcrConfig {
  date: string;
  columns: TimetableImageColumn[];
}

/** Unverified OCR evidence. These rows must be reviewed before publication. */
export interface TimetableImageCandidate {
  stageId: string;
  startsAt: string;
  endsAt: string | null;
  artistText: string | null;
  rawText: string;
}

export type TesseractRunner = (image: Buffer) => Promise<string>;

export async function runTesseract(image: Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      'tesseract',
      ['stdin', 'stdout', '-l', 'kor+eng', '--psm', '6', 'tsv'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => child.kill(), 15_000);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    child.on('error', fail);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_TSV_BYTES) {
        fail(new Error('OCR 출력이 허용 크기를 초과했습니다.'));
      } else {
        chunks.push(chunk);
      }
    });
    child.stderr.resume();
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error('OCR 실행에 실패했습니다.'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.on('error', fail);
    child.stdin.end(image);
  });
}

interface OcrLine {
  top: number;
  text: string;
}

function parseLines(tsv: string): OcrLine[] {
  if (Buffer.byteLength(tsv) > MAX_TSV_BYTES)
    throw new Error('OCR 출력이 허용 크기를 초과했습니다.');
  const grouped = new Map<
    string,
    { left: number; top: number; text: string }[]
  >();
  for (const row of tsv.split(/\r?\n/).slice(1)) {
    const cells = row.split('\t');
    if (cells.length < 12 || cells[0] !== '5') continue;
    const left = Number(cells[6]);
    const top = Number(cells[7]);
    const word = cells.slice(11).join('\t').trim();
    if (!Number.isFinite(left) || !Number.isFinite(top) || !word) continue;
    const key = cells.slice(1, 5).join(':');
    const line = grouped.get(key) ?? [];
    line.push({ left, top, text: word });
    grouped.set(key, line);
  }
  return [...grouped.values()]
    .map((words) => ({
      top: Math.min(...words.map((word) => word.top)),
      text: words
        .sort((a, b) => a.left - b.left)
        .map((word) => word.text)
        .join(' '),
    }))
    .sort((a, b) => a.top - b.top);
}

const TIME = /\b([01]\d|2[0-3]):([0-5]\d)\b/g;

export function parseStageTsv(
  tsv: string,
  date: string,
  stageId: string,
  artistPosition: 'before' | 'after' = 'before',
): TimetableImageCandidate[] {
  const lines = parseLines(tsv);
  const candidates: TimetableImageCandidate[] = [];
  let previousTimeTop = -Infinity;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const matches = [...line.text.matchAll(TIME)];
    if (!matches.length) continue;
    const start = matches[0][0];
    const end = matches[1]?.[0] ?? null;
    if (end && end <= start) continue;
    const rawOnLine =
      artistPosition === 'after'
        ? line.text
            .slice(
              (matches.at(-1)?.index ?? 0) + (matches.at(-1)?.[0].length ?? 0),
            )
            .trim()
        : line.text.slice(0, matches[0].index).trim();
    // A closing bracket after a printed time range is not an artist name.
    const onLine =
      artistPosition === 'after' && !/[\p{L}\p{N}]/u.test(rawOnLine)
        ? ''
        : rawOnLine;
    const nearby =
      artistPosition === 'after'
        ? onLine
          ? []
          : lines
              .slice(index + 1)
              .filter((next) => next.top - line.top <= 130)
              .slice(0, rawOnLine && !onLine ? 1 : 2)
              .filter((next) => ![...next.text.matchAll(TIME)].length)
              .map((next) => next.text)
        : lines
            .slice(0, index)
            .filter(
              (prior) =>
                prior.top > previousTimeTop &&
                line.top - prior.top <= 130 &&
                ![...prior.text.matchAll(TIME)].length,
            )
            .slice(-2)
            .map((prior) => prior.text);
    const artistText = [onLine, ...nearby]
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' / ')
      .slice(0, 160);
    candidates.push({
      stageId,
      startsAt: `${date}T${start}:00+09:00`,
      endsAt: end ? `${date}T${end}:00+09:00` : null,
      artistText: artistText || null,
      rawText: line.text,
    });
    previousTimeTop = line.top;
    if (candidates.length > 100) throw new Error('OCR 후보가 너무 많습니다.');
  }
  return candidates;
}

/** Runs each configured stage independently so adjacent cards cannot share a stage. */
export async function extractTimetableImageCandidates(
  image: Buffer,
  config: TimetableImageOcrConfig,
  runner: TesseractRunner = runTesseract,
): Promise<TimetableImageCandidate[]> {
  const date = config.date;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  )
    throw new Error('유효한 공연 날짜가 필요합니다.');
  if (!image.length || image.length > MAX_IMAGE_BYTES)
    throw new Error('이미지 크기가 허용 범위를 벗어났습니다.');
  if (!config.columns.length || config.columns.length > 8)
    throw new Error('무대 영역은 1개에서 8개까지 지정해야 합니다.');
  const metadata = await sharp(image, {
    limitInputPixels: MAX_PIXELS,
  }).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (
    imageWidth < 100 ||
    imageHeight < 100 ||
    imageWidth * imageHeight > MAX_PIXELS
  )
    throw new Error('이미지 해상도가 허용 범위를 벗어났습니다.');

  const stageIds = new Set<string>();
  const results: TimetableImageCandidate[] = [];
  for (const column of config.columns) {
    if (
      !/^stg_[a-zA-Z0-9_-]{1,80}$/.test(column.stageId) ||
      stageIds.has(column.stageId) ||
      ![column.left, column.top, column.width, column.height].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ) ||
      (column.artistPosition !== undefined &&
        !['before', 'after'].includes(column.artistPosition)) ||
      column.width <= 0 ||
      column.height <= 0 ||
      column.left + column.width > 1 ||
      column.top + column.height > 1
    )
      throw new Error('무대 영역 설정이 올바르지 않습니다.');
    stageIds.add(column.stageId);
    const left = Math.floor(column.left * imageWidth);
    const top = Math.floor(column.top * imageHeight);
    const width = Math.min(
      imageWidth - left,
      Math.floor(column.width * imageWidth),
    );
    const height = Math.min(
      imageHeight - top,
      Math.floor(column.height * imageHeight),
    );
    if (width < 50 || height < 50)
      throw new Error('무대 영역이 너무 작습니다.');
    const crop = await sharp(image, { limitInputPixels: MAX_PIXELS })
      .extract({ left, top, width, height })
      .resize({ width: Math.min(width * 2, 3000) })
      .greyscale()
      .normalise()
      .png()
      .toBuffer();
    const tsv = await runner(crop);
    results.push(
      ...parseStageTsv(tsv, date, column.stageId, column.artistPosition),
    );
  }
  return results;
}
