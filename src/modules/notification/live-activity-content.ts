/** Inputs must come from the published festival and the authenticated member's own rows. */
export interface LiveActivitySet {
  id: string;
  festivalId: string;
  stageId: string;
  artist: string;
  startsAt: string;
  endsAt: string | null;
}

export interface LiveActivityFlag {
  id: string;
  festivalId: string;
  status: 'scheduled' | 'active' | 'resting' | 'ended';
  visibility: 'public' | 'private';
  hidden: boolean;
  zoneId: string | null;
  activity: string | null;
}

export interface LiveActivityCrew {
  id: string;
  festivalId: string;
  name: string;
  archived: boolean;
  members: ReadonlyArray<{
    state: 'here' | 'eating' | 'toilet' | 'leaving' | null;
  }>;
  gather: { zoneId: string; at: string } | null;
}

export interface LiveActivityMember {
  savedSetIds: readonly string[];
  followedFlagIds: readonly string[];
  pinnedFlagId: string | null;
  crew: LiveActivityCrew | null;
}

export interface LiveActivityContentInput {
  festivalId: string;
  now: Date;
  festivalStart: Date;
  festivalEnd: Date;
  sets: readonly LiveActivitySet[];
  flagsEnabled: boolean;
  flags: readonly LiveActivityFlag[];
  member: LiveActivityMember | null;
}

export type LiveActivityContentState = {
  phase: 'upcoming' | 'ongoing' | 'finished';
  /** Swift JSONEncoder's default Date representation: seconds since 2001-01-01. */
  startDate: number;
  endDate: number;
  nowStages: Array<{
    setId: string;
    stageId: string;
    artist: string;
    startsAt: string;
    endsAt: string;
  }>;
  nextMine: {
    setId: string;
    stageId: string;
    artist: string;
    startsAt: string;
  } | null;
  pinnedFlag: {
    flagId: string;
    status: 'active' | 'resting';
    zoneId: string | null;
    activity: string | null;
  } | null;
  crewSummary: {
    crewId: string;
    name: string;
    memberCount: number;
    hereCount: number;
    gatherZoneId: string | null;
  } | null;
  leaveAt: null;
};

const MAX_ACTIVE_SETS = 8;
const GATHER_LIFETIME_MS = 10 * 60_000;
const APPLE_REFERENCE_EPOCH_SECONDS = 978_307_200;
const WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function timestamp(value: string): number | null {
  if (!WITH_TIMEZONE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildLiveActivityContentState(
  input: LiveActivityContentInput,
): LiveActivityContentState {
  const now = input.now.getTime();
  if (!Number.isFinite(now)) throw new RangeError('now must be a valid Date');
  const festivalStart = input.festivalStart.getTime();
  const festivalEnd = input.festivalEnd.getTime();
  if (
    !Number.isFinite(festivalStart) ||
    !Number.isFinite(festivalEnd) ||
    festivalEnd <= festivalStart
  )
    throw new RangeError('festival period must be valid and ordered');

  const sets = input.sets
    .filter((set) => set.festivalId === input.festivalId)
    .map((set) => ({
      set,
      start: timestamp(set.startsAt),
      end: set.endsAt ? timestamp(set.endsAt) : null,
    }))
    .filter(
      (entry) =>
        entry.start !== null && (entry.end === null || entry.end > entry.start),
    )
    .sort(
      (left, right) =>
        left.start! - right.start! ||
        left.set.stageId.localeCompare(right.set.stageId) ||
        left.set.id.localeCompare(right.set.id),
    );

  const nowStages = sets
    .filter(({ start, end }) => start! <= now && end !== null && now < end)
    .slice(0, MAX_ACTIVE_SETS)
    .map(({ set }) => ({
      setId: set.id,
      stageId: set.stageId,
      artist: set.artist,
      startsAt: set.startsAt,
      endsAt: set.endsAt!,
    }));

  const member = input.member;
  const saved = new Set(member?.savedSetIds ?? []);
  const next = member
    ? sets.find(({ set, start }) => saved.has(set.id) && start! > now)?.set
    : undefined;
  const pinned =
    input.flagsEnabled && member?.pinnedFlagId
      ? input.flags.find(
          (flag) =>
            flag.id === member.pinnedFlagId &&
            flag.festivalId === input.festivalId &&
            flag.visibility === 'public' &&
            !flag.hidden &&
            member.followedFlagIds.includes(flag.id) &&
            (flag.status === 'active' || flag.status === 'resting'),
        )
      : undefined;
  const crew = member?.crew;
  const activeCrew =
    crew && !crew.archived && crew.festivalId === input.festivalId;
  const gatherAt = crew?.gather ? timestamp(crew.gather.at) : null;
  const recentGather =
    activeCrew &&
    gatherAt !== null &&
    gatherAt <= now &&
    now - gatherAt < GATHER_LIFETIME_MS;

  return {
    phase:
      now < festivalStart
        ? 'upcoming'
        : now < festivalEnd
          ? 'ongoing'
          : 'finished',
    startDate: festivalStart / 1000 - APPLE_REFERENCE_EPOCH_SECONDS,
    endDate: festivalEnd / 1000 - APPLE_REFERENCE_EPOCH_SECONDS,
    nowStages,
    nextMine: next
      ? {
          setId: next.id,
          stageId: next.stageId,
          artist: next.artist,
          startsAt: next.startsAt,
        }
      : null,
    pinnedFlag: pinned
      ? {
          flagId: pinned.id,
          status: pinned.status as 'active' | 'resting',
          zoneId: pinned.zoneId,
          activity: pinned.activity,
        }
      : null,
    crewSummary: activeCrew
      ? {
          crewId: crew.id,
          name: crew.name,
          memberCount: crew.members.length,
          hereCount: crew.members.filter((item) => item.state === 'here')
            .length,
          gatherZoneId: recentGather ? crew.gather!.zoneId : null,
        }
      : null,
    leaveAt: null,
  };
}
