/** Dockerfile은 scripts/를 dist/ 옆에 복사하므로 자동 발행에서도 같은 검증 함수를 사용한다. */
export function buildDraft(
  detail: Record<string, unknown>,
  fillMissingEnds: boolean,
): { days: unknown[]; stages: unknown[]; sets: unknown[] } | string;
