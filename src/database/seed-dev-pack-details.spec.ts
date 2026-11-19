import type { DataSource, EntityManager } from 'typeorm';
import {
  AdminFestival,
  AdminFestivalVersion,
  type FestivalDocument,
} from '../modules/admin/festival/festival.entity';
import {
  DEV_CHECKLIST,
  DEV_RULES,
  hasPackDetail,
  seedDevPackDetails,
  seedMode,
  withDevPackDetail,
} from './seed-dev-pack-details';

const source = { name: '주최측 공지', url: 'https://example.com/notice' };

/** 관리 초안 생성 기본값과 같은 빈 가는 길 */
function emptyDirections(): FestivalDocument {
  return {
    shuttle: null,
    transit: null,
    parking: null,
    memo: null,
    lastShuttleAt: null,
    lastTrainAt: null,
    mapLinks: { naver: null, kakao: null },
    location: null,
    source,
  };
}

function document(patch: FestivalDocument = {}): FestivalDocument {
  return {
    name: '원더리벳 2026',
    venue: '킨텍스 제2전시장',
    timezone: 'Asia/Seoul',
    days: [
      {
        date: '2026-10-20',
        startsAt: '2026-10-20T13:00:00+09:00',
        endsAt: '2026-10-20T23:00:00+09:00',
      },
      {
        date: '2026-10-21',
        startsAt: '2026-10-21T12:00:00+09:00',
        endsAt: '2026-10-21T22:00:00+09:00',
      },
    ],
    flagsEnabled: true,
    stages: [{ id: 'stg_main', name: '메인' }],
    sets: [],
    zones: [],
    flags: [],
    directions: emptyDirections(),
    checklist: [],
    rules: [],
    source,
    ...patch,
  };
}

type Row = Pick<
  AdminFestival,
  'id' | 'draft' | 'draftVersion' | 'published' | 'publishedVersion'
>;

function harness(rows: Row[]) {
  const query = {
    setLock: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    getMany: jest.fn(() =>
      Promise.resolve(rows.filter((row) => row.published)),
    ),
  };
  query.setLock.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  const festivalSave = jest.fn((row: Row) => Promise.resolve(row));
  const versionSave = jest.fn((value: unknown) => Promise.resolve(value));
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === AdminFestival)
        return { createQueryBuilder: () => query, save: festivalSave };
      if (entity === AdminFestivalVersion) return { save: versionSave };
      throw new Error('unexpected repository');
    }),
  } as unknown as EntityManager;
  const db = {
    transaction: (work: (manager: EntityManager) => Promise<unknown>) =>
      work(manager),
  } as unknown as DataSource;
  return { db, festivalSave, versionSave };
}

describe('개발 팩 상세 시드', () => {
  it('develop 환경에서만 열고, --apply가 없으면 미리보기만 한다', () => {
    expect(() =>
      seedMode({ RAILWAY_ENVIRONMENT_NAME: 'production' }, ['--apply']),
    ).toThrow('RAILWAY_ENVIRONMENT_NAME=develop');
    expect(() => seedMode({}, [])).toThrow('RAILWAY_ENVIRONMENT_NAME=develop');
    expect(seedMode({ RAILWAY_ENVIRONMENT_NAME: 'develop' }, [])).toBe(
      'preview',
    );
    expect(seedMode({ RAILWAY_ENVIRONMENT_NAME: 'develop' }, ['--apply'])).toBe(
      'apply',
    );
  });

  it('출처·장소만 있는 빈 가는 길은 비어 있다고 보고, 관리자 값이 하나라도 있으면 채워진 것으로 본다', () => {
    expect(hasPackDetail(document())).toBe(false);
    expect(hasPackDetail(null)).toBe(false);
    expect(
      hasPackDetail(
        document({ directions: { ...emptyDirections(), memo: '메모' } }),
      ),
    ).toBe(true);
    expect(
      hasPackDetail(
        document({
          directions: {
            ...emptyDirections(),
            mapLinks: { naver: 'https://map.naver.com/x', kakao: null },
          },
        }),
      ),
    ).toBe(true);
    expect(
      hasPackDetail(
        document({
          directions: {
            ...emptyDirections(),
            lastDepartures: [
              { date: '2026-10-20', shuttleAt: null, trainAt: null },
            ],
          },
        }),
      ),
    ).toBe(true);
    expect(hasPackDetail(document({ checklist: [{ id: 'a' }] }))).toBe(true);
    expect(hasPackDetail(document({ rules: ['캔'] }))).toBe(true);
  });

  it('시안 값으로 채우고 마지막 공연 종료 40·52분 뒤를 마지막 셔틀·막차로 적는다', () => {
    const seeded = withDevPackDetail(document());
    const directions = seeded.directions as FestivalDocument;

    expect(directions.source).toEqual(source);
    expect(directions.location).toBeNull();
    expect(directions.lastShuttleAt).toBe('2026-10-21T22:40:00+09:00');
    expect(directions.lastTrainAt).toBe('2026-10-21T22:52:00+09:00');
    expect(directions.mapLinks).toEqual({
      naver: `https://map.naver.com/p/search/${encodeURIComponent('킨텍스 제2전시장')}`,
      kakao: `https://map.kakao.com/link/search/${encodeURIComponent('킨텍스 제2전시장')}`,
    });
    expect(seeded.checklist).toEqual(DEV_CHECKLIST);
    expect(seeded.rules).toEqual(DEV_RULES);
    expect(hasPackDetail(seeded)).toBe(true);

    const noTime = withDevPackDetail(document({ days: [] }))
      .directions as FestivalDocument;
    expect(noTime.lastShuttleAt).toBeNull();
    expect(noTime.lastTrainAt).toBeNull();
  });

  it('미리보기는 바꿀 축제만 알리고 아무것도 저장하지 않는다', async () => {
    const empty = {
      id: 'fst_empty',
      draft: document(),
      draftVersion: 3,
      published: document(),
      publishedVersion: 5,
    };
    const { db, festivalSave, versionSave } = harness([empty]);

    await expect(seedDevPackDetails(db, 'preview')).resolves.toEqual({
      mode: 'preview',
      changed: ['fst_empty'],
      skipped: [],
    });
    expect(festivalSave).not.toHaveBeenCalled();
    expect(versionSave).not.toHaveBeenCalled();
    expect(empty.publishedVersion).toBe(5);
  });

  it('빈 축제만 초안·발행본을 채워 버전을 올리고, 관리자 값이 있는 축제는 건너뛰며, 다시 실행하면 바뀌지 않는다', async () => {
    const empty = {
      id: 'fst_empty',
      draft: document(),
      draftVersion: 3,
      published: document({ packVersion: 5 }),
      publishedVersion: 5,
    };
    const curated = {
      id: 'fst_curated',
      draft: document({ rules: ['드론'] }),
      draftVersion: 2,
      published: document({ rules: ['드론'] }),
      publishedVersion: 2,
    };
    const draftOnly = {
      id: 'fst_draft_only',
      draft: document({ checklist: [{ id: 'mine', label: '내 항목' }] }),
      draftVersion: 1,
      published: document(),
      publishedVersion: 1,
    };
    const { db, festivalSave, versionSave } = harness([
      empty,
      curated,
      draftOnly,
    ]);
    const now = new Date('2026-11-09T01:02:03.456Z');

    await expect(seedDevPackDetails(db, 'apply', now)).resolves.toEqual({
      mode: 'apply',
      changed: ['fst_empty'],
      skipped: ['fst_curated', 'fst_draft_only'],
    });
    expect(festivalSave).toHaveBeenCalledTimes(1);
    expect(empty.draftVersion).toBe(4);
    expect(empty.publishedVersion).toBe(6);
    expect(empty.published).toMatchObject({
      packVersion: 6,
      packUpdatedAt: '2026-11-09T01:02:03Z',
      rules: DEV_RULES,
    });
    expect(empty.draft.checklist).toEqual(DEV_CHECKLIST);
    expect(versionSave).toHaveBeenCalledWith(
      expect.objectContaining({
        festivalId: 'fst_empty',
        packVersion: 6,
        publishedBy: null,
        note: 'Dev pack detail seed',
      }),
    );
    expect(curated.publishedVersion).toBe(2);
    expect(draftOnly.publishedVersion).toBe(1);

    await expect(seedDevPackDetails(db, 'apply', now)).resolves.toEqual({
      mode: 'apply',
      changed: [],
      skipped: ['fst_empty', 'fst_curated', 'fst_draft_only'],
    });
    expect(festivalSave).toHaveBeenCalledTimes(1);
    expect(versionSave).toHaveBeenCalledTimes(1);
    expect(empty.publishedVersion).toBe(6);
  });

  it('원래 문서에 있던 검증 오류는 시드를 막지 않는다', async () => {
    const legacy = {
      id: 'fst_legacy',
      draft: document({ timezone: 'UTC' }),
      draftVersion: 1,
      published: document({ timezone: 'UTC' }),
      publishedVersion: 1,
    };
    const { db, festivalSave } = harness([legacy]);

    await expect(seedDevPackDetails(db, 'apply')).resolves.toMatchObject({
      changed: ['fst_legacy'],
    });
    expect(festivalSave).toHaveBeenCalledTimes(1);
  });
});
