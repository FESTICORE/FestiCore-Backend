const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const HEADER = 'date\tstageName\tstart\tend\tartist';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validDate(value) {
  if (!DATE.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseRows(file) {
  const lines = readFileSync(resolve(file), 'utf8').trim().split(/\r?\n/);
  const metadata = {};
  while (lines[0]?.startsWith('# ')) {
    const match = /^# (imageUrl|sha256|festivalSourceUrl|dates)=(.+)$/.exec(
      lines.shift(),
    );
    if (!match || metadata[match[1]])
      throw new Error('검토 자료의 출처 정보가 올바르지 않습니다.');
    metadata[match[1]] = match[2];
  }
  const { imageUrl, sha256, festivalSourceUrl } = metadata;
  const dates = metadata.dates?.split(',');
  if (
    !/^https:\/\/[^?#]+\.jpg$/.test(imageUrl ?? '') ||
    !/^[0-9a-f]{64}$/.test(sha256 ?? '') ||
    !/^https:\/\/[^\s]+$/.test(festivalSourceUrl ?? '') ||
    dates?.length !== 3 ||
    new Set(dates).size !== 3 ||
    !dates.every(validDate)
  )
    throw new Error(
      '검토 자료의 이미지, 해시, 축제 URL 또는 날짜가 올바르지 않습니다.',
    );
  if (lines.shift() !== HEADER)
    throw new Error('검토 데이터의 열 형식이 올바르지 않습니다.');
  if (!lines.length || lines.length > 100)
    throw new Error('검토 공연 수가 올바르지 않습니다.');
  const groups = new Map();
  for (const line of lines) {
    const [date, stageName, start, end, artist, extra] = line.split('\t');
    if (
      extra !== undefined ||
      !validDate(date) ||
      !['WONDER STAGE', 'LIVET STAGE'].includes(stageName) ||
      !TIME.test(start ?? '') ||
      !(TIME.test(end ?? '') || end === '22:00+') ||
      !artist?.trim() ||
      artist.length > 160 ||
      (end !== '22:00+' && end <= start)
    )
      throw new Error(`검토 공연 형식 오류: ${line}`);
    const sets = groups.get(date) ?? [];
    sets.push({
      artist,
      date,
      stageName,
      startsAt: `${date}T${start}:00+09:00`,
      endsAt: end === '22:00+' ? null : `${date}T${end}:00+09:00`,
    });
    groups.set(date, sets);
  }
  if (
    groups.size !== 3 ||
    [...groups.values()].some((sets) => sets.length !== 14) ||
    [...groups.keys()].some((date) => !dates.includes(date))
  )
    throw new Error('검토 자료의 세 날짜에 각각 14건이 있어야 합니다.');
  return { groups, imageUrl, imageHash: sha256, festivalSourceUrl, dates };
}

async function main() {
  const [file, mode, extra] = process.argv.slice(2);
  if (!file || !['--check', '--apply'].includes(mode) || extra)
    throw new Error(
      '사용법: node scripts/verify-reviewed-timetable.cjs <tsv> <--check|--apply>',
    );
  const { groups, imageUrl, imageHash, festivalSourceUrl, dates } =
    parseRows(file);
  const { NestFactory } = require('@nestjs/core');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../dist/app.module');
  const {
    CrawlTimetableRevisionService,
  } = require('../dist/modules/admin/crawl/service/crawl-timetable-revision.service');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const db = app.get(DataSource);
    const revisions = app.get(CrawlTimetableRevisionService);
    const ready = [];
    for (const date of dates) {
      const sets = groups.get(date);
      const sources = await db.query(
        `SELECT id, "parserConfig" FROM crawl_sources WHERE url = $1 AND parser = 'image-ocr'`,
        [`${imageUrl}?day=${date}`],
      );
      if (sources.length !== 1)
        throw new Error(`${date}: 이미지 소스가 정확히 한 건이어야 합니다.`);
      const source = sources[0];
      if (
        source.parserConfig.date !== date ||
        source.parserConfig.festivalSourceUrl !== festivalSourceUrl
      )
        throw new Error(
          `${date}: 저장된 소스의 축제 또는 날짜가 검토 자료와 다릅니다.`,
        );
      const expected = Number(source.parserConfig.expectedRows);
      if (sets.length !== expected || expected !== 14)
        throw new Error(`${date}: 공식 공연 14건을 모두 확인해야 합니다.`);
      const allowed = source.parserConfig.allowedStageNames;
      if (
        !Array.isArray(allowed) ||
        sets.some((set) => !allowed.includes(set.stageName))
      )
        throw new Error(`${date}: 무대 이름이 공식 소스 설정과 다릅니다.`);
      const candidates = await db.query(
        `SELECT id, "imageId", "festivalSourceUrl", "sourceUrl" FROM crawl_timetable_revisions
         WHERE "sourceId" = $1 AND "contentHash" = $2 AND status = 'pending'
         ORDER BY "createdAt" DESC LIMIT 1`,
        [source.id, imageHash],
      );
      if (candidates.length !== 1 || !candidates[0].imageId)
        throw new Error(
          `${date}: 저장된 원본 이미지와 검토 대기본을 찾지 못했습니다.`,
        );
      if (
        candidates[0].festivalSourceUrl !== festivalSourceUrl ||
        candidates[0].sourceUrl !== source.parserConfig.sourcePageUrl
      )
        throw new Error(`${date}: 검토 대기본의 축제 또는 출처가 다릅니다.`);
      ready.push({ date, revisionId: candidates[0].id, sets });
    }
    if (mode === '--check') {
      console.log(
        JSON.stringify({
          mode: 'check',
          days: ready.map(({ date, sets }) => ({ date, count: sets.length })),
        }),
      );
      return;
    }
    const verified = await revisions.verifyReviewedBatch(
      ready.map(({ revisionId, sets }) => ({ id: revisionId, sets })),
      imageHash,
    );
    for (let i = 0; i < ready.length; i++) {
      console.log(
        JSON.stringify({
          date: ready[i].date,
          revisionId: verified[i].id,
          status: verified[i].status,
          count: verified[i].sets.length,
        }),
      );
    }
  } finally {
    await app.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { parseRows };
