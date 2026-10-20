import { BadRequestException } from '@nestjs/common';
import { mergeDraft, validateDraft } from './festival-validation';

const draft = {
  id: 'fst_12345678',
  name: 'Festival',
  venue: 'Venue',
  timezone: 'Asia/Seoul',
  days: [
    {
      date: '2026-11-20',
      startsAt: '2026-11-20T12:00:00+09:00',
      endsAt: '2026-11-20T22:00:00+09:00',
    },
  ],
  flagsEnabled: false,
  stages: [{ id: 'stg_12345678', name: 'Main', order: 1 }],
  sets: [],
  zones: [],
  flags: [],
  checklist: [],
  rules: [],
  mapImageUrl: null,
  mapAspect: null,
  source: { name: 'Official', verifiedAt: '2026-11-18T12:00:00+09:00' },
};

describe('festival draft validation', () => {
  it('rejects overlapping sets on the same stage', () => {
    const errors = validateDraft(
      {
        ...draft,
        sets: [
          {
            stageId: 'stg_12345678',
            artist: 'A',
            startsAt: '2026-11-20T13:00:00+09:00',
            endsAt: '2026-11-20T14:00:00+09:00',
          },
          {
            stageId: 'stg_12345678',
            artist: 'B',
            startsAt: '2026-11-20T13:30:00+09:00',
            endsAt: '2026-11-20T15:00:00+09:00',
          },
        ],
      },
      true,
    );
    expect(errors).toContain('stage stg_12345678: 세트 시간 겹침');
  });

  it('uses JSON Merge Patch null deletion and forbids immutable fields', () => {
    expect(
      mergeDraft(
        {
          ...draft,
          source: {
            name: 'A',
            url: 'https://a',
            verifiedAt: '2026-11-18T12:00:00+09:00',
          },
        },
        { source: { url: null } },
      ).source,
    ).toEqual({ name: 'A', verifiedAt: '2026-11-18T12:00:00+09:00' });
    expect(() => mergeDraft(draft, { id: 'fst_other' })).toThrow(
      BadRequestException,
    );
  });

  it('requires at least one stage to publish', () => {
    expect(validateDraft({ ...draft, stages: [] }, true)).toContain(
      'stages: 배열 크기 오류',
    );
  });
});
