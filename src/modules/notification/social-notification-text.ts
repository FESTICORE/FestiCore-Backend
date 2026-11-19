export type SocialAlertType = 'flag.status' | 'crew.status' | 'crew.gather';

/** 상태·집결 푸시와 알림함이 같은 문구와 이동 경로를 쓰도록 한 곳에서 만든다. */
export function socialAlertText(
  type: SocialAlertType,
  payload: Record<string, unknown>,
): { title: string; body: string; route: string } {
  const gather = type === 'crew.gather';
  const flag = type === 'flag.status';
  const dissolved = type === 'crew.status' && payload.dissolved === true;
  const name =
    typeof payload.nickname === 'string' ? payload.nickname : '크루원';
  const zone = typeof payload.zoneId === 'string' ? payload.zoneId : null;
  const rawState = flag ? payload.status : payload.state;
  const state = typeof rawState === 'string' ? rawState : '';
  const title = gather
    ? '크루 집결 요청'
    : flag
      ? '깃발 상태 변경'
      : dissolved
        ? '크루 해산'
        : '크루원 상태 변경';
  const body = gather
    ? `${name}님이 ${zone ?? '현재 위치'}에서 집결을 요청했어요.`
    : flag
      ? `깃발 상태가 ${state}(으)로 변경됐어요.`
      : dissolved
        ? '크루가 해산됐어요'
        : `${name}님의 상태가 ${state}(으)로 변경됐어요.`;
  const subjectId = flag ? payload.flagId : payload.crewId;
  const safeSubjectId = typeof subjectId === 'string' ? subjectId : '';
  const route = flag
    ? `/flags/${safeSubjectId}`
    : dissolved
      ? '/crews'
      : `/crews/${safeSubjectId}`;
  return { title, body, route };
}
