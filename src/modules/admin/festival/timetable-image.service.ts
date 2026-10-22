import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import type { FestivalDocument } from './festival.entity';
import { festivalSetId } from './festival-set-id';

type OcrLine = { text: string; confidence: number };
type DraftSet = {
  id: string;
  stageId: string;
  artist: string;
  startsAt: string;
  endsAt: string;
  note: null;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const MAX_SIDE = 6000;
const TIME =
  /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|–|~|〜)\s*([01]?\d|2[0-3]):([0-5]\d)(?!\d)/;

function ocrLines(tsv: string): OcrLine[] {
  const groups = new Map<string, { words: string[]; confidence: number[] }>();
  for (const row of tsv.split(/\r?\n/).slice(1)) {
    const cells = row.split('\t');
    if (cells.length < 12 || cells[0] !== '5') continue;
    const word = cells.slice(11).join('\t').trim();
    const confidence = Number(cells[10]);
    if (!word || !Number.isFinite(confidence) || confidence < 0) continue;
    const key = cells.slice(1, 5).join(':');
    const group = groups.get(key) ?? { words: [], confidence: [] };
    group.words.push(word);
    group.confidence.push(confidence);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ words, confidence }) => ({
    text: words.join(' ').replace(/\s+/g, ' ').trim(),
    confidence: confidence.reduce((a, b) => a + b, 0) / confidence.length / 100,
  }));
}

export function parseTimetableOcr(
  tsv: string,
  date: string,
  draft: FestivalDocument,
): { draft: DraftSet[]; confidence: number; unparsed: string[] } {
  const stageCandidates: unknown[] = Array.isArray(draft.stages)
    ? draft.stages
    : [];
  const dayCandidates: unknown[] = Array.isArray(draft.days) ? draft.days : [];
  const stages = stageCandidates.filter(
    (stage): stage is { id: string; name: string } =>
      record(stage) &&
      typeof stage.id === 'string' &&
      typeof stage.name === 'string',
  );
  const day = dayCandidates.find(
    (item): item is { date: string; startsAt: string; endsAt: string } =>
      record(item) &&
      item.date === date &&
      typeof item.startsAt === 'string' &&
      typeof item.endsAt === 'string',
  );
  if (!day)
    throw new BadRequestException('date가 축제 날짜에 포함되지 않습니다.');

  const lines = ocrLines(tsv);
  const result: DraftSet[] = [];
  const unparsed: string[] = [];
  const accepted: number[] = [];
  for (const line of lines) {
    const matches = stages.flatMap((stage) => {
      if (!line.text.startsWith(`${stage.name} `)) return [];
      const afterStage = line.text.slice(stage.name.length).trimStart();
      const time = TIME.exec(afterStage);
      return time?.index === 0 ? [{ stage, time, afterStage }] : [];
    });
    if (matches.length !== 1 || line.confidence < 0.7) {
      unparsed.push(line.text);
      continue;
    }
    const { stage, time, afterStage } = matches[0];
    const artist = afterStage.slice(time[0].length).trim().replace(/\s+/g, ' ');
    const startClock = `${time[1].padStart(2, '0')}:${time[2]}`;
    const endClock = `${time[3].padStart(2, '0')}:${time[4]}`;
    const nextDate = (value: string) =>
      new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    const possibleTimes = [date, nextDate(date)]
      .map((startDay) => {
        const endDay = endClock <= startClock ? nextDate(startDay) : startDay;
        const startsAt = `${startDay}T${startClock}:00+09:00`;
        const endsAt = `${endDay}T${endClock}:00+09:00`;
        return { startsAt, endsAt };
      })
      .filter(
        ({ startsAt, endsAt }) =>
          Date.parse(startsAt) >= Date.parse(day.startsAt) &&
          Date.parse(endsAt) <= Date.parse(day.endsAt),
      );
    if (possibleTimes.length !== 1) {
      unparsed.push(line.text);
      continue;
    }
    const { startsAt, endsAt } = possibleTimes[0];
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    if (
      !artist ||
      [...artist].length > 60 ||
      /\d{1,2}:\d{2}/.test(artist) ||
      end <= start ||
      start < Date.parse(day.startsAt) ||
      end > Date.parse(day.endsAt) ||
      result.length >= 400 ||
      result.some(
        (existing) =>
          existing.stageId === stage.id &&
          start < Date.parse(existing.endsAt) &&
          end > Date.parse(existing.startsAt),
      )
    ) {
      unparsed.push(line.text);
      continue;
    }
    const set = { stageId: stage.id, artist, startsAt, endsAt };
    result.push({ id: festivalSetId(set), ...set, note: null });
    accepted.push(line.confidence);
  }
  return {
    draft: result,
    confidence: accepted.length
      ? Math.min(
          1,
          Math.max(
            0,
            Math.round(
              (accepted.reduce((a, b) => a + b, 0) / accepted.length) * 100,
            ) / 100,
          ),
        )
      : 0,
    unparsed,
  };
}

class OcrProcessError extends Error {
  constructor(
    readonly reason: string,
    readonly stderr: string,
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly spawnCode?: string,
  ) {
    super('OCR process failed');
  }
}

function recognize(image: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'tesseract',
      ['stdin', 'stdout', '-l', 'kor+eng', 'tsv'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH },
      },
    );
    let output = '';
    let stderr = Buffer.alloc(0);
    let finished = false;
    let reason = 'process-failed';
    let spawnCode: string | undefined;
    const timer = setTimeout(() => {
      reason = 'timeout';
      child.kill('SIGKILL');
    }, 15_000);
    const failure = (exitCode: number | null, signal: NodeJS.Signals | null) =>
      new OcrProcessError(
        reason,
        stderr
          .toString('utf8')
          .slice(0, 512)
          .replace(/[^\x20-\x7e]/g, '?'),
        exitCode,
        signal,
        spawnCode,
      );
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      reason = error.code === 'ENOENT' ? 'executable-missing' : 'spawn-error';
      spawnCode = error.code;
      finish(failure(null, null));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length + chunk.length > 2_000_000) {
        reason = 'output-limit';
        child.kill('SIGKILL');
        return;
      }
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096)
        stderr = Buffer.concat([
          stderr,
          chunk.subarray(0, 4096 - stderr.length),
        ]);
    });
    child.on('close', (code, signal) =>
      finish(
        code === 0 && reason === 'process-failed'
          ? undefined
          : failure(code, signal),
      ),
    );
    child.stdin.on('error', () => undefined);
    child.stdin.end(image);
  });
}

@Injectable()
export class TimetableImageService {
  private readonly logger = new Logger(TimetableImageService.name);

  async preview(
    image: Buffer,
    mime: string,
    date: string,
    draft: FestivalDocument,
  ) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    )
      throw new BadRequestException(
        'date는 유효한 YYYY-MM-DD 형식이어야 합니다.',
      );
    if (!Buffer.isBuffer(image) || image.length === 0)
      throw new BadRequestException('image 파일이 필요합니다.');
    if (image.length > MAX_IMAGE_BYTES) throw new PayloadTooLargeException();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime))
      throw new UnsupportedMediaTypeException('JPEG, PNG, WebP만 지원합니다.');
    const dayCandidates: unknown[] = Array.isArray(draft.days)
      ? draft.days
      : [];
    if (!dayCandidates.some((day) => record(day) && day.date === date))
      throw new BadRequestException('date가 축제 날짜에 포함되지 않습니다.');
    let normalized: Buffer;
    try {
      const source = sharp(image, { limitInputPixels: MAX_PIXELS });
      const meta = await source.metadata();
      if (
        !['jpeg', 'png', 'webp'].includes(meta.format ?? '') ||
        !meta.width ||
        !meta.height ||
        meta.width > MAX_SIDE ||
        meta.height > MAX_SIDE ||
        meta.width * meta.height > MAX_PIXELS
      )
        throw new Error('invalid dimensions or format');
      normalized = await source.rotate().png().toBuffer();
    } catch {
      throw new BadRequestException(
        '이미지를 해석할 수 없거나 크기가 너무 큽니다.',
      );
    }
    const text = await recognize(normalized).catch((error: unknown) => {
      if (error instanceof OcrProcessError) {
        this.logger.warn(
          `OCR failed: ${error.reason}; exitCode=${error.exitCode}; signal=${error.signal}; spawnCode=${error.spawnCode ?? 'none'}; stderr=${error.stderr}`,
        );
        throw new ServiceUnavailableException('OCR을 실행할 수 없습니다.');
      }
      throw error;
    });
    return parseTimetableOcr(text, date, draft);
  }
}
