import { createHash } from 'crypto';

/** 기존 발행 팩처럼 id가 없는 공연에도 기기 간 동일한 ID를 부여한다. */
export function festivalSetId(set: Record<string, unknown>): string {
  if (typeof set.id === 'string' && /^set_[0-9a-z]+$/.test(set.id))
    return set.id;
  const identity = [set.stageId, set.artist, set.startsAt, set.endsAt];
  return `set_${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16)}`;
}
