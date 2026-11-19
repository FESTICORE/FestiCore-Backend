const DAY_MS = 24 * 60 * 60_000;
const KST_OFFSET_MS = 9 * 60 * 60_000;

/**
 * 크루는 마지막 공연이 끝난 날의 자정(KST)까지 유지한다(Figma S07 `M/d(E) 자정까지 유지`).
 * 마지막 공연 종료 시각 이후 처음 오는 00:00(KST)을 돌려주고, 공연 종료 시각이 없으면 보관하지 않는다.
 */
export function crewArchiveTime(days: unknown): number {
  const ends = (Array.isArray(days) ? days : [])
    .map((day: unknown) => {
      const endsAt = (day as { endsAt?: unknown } | null)?.endsAt;
      return typeof endsAt === 'string' ? Date.parse(endsAt) : NaN;
    })
    .filter(Number.isFinite);
  if (!ends.length) return Infinity;
  const lastEnd = Math.max(...ends);
  return Math.ceil((lastEnd + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}
