#!/usr/bin/env node
/**
 * 승인된 공식 시간표가 공개 상세에 있는 발견 축제를 관리 초안으로 가져와 발행한다.
 *
 * 시간표는 공개 상세 API(GET /festivals/:id)의 timetable을 그대로 쓴다. 이 값은 서버가 대체 출처 URL과
 * 여러 날 검토본을 합쳐 승인본만 노출하므로, 스크립트가 검토본을 직접 고르지 않는다.
 *
 * 사용법:
 *   node scripts/publish-stage-festivals.cjs [옵션]                       미리보기(토큰 불필요)
 *   FESTICORE_ADMIN_TOKEN=<editor 이상 access JWT> node scripts/publish-stage-festivals.cjs --apply
 *
 * 옵션:
 *   --base <URL>          API 호스트 (기본 https://festicore-dev.up.railway.app). 허용 호스트만 받는다.
 *   --allow-prod          운영 호스트(festicore.up.railway.app)를 허용한다.
 *   --apply               실제로 가져오기·초안 수정·발행을 실행한다. 없으면 미리보기만 한다.
 *   --only <id,id,...>    지정한 축제 ID만 처리한다.
 *   --fill-missing-ends   종료 시각이 없는 공연을 같은 날·같은 무대의 다음 공연 시작 시각으로 채운다.
 *                         다음 공연이 없으면 그 축제는 건너뛴다.
 *
 * 토큰은 출력하지 않는다. 승인된 시간표가 없거나 발행 검증을 통과하지 못하는 축제는 가짜 시간표를 만들지 않고
 * 사유와 함께 건너뛴다. 이미 관리 중인 초안이 있는 축제는 덮어쓰지 않는다.
 */
const { createHash } = require('node:crypto');

const STAGE_HOST = 'festicore-dev.up.railway.app';
const PROD_HOST = 'festicore.up.railway.app';
const MAX_STAGES = 8;
const MAX_STAGE_NAME = 24;
const MAX_ARTIST = 60;
const MAX_SETS = 400;
const MAX_DAY_HOURS = 18;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;

function parseArgs(argv) {
  const options = {
    base: `https://${STAGE_HOST}`,
    allowProd: false,
    apply: false,
    only: null,
    fillMissingEnds: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--allow-prod') options.allowProd = true;
    else if (arg === '--fill-missing-ends') options.fillMissingEnds = true;
    else if (arg === '--base') options.base = argv[(i += 1)];
    else if (arg === '--only') options.only = new Set(argv[(i += 1)].split(',').map((id) => id.trim()));
    else throw new Error(`알 수 없는 옵션: ${arg}`);
  }
  options.base = validatedBase(options.base, options.allowProd);
  return options;
}

/** 관리자 토큰이 의도하지 않은 곳으로 가지 않도록 https와 허용 호스트만 받는다. */
function validatedBase(value, allowProd) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`올바른 URL이 아닙니다: ${value}`);
  }
  const allowed = allowProd ? [STAGE_HOST, PROD_HOST] : [STAGE_HOST];
  if (url.protocol !== 'https:' || !allowed.includes(url.host) || url.pathname.replace(/\/+$/, '') !== '') {
    throw new Error(`허용하지 않는 호스트입니다: ${value} (허용: ${allowed.join(', ')})`);
  }
  return `https://${url.host}`;
}

function createClient(base, token) {
  return async function request(method, path, { body, ifMatch, auth = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ifMatch) headers['If-Match'] = ifMatch;
    const response = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
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

/** --only로 받은 ID는 목록 대신 상세로 직접 찾는다. 목록은 종료 30일이 지난 축제를 빼기 때문이다. */
async function festivalsByID(request, ids) {
  const festivals = [];
  for (const id of ids) {
    const detail = await publicDetail(request, id).catch(() => null);
    if (!detail) throw new Error(`축제를 찾을 수 없습니다: ${id}`);
    if (detail.status !== 'discovered') throw new Error(`발견 상태가 아닌 축제입니다: ${id} (${detail.status})`);
    festivals.push(detail);
  }
  return festivals;
}

async function publicDetail(request, id) {
  const { status, json } = await request('GET', `festivals/${encodeURIComponent(id)}`);
  if (status !== 200 || json?.code !== 'SUCCESS') throw new Error(`축제 상세 조회 실패 (HTTP ${status})`);
  return json.data;
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

/** 공연 목록이 서버 발행 검증(무대·이름·아티스트·일정 범위·겹침)을 통과할지 미리 확인한다. */
function preflight(sets, festival) {
  if (sets.length > MAX_SETS) return `공연이 ${sets.length}개로 최대 ${MAX_SETS}개를 넘음`;
  const stageNames = [...new Set(sets.map((set) => set.stageName))];
  if (stageNames.length > MAX_STAGES) return `무대가 ${stageNames.length}개로 최대 ${MAX_STAGES}개를 넘음`;
  const longStage = stageNames.find((name) => [...name].length < 1 || [...name].length > MAX_STAGE_NAME);
  if (longStage !== undefined) return `무대 이름 길이가 1~${MAX_STAGE_NAME}자가 아님: ${longStage}`;
  const longArtist = sets.find((set) => [...set.artist].length < 1 || [...set.artist].length > MAX_ARTIST);
  if (longArtist) return `아티스트 이름 길이가 1~${MAX_ARTIST}자가 아님: ${longArtist.artist}`;
  for (const set of sets) {
    if (!ISO.test(set.startsAt) || !ISO.test(set.endsAt)) return `시각 형식이 초안 규칙과 다름: ${set.artist}`;
    if (!(Date.parse(set.endsAt) > Date.parse(set.startsAt))) return `종료 시각이 시작보다 늦지 않음: ${set.artist}`;
    if ((festival.firstDate && set.date < festival.firstDate) || (festival.lastDate && set.date > festival.lastDate)) {
      return `공연 날짜 ${set.date}가 축제 기간(${festival.firstDate}~${festival.lastDate}) 밖임`;
    }
  }
  for (const name of stageNames) {
    const ordered = sets
      .filter((set) => set.stageName === name)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    for (let i = 1; i < ordered.length; i += 1) {
      if (Date.parse(ordered[i].startsAt) < Date.parse(ordered[i - 1].endsAt)) {
        return `같은 무대(${name})에서 공연 시간이 겹침: ${ordered[i - 1].artist}, ${ordered[i].artist}`;
      }
    }
  }
  const covered = new Set(sets.map((set) => set.date));
  for (const date of festivalDates(festival)) {
    if (!covered.has(date)) return `축제 기간 중 ${date}의 승인된 시간표가 없음`;
  }
  return null;
}

/** 축제 기간(firstDate~lastDate)의 날짜 목록. 기간을 모르면 빈 배열. */
function festivalDates(festival) {
  if (!festival.firstDate || !festival.lastDate) return [];
  const dates = [];
  const cursor = new Date(`${festival.firstDate}T00:00:00Z`);
  const last = new Date(`${festival.lastDate}T00:00:00Z`);
  for (let i = 0; cursor <= last && i < 32; i += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** 공개 상세 timetable로 초안의 days·stages·sets를 만든다. 만들 수 없으면 사유 문자열을 반환한다. */
function buildDraft(detail, fillMissingEnds) {
  let sets = (detail.timetable ?? []).map(({ artist, date, stageName, startsAt, endsAt }) => ({
    artist,
    date,
    stageName,
    startsAt,
    endsAt,
  }));
  if (sets.length === 0) return '승인된 시간표 없음';
  if (sets.some((set) => !set.endsAt)) {
    if (!fillMissingEnds) return '종료 시각이 없는 공연이 있음 (--fill-missing-ends로 채울 수 있음)';
    sets = fillEnds(sets);
    if (!sets) return '종료 시각을 채울 다음 공연이 없음';
  }
  const invalid = preflight(sets, detail);
  if (invalid) return invalid;

  const stageNames = [...new Set(sets.map((set) => set.stageName))];
  const stages = stageNames.map((name, index) => ({ id: stageID(name), name, order: index + 1 }));
  const stageByName = new Map(stages.map((stage) => [stage.name, stage.id]));
  const byDate = new Map();
  for (const set of sets) {
    const day = byDate.get(set.date) ?? { date: set.date, startsAt: set.startsAt, endsAt: set.endsAt };
    if (Date.parse(set.startsAt) < Date.parse(day.startsAt)) day.startsAt = set.startsAt;
    if (Date.parse(set.endsAt) > Date.parse(day.endsAt)) day.endsAt = set.endsAt;
    byDate.set(set.date, day);
  }
  const longDay = [...byDate.values()].find(
    (day) => Date.parse(day.endsAt) - Date.parse(day.startsAt) > MAX_DAY_HOURS * 3_600_000,
  );
  if (longDay) return `${longDay.date} 일정이 ${MAX_DAY_HOURS}시간을 넘음`;
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

async function adminDraft(request, id) {
  const { status, json } = await request('GET', `admin/festivals/${id}/draft`, { auth: true });
  if (status !== 200 || json?.code !== 'SUCCESS') throw new Error(`초안 조회 실패 (HTTP ${status})`);
  return json.data;
}

async function draftVersion(request, id) {
  return `"d${(await adminDraft(request, id)).draftVersion}"`;
}

/** 가져오기 직후 아무도 손대지 않은 초안(무대·공연 없음)만 이어서 진행한다. */
function isUntouchedImport(data) {
  const draft = data?.draft ?? {};
  const empty = (value) => !Array.isArray(value) || value.length === 0;
  return empty(draft.stages) && empty(draft.sets);
}

function failureMessage(step, { status, json }) {
  const errors = Array.isArray(json?.data?.errors) ? json.data.errors.join(', ') : '';
  return `${step} 실패 (HTTP ${status}${json?.code ? ` ${json.code}` : ''}) ${errors || json?.message || ''}`.trim();
}

class SkipError extends Error {}

async function publish(request, festival, draft) {
  const imported = await request('POST', `admin/festivals/discovered/${festival.id}/import`, { body: {}, auth: true });
  if (imported.status === 409 && !isUntouchedImport(await adminDraft(request, festival.id))) {
    throw new SkipError('이미 관리 중인 초안이 있음 (관리자 화면에서 확인)');
  }
  if (imported.status === 409) console.log(`  · ${festival.id}: 가져오기만 된 빈 초안을 이어서 진행`);
  if (![200, 201, 409].includes(imported.status)) throw new Error(failureMessage('가져오기', imported));

  const patched = await request('PATCH', `admin/festivals/${festival.id}/draft`, {
    body: draft,
    ifMatch: await draftVersion(request, festival.id),
    auth: true,
  });
  if (patched.status !== 200) throw new Error(`${failureMessage('초안 수정', patched)} — 가져온 초안이 남아 있음`);

  const published = await request('POST', `admin/festivals/${festival.id}/publish`, {
    body: { note: 'Stage 일괄 발행 스크립트 (공개 상세의 승인된 공식 시간표)' },
    ifMatch: await draftVersion(request, festival.id),
    auth: true,
  });
  if (published.status !== 200) throw new Error(`${failureMessage('발행', published)} — 가져온 초안이 남아 있음`);
  return published.json?.data;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.FESTICORE_ADMIN_TOKEN;
  if (options.apply && !token) throw new Error('--apply에는 FESTICORE_ADMIN_TOKEN 환경 변수가 필요합니다.');
  const request = createClient(options.base, token);

  const festivals = options.only
    ? await festivalsByID(request, options.only)
    : (await discoveredFestivals(request)).filter((festival) => festival.status === 'discovered');
  console.log(`${options.apply ? '실행' : '미리보기'}: ${options.base}, 발견 축제 ${festivals.length}개`);
  const summary = { published: 0, ready: 0, skipped: 0, failed: 0 };
  for (const festival of festivals) {
    const label = `${festival.id} ${festival.name}`;
    let draft;
    try {
      draft = buildDraft(await publicDetail(request, festival.id), options.fillMissingEnds);
    } catch (error) {
      console.log(`- 실패 ${label}: ${error.message}`);
      summary.failed += 1;
      continue;
    }
    if (typeof draft === 'string') {
      console.log(`- 건너뜀 ${label}: ${draft}`);
      summary.skipped += 1;
      continue;
    }
    const shape = `${draft.days.length}일, 무대 ${draft.stages.length}개, 공연 ${draft.sets.length}개`;
    if (!options.apply) {
      console.log(`- 발행 가능 ${label}: ${shape}`);
      summary.ready += 1;
      continue;
    }
    try {
      const result = await publish(request, festival, draft);
      console.log(`- 발행 ${label}: ${shape}, 팩 버전 ${result?.packVersion ?? '?'}`);
      summary.published += 1;
    } catch (error) {
      if (error instanceof SkipError) {
        console.log(`- 건너뜀 ${label}: ${error.message}`);
        summary.skipped += 1;
      } else {
        console.log(`- 실패 ${label}: ${error.message}`);
        summary.failed += 1;
      }
    }
  }
  console.log(
    options.apply
      ? `완료: 발행 ${summary.published}, 건너뜀 ${summary.skipped}, 실패 ${summary.failed}`
      : `미리보기 완료: 발행 가능 ${summary.ready}, 건너뜀 ${summary.skipped}, 실패 ${summary.failed}. 실제 발행은 --apply로 실행합니다.`,
  );
  if (summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildDraft, festivalDates, fillEnds, isUntouchedImport, preflight, stageID, validatedBase };
