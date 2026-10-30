import {
  buildLiveActivityContentState,
  type LiveActivityContentInput,
} from './live-activity-content';
import type { ApnsService } from './apns.service';

const NOW = new Date('2026-10-24T10:00:00Z');
const festivalId = 'fst_one';

function input(): LiveActivityContentInput {
  return {
    festivalId,
    now: NOW,
    festivalStart: new Date('2026-10-24T00:00:00+09:00'),
    festivalEnd: new Date('2026-10-25T00:00:00+09:00'),
    sets: [
      {
        id: 'set_future',
        festivalId,
        stageId: 'stage_b',
        artist: '다음 가수',
        startsAt: '2026-10-24T10:30:00Z',
        endsAt: '2026-10-24T11:30:00Z',
      },
      {
        id: 'set_live',
        festivalId,
        stageId: 'stage_a',
        artist: '현재 가수',
        startsAt: '2026-10-24T09:30:00Z',
        endsAt: '2026-10-24T10:00:01Z',
      },
    ],
    flagsEnabled: true,
    flags: [
      {
        id: 'flg_one',
        festivalId,
        status: 'active',
        visibility: 'public',
        hidden: false,
        zoneId: 'zone_a',
        activity: 'sing',
      },
    ],
    member: {
      savedSetIds: ['set_future'],
      followedFlagIds: ['flg_one'],
      pinnedFlagId: 'flg_one',
      crew: {
        id: 'crew_one',
        festivalId,
        name: '친구들',
        archived: false,
        members: [{ state: 'here' }, { state: 'eating' }, { state: null }],
        gather: { zoneId: 'zone_b', at: '2026-10-24T09:55:00Z' },
      },
    },
  };
}

describe('buildLiveActivityContentState', () => {
  it('calculates active stages and a member-only next set from the same festival', () => {
    const state = buildLiveActivityContentState(input());
    expect(state).toMatchObject({
      phase: 'ongoing',
      startDate: Date.parse('2026-10-23T15:00:00Z') / 1000 - 978307200,
      endDate: Date.parse('2026-10-24T15:00:00Z') / 1000 - 978307200,
    });
    expect(state.nowStages).toEqual([
      {
        setId: 'set_live',
        stageId: 'stage_a',
        artist: '현재 가수',
        startsAt: '2026-10-24T09:30:00Z',
        endsAt: '2026-10-24T10:00:01Z',
      },
    ]);
    expect(state.nextMine).toEqual({
      setId: 'set_future',
      stageId: 'stage_b',
      artist: '다음 가수',
      startsAt: '2026-10-24T10:30:00Z',
    });
    expect(state.pinnedFlag).toEqual({
      flagId: 'flg_one',
      status: 'active',
      zoneId: 'zone_a',
      activity: 'sing',
    });
    expect(state.crewSummary).toEqual({
      crewId: 'crew_one',
      name: '친구들',
      memberCount: 3,
      hereCount: 1,
      gatherZoneId: 'zone_b',
    });
    expect(state.leaveAt).toBeNull();
  });

  it('uses inclusive starts and exclusive ends', () => {
    const source = input();
    source.now = new Date('2026-10-24T09:30:00Z');
    expect(buildLiveActivityContentState(source).nowStages).toHaveLength(1);
    source.now = new Date('2026-10-24T10:00:01Z');
    expect(buildLiveActivityContentState(source).nowStages).toEqual([]);
    source.now = new Date('2026-10-24T10:30:00Z');
    expect(buildLiveActivityContentState(source).nextMine).toBeNull();
  });

  it('switches phase at the festival boundaries while retaining the published dates', () => {
    const source = input();
    const startDate = source.festivalStart.getTime() / 1000 - 978307200;
    const endDate = source.festivalEnd.getTime() / 1000 - 978307200;
    for (const [now, phase] of [
      ['2026-10-23T14:59:59Z', 'upcoming'],
      ['2026-10-23T15:00:00Z', 'ongoing'],
      ['2026-10-24T14:59:59Z', 'ongoing'],
      ['2026-10-24T15:00:00Z', 'finished'],
    ] as const) {
      source.now = new Date(now);
      expect(buildLiveActivityContentState(source)).toMatchObject({
        phase,
        startDate,
        endDate,
      });
    }
  });

  it('rejects an absent or reversed festival period', () => {
    const source = input();
    source.festivalEnd = source.festivalStart;
    expect(() => buildLiveActivityContentState(source)).toThrow(RangeError);
  });

  it('never includes member-only data for an anonymous device', () => {
    const source = input();
    source.member = null;
    const state = buildLiveActivityContentState(source);
    expect(state.nowStages).toHaveLength(1);
    expect(state.nextMine).toBeNull();
    expect(state.pinnedFlag).toBeNull();
    expect(state.crewSummary).toBeNull();
  });

  it('hides the pinned flag when the festival has disabled flags', () => {
    const source = input();
    source.flagsEnabled = false;
    expect(buildLiveActivityContentState(source).pinnedFlag).toBeNull();
  });

  it('produces a state directly accepted by the APNs update method', () => {
    const state: Parameters<ApnsService['sendLiveActivityUpdate']>[2] =
      buildLiveActivityContentState(input());
    expect(state).toHaveProperty('nowStages');
  });

  it('excludes unpublished festival IDs and invalid intervals', () => {
    const source = input();
    source.sets = [
      ...source.sets,
      { ...source.sets[0], id: 'other', festivalId: 'fst_other' },
      {
        ...source.sets[0],
        id: 'missing_end',
        endsAt: null,
        startsAt: '2026-10-24T09:00:00Z',
      },
      {
        ...source.sets[0],
        id: 'bad_zone',
        startsAt: '2026-10-24T09:00:00',
        endsAt: '2026-10-24T11:00:00Z',
      },
      {
        ...source.sets[0],
        id: 'reversed',
        startsAt: '2026-10-24T09:00:00Z',
        endsAt: '2026-10-24T08:00:00Z',
      },
    ];
    expect(buildLiveActivityContentState(source).nowStages).toHaveLength(1);
  });

  it('does not choose a future saved set whose end is before its start', () => {
    const source = input();
    source.sets = [
      { ...source.sets[0], endsAt: '2026-10-24T10:10:00Z' },
      {
        ...source.sets[0],
        id: 'set_later',
        startsAt: '2026-10-24T11:00:00Z',
        endsAt: null,
      },
    ];
    source.member = {
      ...source.member!,
      savedSetIds: ['set_future', 'set_later'],
    };
    expect(buildLiveActivityContentState(source).nextMine?.setId).toBe(
      'set_later',
    );
  });

  it('does not expose hidden, unfollowed, cross-festival or inactive flags', () => {
    for (const patch of [
      { hidden: true },
      { visibility: 'private' as const },
      { festivalId: 'fst_other' },
      { status: 'ended' as const },
    ]) {
      const source = input();
      source.flags = [{ ...source.flags[0], ...patch }];
      expect(buildLiveActivityContentState(source).pinnedFlag).toBeNull();
    }
    const source = input();
    source.member = { ...source.member!, followedFlagIds: [] };
    expect(buildLiveActivityContentState(source).pinnedFlag).toBeNull();
  });

  it('hides archived/cross-festival crews and expires gather after ten minutes', () => {
    const source = input();
    const crew = source.member?.crew;
    if (!crew) throw new Error('test fixture requires a crew');
    source.now = new Date('2026-10-24T10:05:00Z');
    expect(
      buildLiveActivityContentState(source).crewSummary?.gatherZoneId,
    ).toBeNull();
    source.member = {
      ...source.member!,
      crew: { ...crew, archived: true },
    };
    expect(buildLiveActivityContentState(source).crewSummary).toBeNull();
    source.member = {
      ...source.member,
      crew: { ...crew, festivalId: 'fst_other' },
    };
    expect(buildLiveActivityContentState(source).crewSummary).toBeNull();
  });

  it('sorts and caps concurrent stages for a bounded APNs state', () => {
    const source = input();
    source.sets = Array.from({ length: 12 }, (_, index) => ({
      ...source.sets[1],
      id: `set_${String(index).padStart(2, '0')}`,
      stageId: `stage_${String(11 - index).padStart(2, '0')}`,
    }));
    const stages = buildLiveActivityContentState(source).nowStages;
    expect(stages).toHaveLength(8);
    expect(stages[0].stageId).toBe('stage_00');
    expect(stages[7].stageId).toBe('stage_07');
  });

  it('rejects a nonsensical calculation clock', () => {
    const source = input();
    source.now = new Date(NaN);
    expect(() => buildLiveActivityContentState(source)).toThrow(RangeError);
  });
});
