/** 오프셋(Z 또는 ±HH:MM)이 있는 초 단위 ISO8601 시각인지 확인한다. */
export const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;

export function isIsoInstant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_INSTANT_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
