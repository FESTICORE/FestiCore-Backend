type BuildDraft = (
  detail: unknown,
  fillMissingEnds: boolean,
) => { sets: { imageUrl?: string }[] };

/* eslint-disable @typescript-eslint/no-require-imports -- 스크립트는 CommonJS 모듈이다. */
const { buildDraft } =
  require('../../../../scripts/publish-stage-festivals.cjs') as {
    buildDraft: BuildDraft;
  };

describe('publish-stage-festivals buildDraft', () => {
  const stored =
    '/api/v1/festivals/images/123e4567-e89b-42d3-a456-426614174000.webp';
  const set = (
    artist: string,
    startsAt: string,
    endsAt: string,
    imageUrl: unknown,
  ) => ({
    artist,
    date: '2026-10-24',
    stageName: '메인',
    startsAt,
    endsAt,
    imageUrl,
  });

  it('keeps stored artist image paths from the public timetable', () => {
    const draft = buildDraft(
      {
        firstDate: '2026-10-24',
        lastDate: '2026-10-24',
        timetable: [
          set(
            '봄빛 밴드',
            '2026-10-24T13:00:00+09:00',
            '2026-10-24T14:00:00+09:00',
            stored,
          ),
          set(
            '여름 밴드',
            '2026-10-24T14:00:00+09:00',
            '2026-10-24T15:00:00+09:00',
            'https://example.com/a.jpg',
          ),
          set(
            '가을 밴드',
            '2026-10-24T15:00:00+09:00',
            '2026-10-24T16:00:00+09:00',
            null,
          ),
        ],
      },
      false,
    );

    expect(
      draft.sets.map((item: { imageUrl?: string }) => item.imageUrl),
    ).toEqual([stored, undefined, undefined]);
  });
});
