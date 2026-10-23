const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const HEADER = 'date\tstageName\tstart\tend\tartist';
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['2026-10-03', '2026-10-04'];
const STAGES = ['STAGE A', 'STAGE B'];

function assertRevisionMatches(
  revision,
  item,
  festivalSourceUrl,
  sourcePageUrl,
  requireCurrentRun = false,
) {
  const performances = (sets) =>
    JSON.stringify(
      sets.map(({ artist, date, stageName, startsAt, endsAt }) => [
        artist,
        date,
        stageName,
        startsAt,
        endsAt,
      ]),
    );
  if (
    revision.sourceId !== item.sourceId ||
    (requireCurrentRun && revision.runId !== item.runId) ||
    revision.festivalSourceUrl !== festivalSourceUrl ||
    revision.sourceUrl !== sourcePageUrl ||
    revision.imageId !== item.imageId ||
    revision.contentHash !== item.storedImageHash ||
    revision.parserHash !== item.parserHash ||
    !Array.isArray(revision.sets) ||
    performances(revision.sets) !== performances(item.sets)
  )
    throw new Error(
      `${item.date}: 기존 검토본의 출처 또는 공연 내용이 다릅니다.`,
    );
  if (!['pending', 'verified'].includes(revision.status))
    throw new Error(`${item.date}: 기존 검토본을 적용할 수 없습니다.`);
}

function parseReview(file) {
  const lines = readFileSync(resolve(file), 'utf8').trim().split(/\r?\n/);
  const metadata = new Map();
  while (lines[0]?.startsWith('# ')) {
    const match = /^# ([^=]+)=(.+)$/.exec(lines.shift());
    if (!match || metadata.has(match[1]))
      throw new Error('검토 자료의 출처 정보가 올바르지 않습니다.');
    metadata.set(match[1], match[2]);
  }
  if (lines.shift() !== HEADER)
    throw new Error('검토 데이터의 열 형식이 올바르지 않습니다.');
  const festivalSourceUrl = metadata.get('festivalSourceUrl');
  const sourcePageUrl = metadata.get('sourcePageUrl');
  if (
    !festivalSourceUrl?.startsWith('https://') ||
    !sourcePageUrl?.startsWith('https://') ||
    !metadata.get('omitted')?.includes('EMNW')
  )
    throw new Error('공식 출처 또는 시각 미표기 항목이 누락되었습니다.');

  const groups = new Map(DAYS.map((day) => [day, []]));
  for (const line of lines) {
    const [date, stageName, start, end, artist, extra] = line.split('\t');
    if (
      extra !== undefined ||
      !groups.has(date) ||
      !STAGES.includes(stageName) ||
      !TIME.test(start ?? '') ||
      !(TIME.test(end ?? '') || end === '-') ||
      (end !== '-' && end <= start) ||
      !artist?.trim() ||
      artist.length > 160
    )
      throw new Error(`검토 공연 형식 오류: ${line}`);
    groups.get(date).push({
      artist,
      date,
      stageName,
      startsAt: `${date}T${start}:00+09:00`,
      endsAt: end === '-' ? null : `${date}T${end}:00+09:00`,
    });
  }
  if (groups.get(DAYS[0]).length !== 12 || groups.get(DAYS[1]).length !== 11)
    throw new Error(
      '원본에 시각이 적힌 DAY 1 공연 12건과 DAY 2 공연 11건이 필요합니다.',
    );

  const sources = DAYS.map((date) => {
    const imageUrl = metadata.get(`${date}.imageUrl`);
    const rawSha256 = metadata.get(`${date}.rawSha256`);
    const storedImageHash = metadata.get(`${date}.storedImageHash`);
    if (
      !/^https:\/\/[^?#]+\.jpg$/.test(imageUrl ?? '') ||
      !/^[0-9a-f]{64}$/.test(rawSha256 ?? '') ||
      !/^[0-9a-f]{64}$/.test(storedImageHash ?? '')
    )
      throw new Error(`${date}: 이미지 출처 또는 해시가 올바르지 않습니다.`);
    return {
      date,
      imageUrl,
      rawSha256,
      storedImageHash,
      sets: groups.get(date),
    };
  });
  return { festivalSourceUrl, sourcePageUrl, sources };
}

async function main() {
  const [file, mode, extra] = process.argv.slice(2);
  if (!file || !['--check', '--apply'].includes(mode) || extra)
    throw new Error(
      '사용법: node scripts/verify-xmf-timetable.cjs <tsv> <--check|--apply>',
    );
  const review = parseReview(file);
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
    for (const item of review.sources) {
      const sources = await db.query(
        `SELECT id, "parserConfig" FROM crawl_sources WHERE url = $1 AND parser = 'image-ocr'`,
        [item.imageUrl],
      );
      if (sources.length !== 1)
        throw new Error(
          `${item.date}: 이미지 소스가 정확히 한 건이어야 합니다.`,
        );
      const source = sources[0];
      const config = source.parserConfig;
      const columns = JSON.parse(config.columns);
      if (
        config.date !== item.date ||
        config.festivalSourceUrl !== review.festivalSourceUrl ||
        config.sourcePageUrl !== review.sourcePageUrl ||
        Number(config.expectedRows) !== item.sets.length ||
        !Array.isArray(columns) ||
        item.sets.some(
          (set) =>
            !columns.some((column) => column.stageName === set.stageName),
        )
      )
        throw new Error(
          `${item.date}: 저장된 소스 설정과 검토 자료가 다릅니다.`,
        );
      const parserHash = createHash('sha256')
        .update('reviewed-official-poster-v1')
        .update(JSON.stringify(item.sets))
        .digest('hex');
      const existing = await db.query(
        `SELECT revision.id, revision.status, revision."sourceId", revision."runId",
                revision."festivalSourceUrl", revision."sourceUrl", revision."imageId",
                revision."contentHash", revision."parserHash", revision.sets
         FROM crawl_timetable_revisions revision
         JOIN crawl_runs original_run ON original_run.id = revision."runId"
           AND original_run."sourceId" = revision."sourceId"
         WHERE revision."sourceId" = $1 AND revision."contentHash" = $2
           AND revision."parserHash" = $3`,
        [source.id, item.storedImageHash, parserHash],
      );
      if (existing.length > 1)
        throw new Error(`${item.date}: 중복된 검토본이 있습니다.`);
      const images = await db.query(
        `SELECT image.id, image."runId" FROM crawl_images image
         JOIN crawl_runs run ON run.id = image."runId" AND run."sourceId" = image."sourceId"
         WHERE image."sourceId" = $1 AND image."originUrl" = $2 AND image."contentHash" = $3
           AND ($4::uuid IS NULL OR image.id = $4)
         ORDER BY image."createdAt" DESC LIMIT 1`,
        [
          source.id,
          item.imageUrl,
          item.storedImageHash,
          existing[0]?.imageId ?? null,
        ],
      );
      if (images.length !== 1)
        throw new Error(`${item.date}: 저장된 원본 이미지를 찾지 못했습니다.`);
      const prepared = {
        ...item,
        sourceId: source.id,
        imageId: images[0].id,
        runId: images[0].runId,
        parserHash,
      };
      if (existing[0])
        assertRevisionMatches(
          existing[0],
          prepared,
          review.festivalSourceUrl,
          review.sourcePageUrl,
        );
      ready.push({ ...prepared, existing: existing[0] ?? null });
    }
    if (mode === '--check') {
      console.log(
        JSON.stringify({
          mode: 'check',
          days: ready.map(({ date, sets, existing }) => ({
            date,
            count: sets.length,
            status: existing?.status ?? 'new',
          })),
        }),
      );
      return;
    }
    const pending = [];
    for (const item of ready) {
      if (item.existing?.status === 'verified') {
        console.log(
          JSON.stringify({
            date: item.date,
            revisionId: item.existing.id,
            status: 'verified',
            count: item.sets.length,
          }),
        );
        continue;
      }
      const revision = await revisions.stageCandidate({
        sourceId: item.sourceId,
        runId: item.runId,
        festivalSourceUrl: review.festivalSourceUrl,
        sourceUrl: review.sourcePageUrl,
        imageId: item.imageId,
        contentHash: item.storedImageHash,
        parserHash: item.parserHash,
        sets: item.sets,
      });
      assertRevisionMatches(
        revision,
        item,
        review.festivalSourceUrl,
        review.sourcePageUrl,
        !item.existing,
      );
      if (revision.status !== 'pending')
        throw new Error(`${item.date}: 검토 대기본이 아닙니다.`);
      pending.push({
        id: revision.id,
        date: item.date,
        sets: item.sets,
        imageSha256: item.storedImageHash,
      });
    }
    if (!pending.length) return;
    const verified = await revisions.verifyReviewedBatch(pending);
    verified.forEach((revision, index) =>
      console.log(
        JSON.stringify({
          date: pending[index].date,
          revisionId: revision.id,
          status: revision.status,
          count: revision.sets.length,
        }),
      ),
    );
  } finally {
    await app.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { parseReview };
