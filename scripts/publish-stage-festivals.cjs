#!/usr/bin/env node
/**
 * 승인(verified)된 공식 시간표 검토본이 있는 발견 축제를 관리 초안으로 가져와 발행한다.
 *
 * 사용법:
 *   FESTICORE_ADMIN_TOKEN=<editor 이상 access JWT> node scripts/publish-stage-festivals.cjs [옵션]
 *
 * 옵션:
 *   --base <URL>          API 호스트 (기본 https://festicore-dev.up.railway.app)
 *   --apply               실제로 가져오기·초안 수정·발행을 실행한다. 없으면 미리보기만 한다.
 *   --only <id,id,...>    지정한 축제 ID만 처리한다.
 *   --fill-missing-ends   종료 시각이 없는 공연을 같은 날·같은 무대의 다음 공연 시작 시각으로 채운다.
 *                         다음 공연이 없으면 그 축제는 건너뛴다.
 *
 * 토큰은 출력하지 않는다. 승인된 시간표가 없는 축제는 가짜 시간표를 만들지 않고 건너뛴다.
 */
const { createHash } = require('node:crypto');

const MAX_STAGES = 8;
const MAX_STAGE_NAME = 24;

function parseArgs(argv) {
  const options = { base: 'https://festicore-dev.up.railway.app', apply: false, only: null, fillMissingEnds: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--fill-missing-ends') options.fillMissingEnds = true;
    else if (arg === '--base') options.base = argv[(i += 1)];
    else if (arg === '--only') options.only = new Set(argv[(i += 1)].split(',').map((id) => id.trim()));
    else throw new Error(`알 수 없는 옵션: ${arg}`);
  }
  options.base = options.base.replace(/\/+$/, '');
  return options;
}

function createClient(base, token) {
  return async function request(method, path, { body, ifMatch } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ifMatch) headers['If-Match'] = ifMatch;
    const response = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  };
}

async function discoveredFestivals(request) {
  const festivals = [];
  let after = null;
  for (let page = 0; page < 100; page += 1) {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    const { status, json } = await request('GET', `festivals${query}`);
    if (status !== 200 || json?.code !== 'SUCCESS') throw new Error(`축제 목록 조회 실패 (HTTP ${status})`);
    festivals.push(...json.data.items);
    after = json.data.nextCursor;
    if (!after) return festivals;
  }
  throw new Error('축제 목록 페이지가 너무 많습니다.');
}

async function verifiedRevisionsBySourceUrl(request) {
  const { status, json } = await request('GET', 'admin/crawl/timetable-revisions?status=verified');
  if (status === 401 || status === 403) throw new Error(`관리자 권한이 필요합니다 (HTTP ${status})`);
  if (status !== 200 || json?.code !== 'SUCCESS') throw new Error(`시간표 검토본 조회 실패 (HTTP ${status})`);
  const latest = new Map();
  for (const revision of json.data.items ?? []) {
    const current = latest.get(revision.festivalSourceUrl);
    if (!current || new Date(revision.verifiedAt) > new Date(current.verifiedAt)) {
      latest.set(revision.festivalSourceUrl, revision);
    }
  }
  return latest;
}

async function pendingCountBySourceUrl(request) {
  const { status, json } = await request('GET', 'admin/crawl/timetable-revisions?status=pending');
  const counts = new Map();
  if (status !== 200 || json?.code !== 'SUCCESS') return counts;
  for (const revision of json.data.items ?? []) {
    counts.set(revision.festivalSourceUrl, (counts.get(revision.festivalSourceUrl) ?? 0) + 1);
  }
  return counts;
}

function stageID(name) {
  return `stg_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
}

function fillEnds(sets) {
  const filled = [];
  for (const set of sets) {
    if (set.endsAt) {
      filled.push(set);
      continue;
    }
    const next = sets
      .filter((other) => other.date === set.date && other.stageName === set.stageName && other.startsAt > set.startsAt)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    if (!next) return null;
    filled.push({ ...set, endsAt: next.startsAt });
  }
  return filled;
}

/** 검토본 공연 목록으로 초안의 days·stages·sets를 만든다. 만들 수 없으면 사유 문자열을 반환한다. */
function buildDraft(revision, fillMissingEnds) {
  let sets = revision.sets ?? [];
  if (sets.length === 0) return '승인된 시간표에 공연이 없음';
  if (sets.some((set) => !set.endsAt)) {
    if (!fillMissingEnds) return '종료 시각이 없는 공연이 있음 (--fill-missing-ends로 채울 수 있음)';
    sets = fillEnds(sets);
    if (!sets) return '종료 시각을 채울 다음 공연이 없음';
  }
  const stageNames = [...new Set(sets.map((set) => set.stageName))];
  if (stageNames.length > MAX_STAGES) return `무대가 ${stageNames.length}개로 최대 ${MAX_STAGES}개를 넘음`;
  const longName = stageNames.find((name) => [...name].length > MAX_STAGE_NAME);
  if (longName) return `무대 이름이 ${MAX_STAGE_NAME}자를 넘음: ${longName}`;

  const stages = stageNames.map((name, index) => ({ id: stageID(name), name, order: index + 1 }));
  const stageByName = new Map(stages.map((stage) => [stage.name, stage.id]));
  const byDate = new Map();
  for (const set of sets) {
    const day = byDate.get(set.date) ?? { date: set.date, startsAt: set.startsAt, endsAt: set.endsAt };
    if (set.startsAt < day.startsAt) day.startsAt = set.startsAt;
    if (set.endsAt > day.endsAt) day.endsAt = set.endsAt;
    byDate.set(set.date, day);
  }
  return {
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    stages,
    sets: sets.map((set) => ({
      stageId: stageByName.get(set.stageName),
      artist: set.artist,
      startsAt: set.startsAt,
      endsAt: set.endsAt,
    })),
  };
}

async function draftVersion(request, id) {
  const { status, json } = await request('GET', `admin/festivals/${id}/draft`);
  if (status !== 200 || json?.code !== 'SUCCESS') throw new Error(`초안 조회 실패 (HTTP ${status})`);
  return `"d${json.data.draftVersion}"`;
}

function failureMessage(step, { status, json }) {
  const detail = json?.message ?? json?.data?.errors?.join(', ') ?? '';
  return `${step} 실패 (HTTP ${status}${json?.code ? ` ${json.code}` : ''}) ${detail}`.trim();
}

async function publish(request, festival, draft) {
  const imported = await request('POST', `admin/festivals/discovered/${festival.id}/import`, { body: {} });
  if (![200, 201, 409].includes(imported.status)) throw new Error(failureMessage('가져오기', imported));

  const patched = await request('PATCH', `admin/festivals/${festival.id}/draft`, {
    body: draft,
    ifMatch: await draftVersion(request, festival.id),
  });
  if (patched.status !== 200) throw new Error(failureMessage('초안 수정', patched));

  const published = await request('POST', `admin/festivals/${festival.id}/publish`, {
    body: { note: 'Stage 일괄 발행 스크립트 (승인된 공식 시간표)' },
    ifMatch: await draftVersion(request, festival.id),
  });
  if (published.status !== 200) throw new Error(failureMessage('발행', published));
  return published.json?.data;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.FESTICORE_ADMIN_TOKEN;
  if (!token) throw new Error('FESTICORE_ADMIN_TOKEN 환경 변수가 필요합니다.');
  const request = createClient(options.base, token);

  const festivals = (await discoveredFestivals(request)).filter(
    (festival) => festival.status === 'discovered' && (!options.only || options.only.has(festival.id)),
  );
  const verified = await verifiedRevisionsBySourceUrl(request);
  const pending = await pendingCountBySourceUrl(request);

  console.log(`${options.apply ? '실행' : '미리보기'}: ${options.base}, 발견 축제 ${festivals.length}개`);
  const summary = { published: 0, ready: 0, skipped: 0, failed: 0 };
  for (const festival of festivals) {
    const label = `${festival.id} ${festival.name}`;
    const revision = verified.get(festival.sourceUrl);
    if (!revision) {
      const waiting = pending.get(festival.sourceUrl) ?? 0;
      console.log(`- 건너뜀 ${label}: 승인된 시간표 없음${waiting ? ` (검토 대기 ${waiting}개)` : ''}`);
      summary.skipped += 1;
      continue;
    }
    const draft = buildDraft(revision, options.fillMissingEnds);
    if (typeof draft === 'string') {
      console.log(`- 건너뜀 ${label}: ${draft}`);
      summary.skipped += 1;
      continue;
    }
    if (!options.apply) {
      console.log(`- 발행 가능 ${label}: ${draft.days.length}일, 무대 ${draft.stages.length}개, 공연 ${draft.sets.length}개`);
      summary.ready += 1;
      continue;
    }
    try {
      const result = await publish(request, festival, draft);
      console.log(`- 발행 ${label}: 팩 버전 ${result?.packVersion ?? '?'}`);
      summary.published += 1;
    } catch (error) {
      console.log(`- 실패 ${label}: ${error.message}`);
      summary.failed += 1;
    }
  }
  console.log(
    options.apply
      ? `완료: 발행 ${summary.published}, 건너뜀 ${summary.skipped}, 실패 ${summary.failed}`
      : `미리보기 완료: 발행 가능 ${summary.ready}, 건너뜀 ${summary.skipped}. 실제 발행은 --apply로 실행합니다.`,
  );
  if (summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildDraft, fillEnds, stageID };
