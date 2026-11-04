const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildDraft,
  dateOnlyDraft,
  festivalDates,
  main,
  matchingPublishedSource,
  validatedBase,
} = require('./publish-stage-festivals.cjs');
const { canonicalFestivalId } = require('./festival-aliases.cjs');

const festival = {
  id: 'fst_0123456789abcdef',
  name: '공식 축제',
  venue: '공연장',
  firstDate: '2026-11-19',
  lastDate: '2026-11-20',
};

test('운영 호스트에는 명시적 허용이 필요하고 다른 호스트는 거부한다', () => {
  assert.throws(() => validatedBase('https://festicore.up.railway.app', false));
  assert.equal(
    validatedBase('https://festicore.up.railway.app', true),
    'https://festicore.up.railway.app',
  );
  assert.throws(() => validatedBase('https://other.example.com', true));
});

test('COUNTDOWN의 예매처 중복 ID는 공식 축제 ID 하나로 연결한다', async () => {
  const canonical = 'fst_c39663182b10a105';
  const aliases = ['fst_546789e480f1630f', 'fst_c6dacea8997cd72b'];
  for (const alias of aliases)
    assert.equal(canonicalFestivalId(alias), canonical);
  const previousFetch = global.fetch;
  const previousLog = console.log;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 'SUCCESS',
          data: {
            id: canonical,
            name: 'COUNTDOWN FANTASY 2026-2027',
            venue: 'KINTEX',
            firstDate: '2026-12-31',
            lastDate: '2027-01-01',
            status: 'discovered',
            packVersion: 0,
            timetable: [],
          },
        }),
    };
  };
  console.log = () => {};
  try {
    const summary = await main(['--only', [...aliases, canonical].join(',')]);
    assert.deepEqual(summary, {
      published: 0,
      ready: 1,
      skipped: 0,
      failed: 0,
    });
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.url.endsWith(canonical)));
    assert.ok(requests.every((request) => request.method === 'GET'));
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
  }
});

test('시간표가 없을 때 정확한 날짜 범위만 있는 빈 팩 초안을 만든다', () => {
  assert.deepEqual(festivalDates(festival), ['2026-11-19', '2026-11-20']);
  assert.deepEqual(buildDraft({ ...festival, timetable: [] }, false), {
    days: [],
    stages: [],
    sets: [],
    timetableStatus: 'unpublished',
  });
  assert.equal(
    dateOnlyDraft({ ...festival, lastDate: '2026-12-30' }),
    '검증된 축제 날짜 범위 없음',
  );
  assert.equal(
    dateOnlyDraft({ ...festival, firstDate: null }),
    '검증된 축제 날짜 범위 없음',
  );
});

test('Stage 발행 시간표는 축제 식별 정보가 모두 같을 때만 재사용한다', () => {
  const stage = { ...festival, packVersion: 1 };
  assert.equal(matchingPublishedSource(festival, stage), true);
  assert.equal(
    matchingPublishedSource(festival, { ...stage, packVersion: 0 }),
    false,
  );
  assert.equal(
    matchingPublishedSource(festival, { ...stage, name: '다른 축제' }),
    false,
  );
  assert.equal(
    matchingPublishedSource(festival, { ...stage, venue: '다른 장소' }),
    false,
  );
  assert.equal(
    matchingPublishedSource(festival, { ...stage, lastDate: '2026-11-21' }),
    false,
  );
  assert.equal(
    matchingPublishedSource(festival, { ...stage, id: 'fst_other' }),
    false,
  );
});

test('승인된 공연 시작·종료 시각이 있으면 무대·일자·세트를 유지한다', () => {
  const draft = buildDraft(
    {
      ...festival,
      timetable: [
        {
          artist: '가수 A',
          date: '2026-11-19',
          stageName: '메인',
          startsAt: '2026-11-19T18:00:00+09:00',
          endsAt: '2026-11-19T19:00:00+09:00',
        },
        {
          artist: '가수 B',
          date: '2026-11-20',
          stageName: '메인',
          startsAt: '2026-11-20T18:00:00+09:00',
          endsAt: '2026-11-20T19:00:00+09:00',
        },
      ],
    },
    false,
  );
  assert.equal(draft.days.length, 2);
  assert.equal(draft.stages.length, 1);
  assert.equal(draft.sets.length, 2);
});

test('이미 발행한 축제를 다시 실행해도 관리자 변경 요청을 보내지 않는다', async () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    const data = String(url).includes('festicore-dev.up.railway.app')
      ? { items: [], nextCursor: null }
      : { ...festival, packVersion: 1 };
    return {
      status: 200,
      text: async () => JSON.stringify({ code: 'SUCCESS', data }),
    };
  };
  console.log = () => {};
  try {
    const summary = await main(
      [
        '--base',
        'https://festicore.up.railway.app',
        '--allow-prod',
        '--only',
        festival.id,
        '--apply',
      ],
      'test-token',
    );
    assert.deepEqual(summary, {
      published: 0,
      ready: 0,
      skipped: 1,
      failed: 0,
    });
    assert.ok(requests.every((request) => request.method === 'GET'));
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
  }
});

test('승인 시간표가 잘못되면 날짜 전용 팩으로 대체하지 않고 관리자 요청을 막는다', async () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const requests = [];
  const invalidDetail = {
    ...festival,
    status: 'discovered',
    packVersion: 0,
    timetable: [
      {
        artist: '가수',
        date: '2026-11-19',
        stageName: '메인',
        startsAt: '2026-11-19T18:00:00+09:00',
        endsAt: null,
      },
    ],
  };
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    const data = String(url).includes('festicore-dev.up.railway.app')
      ? { items: [], nextCursor: null }
      : invalidDetail;
    return {
      status: 200,
      text: async () => JSON.stringify({ code: 'SUCCESS', data }),
    };
  };
  console.log = () => {};
  try {
    const summary = await main(
      [
        '--base',
        'https://festicore.up.railway.app',
        '--allow-prod',
        '--only',
        festival.id,
        '--apply',
      ],
      'test-token',
    );
    assert.deepEqual(summary, {
      published: 0,
      ready: 0,
      skipped: 1,
      failed: 0,
    });
    assert.ok(requests.every((request) => request.method === 'GET'));
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
  }
});
