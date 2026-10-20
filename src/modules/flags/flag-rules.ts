import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Flag, FlagActivity, FlagLifecycle } from './flag.entity';

export const FLAG_TAGS = new Set(['slam', 'sing', 'train', 'calm', 'newbie']);
export const ACTIVITIES = new Set(['slam', 'sing', 'train', 'calm']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateProfilePatch(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length === 0)
    throw new BadRequestException({
      code: 'VALIDATION',
      message: '수정할 필드가 필요합니다.',
    });
  const allowed = new Set([
    'name',
    'bio',
    'tags',
    'plan',
    'planVisible',
    'homeZoneId',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new BadRequestException({
      code: 'VALIDATION',
      message: '허용되지 않은 프로필 필드입니다.',
    });
  if (
    value.name !== undefined &&
    (typeof value.name !== 'string' ||
      [...value.name].length < 2 ||
      [...value.name].length > 20)
  )
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'name은 2..20자여야 합니다.',
    });
  if (
    value.bio !== undefined &&
    value.bio !== null &&
    (typeof value.bio !== 'string' || [...value.bio].length > 60)
  )
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'bio는 60자 이하여야 합니다.',
    });
  if (
    value.tags !== undefined &&
    (!Array.isArray(value.tags) ||
      value.tags.length < 1 ||
      value.tags.length > 3 ||
      new Set(value.tags).size !== value.tags.length ||
      value.tags.some(
        (tag: unknown) => typeof tag !== 'string' || !FLAG_TAGS.has(tag),
      ))
  )
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'tags는 허용된 1..3개 고유 값이어야 합니다.',
    });
  if (
    value.plan !== undefined &&
    (!Array.isArray(value.plan) ||
      value.plan.length > 30 ||
      new Set(value.plan).size !== value.plan.length ||
      value.plan.some((id) => typeof id !== 'string'))
  )
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'plan은 30개 이하의 고유 셋 ID여야 합니다.',
    });
  if (value.planVisible !== undefined && typeof value.planVisible !== 'boolean')
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'planVisible은 boolean이어야 합니다.',
    });
  if (
    value.homeZoneId !== undefined &&
    value.homeZoneId !== null &&
    typeof value.homeZoneId !== 'string'
  )
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'homeZoneId가 올바르지 않습니다.',
    });
  return value;
}

export function nextStatus(
  flag: Flag,
  input: unknown,
  now = new Date(),
): Pick<Flag, 'status' | 'zoneId' | 'activity' | 'restartDate'> {
  if (
    !isRecord(input) ||
    !Object.keys(input).every((key) =>
      ['zoneId', 'activity', 'status', 'restart', 'clientAt'].includes(key),
    )
  )
    throw new BadRequestException({
      code: 'VALIDATION',
      message: '상태 요청 형식이 올바르지 않습니다.',
    });
  const { zoneId, activity, status, restart, clientAt } = input;
  if (typeof clientAt !== 'string' || Number.isNaN(Date.parse(clientAt)))
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'clientAt이 필요합니다.',
    });
  const clientTime = Date.parse(clientAt);
  if (clientTime > now.getTime() + 5 * 60_000)
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'clientAt이 미래입니다.',
    });
  if (flag.statusUpdatedAt && clientTime < flag.statusUpdatedAt.getTime())
    throw new ConflictException({
      code: 'STATUS_STALE',
      current: statusView(flag),
    });
  if (zoneId === undefined && activity === undefined && status === undefined)
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'zoneId, activity, status 중 하나가 필요합니다.',
    });
  if (zoneId !== undefined && (typeof zoneId !== 'string' || !zoneId))
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'zoneId가 올바르지 않습니다.',
    });
  if (activity !== undefined && !ACTIVITIES.has(activity as string))
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'activity가 올바르지 않습니다.',
    });
  if (status !== undefined && status !== 'resting' && status !== 'ended')
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'status가 올바르지 않습니다.',
    });
  if (status && activity)
    throw new BadRequestException({
      code: 'VALIDATION',
      message: 'status와 activity를 동시에 보낼 수 없습니다.',
    });
  const reject = () => {
    throw new ConflictException({
      code: 'FLAG_TRANSITION',
      message: '허용되지 않은 상태 전이입니다.',
    });
  };
  let next: FlagLifecycle = flag.status;
  let nextZone = flag.zoneId;
  let nextActivity: FlagActivity | null = flag.activity;
  let restartDate = flag.restartDate;
  if (flag.status === 'scheduled') {
    if (status === 'ended' && zoneId === undefined) {
      next = 'ended';
      nextActivity = null;
      nextZone = null;
    } else if (
      zoneId !== undefined &&
      activity !== undefined &&
      status === undefined
    ) {
      next = 'active';
      nextZone = zoneId;
      nextActivity = activity as FlagActivity;
    } else reject();
  } else if (flag.status === 'active') {
    if (status === 'resting' && zoneId === undefined) {
      next = 'resting';
      nextActivity = 'resting';
    } else if (status === 'ended' && zoneId === undefined) {
      next = 'ended';
      nextActivity = null;
      nextZone = null;
    } else if (
      status === undefined &&
      (zoneId !== undefined) !== (activity !== undefined)
    ) {
      nextZone = zoneId ?? nextZone;
      nextActivity = (activity as FlagActivity | undefined) ?? nextActivity;
    } else reject();
  } else if (flag.status === 'resting') {
    if (status === 'ended' && zoneId === undefined) {
      next = 'ended';
      nextActivity = null;
      nextZone = null;
    } else if (
      status === undefined &&
      activity !== undefined &&
      zoneId === undefined
    ) {
      next = 'active';
      nextActivity = activity as FlagActivity;
    } else if (
      status === undefined &&
      zoneId !== undefined &&
      activity === undefined
    )
      nextZone = zoneId;
    else reject();
  } else {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    if (
      restartDate === today ||
      restart !== true ||
      !zoneId ||
      !activity ||
      status !== undefined
    )
      throw new ConflictException({
        code: 'FLAG_RESTART_REQUIRED',
        message: '하루 한 번만 확인 후 재시작할 수 있습니다.',
      });
    next = 'active';
    nextZone = zoneId;
    nextActivity = activity as FlagActivity;
    restartDate = today;
  }
  return {
    status: next,
    zoneId: nextZone,
    activity: nextActivity,
    restartDate,
  };
}

export function statusView(flag: Flag) {
  return {
    flagId: flag.id,
    status: flag.status,
    zoneId: flag.zoneId,
    activity: flag.activity,
    updatedAt: (flag.statusUpdatedAt ?? flag.createdAt).toISOString(),
  };
}
