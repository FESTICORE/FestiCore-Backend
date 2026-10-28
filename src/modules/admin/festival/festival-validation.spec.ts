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
  it('requires a complete verified coordinate pair for directions', () => {
    const location = {
      latitude: 37.66469544695199,
      longitude: 126.742064181796,
      label: 'KINTEX HALL 7/8/9/10',
      source: {
        name: '멜론티켓',
        url: 'https://ticket.melon.com/performance/index.htm?prodId=213793',
        verifiedAt: '2026-10-28T11:00:00.000Z',
      },
    };
    expect(
      validateDraft({
        ...draft,
        venue: location.label,
        directions: { location },
      }),
    ).toEqual([]);
    expect(
      validateDraft({
        ...draft,
        venue: location.label,
        directions: { location: { ...location, longitude: null } },
      }),
    ).toContain(
      'directions.location: 검증된 위도·경도, 공연장 일치 장소명과 HTTPS 출처가 필요',
    );
    expect(validateDraft({ ...draft, directions: { location } })).toContain(
      'directions.location: 검증된 위도·경도, 공연장 일치 장소명과 HTTPS 출처가 필요',
    );
  });

  it('accepts stored set images and rejects external image URLs', () => {
    const set = {
      stageId: 'stg_12345678',
      artist: 'A',
      startsAt: '2026-11-20T13:00:00+09:00',
      endsAt: '2026-11-20T14:00:00+09:00',
    };
    expect(
      validateDraft({
        ...draft,
        sets: [
          {
            ...set,
            imageUrl:
              '/api/v1/festivals/images/00000000-0000-4000-8000-000000000001.webp',
          },
        ],
      }),
    ).toEqual([]);
    expect(
      validateDraft({
        ...draft,
        sets: [{ ...set, imageUrl: 'https://example.com/artist.jpg' }],
      }),
    ).toContain('sets[0]: 보관된 출연진 이미지 경로만 허용');
  });

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

  it('rejects prototype-changing keys in nested patches', () => {
    const patch = JSON.parse(
      '{"source":{"__proto__":{"polluted":true}}}',
    ) as unknown;
    expect(() => mergeDraft(draft, patch)).toThrow(BadRequestException);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('requires at least one stage to publish', () => {
    expect(validateDraft({ ...draft, stages: [] }, true)).toContain(
      'stages: 배열 크기 오류',
    );
  });

  it('keeps a 17-day date-only source as a valid private draft but blocks publication', () => {
    const dateOnly = {
      ...draft,
      eventPeriod: { firstDate: '2026-10-23', lastDate: '2026-11-08' },
      days: [],
    };
    expect(validateDraft(dateOnly)).toEqual([]);
    expect(validateDraft(dateOnly, true)).toContain(
      'days: 발행하려면 검증된 시작/종료 시각 필요',
    );
    expect(() =>
      mergeDraft(dateOnly, { eventPeriod: { firstDate: '2026-10-24' } }),
    ).toThrow(BadRequestException);
  });

  it('accepts up to 32 verified event dates and rejects dates outside the source period', () => {
    const days = Array.from({ length: 32 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 9, 23 + index))
        .toISOString()
        .slice(0, 10);
      return {
        date,
        startsAt: `${date}T12:00:00+09:00`,
        endsAt: `${date}T20:00:00+09:00`,
      };
    });
    const eventPeriod = {
      firstDate: days[0].date,
      lastDate: days[31].date,
    };
    expect(validateDraft({ ...draft, days, eventPeriod })).toEqual([]);
    expect(
      validateDraft({ ...draft, days: [...days, days[31]], eventPeriod }),
    ).toContain(
      'days: 1..32개 필요 (날짜 전용 초안은 eventPeriod와 빈 배열 허용)',
    );
    expect(
      validateDraft({
        ...draft,
        days: [days[0], { ...days[1], date: '2026-12-01' }],
        eventPeriod,
      }),
    ).toContain('days[1]: 날짜 순서 또는 시간 범위 오류');
    expect(
      validateDraft({
        ...draft,
        eventPeriod: { firstDate: '2026-10-23', lastDate: '2026-11-24' },
        days: [],
      }),
    ).toContain('eventPeriod: 첫날부터 마지막 날까지 최대 32일 필요');
  });

  it('accepts ticket links and thumbnail fields in draft patches', () => {
    const next = mergeDraft(draft, {
      thumbUrl: 'https://example.com/poster.webp',
      ticketLinks: [
        { label: '예스24', url: 'https://ticket.yes24.com/Perf/1' },
      ],
    });
    expect(validateDraft(next, true)).toEqual([]);
    expect(next).toMatchObject({
      thumbUrl: 'https://example.com/poster.webp',
      ticketLinks: [
        { label: '예스24', url: 'https://ticket.yes24.com/Perf/1' },
      ],
    });
    expect(
      validateDraft({
        ...draft,
        thumbUrl:
          '/api/v1/festivals/images/00000000-0000-4000-8000-000000000001.webp',
      }),
    ).toEqual([]);
  });

  it('rejects invalid thumbnail and ticket links', () => {
    expect(
      validateDraft({ ...draft, thumbUrl: 'javascript:alert(1)' }),
    ).toContain('thumbUrl: HTTPS URL, 보관 이미지 경로 또는 null 필요');
    expect(
      validateDraft({
        ...draft,
        ticketLinks: [
          { label: '잘못된 링크', url: 'http://ticket.example.com' },
        ],
      }),
    ).toContain('ticketLinks: 최대 5개, 1..20자 라벨과 HTTPS URL 필요');
    expect(
      validateDraft({
        ...draft,
        ticketLinks: [
          { label: '예스24', url: 'https://ticket.example.com/1' },
          { label: '멜론', url: 'https://ticket.example.com/1' },
        ],
      }),
    ).toContain('ticketLinks: 최대 5개, 1..20자 라벨과 HTTPS URL 필요');
    expect(
      validateDraft({
        ...draft,
        ticketLinks: Array.from({ length: 6 }, (_, index) => ({
          label: `예매처 ${index}`,
          url: `https://example.com/${index}`,
        })),
      }),
    ).toContain('ticketLinks: 최대 5개, 1..20자 라벨과 HTTPS URL 필요');
  });
});
