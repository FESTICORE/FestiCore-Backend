import { BadRequestException } from '@nestjs/common';

export interface AnalyticsRange {
  from: string;
  to: string;
  start: string;
  end: string;
}

const DAY = 86_400_000;

export function parseAnalyticsRange(
  from?: string,
  to?: string,
): AnalyticsRange {
  const parse = (value: string | undefined): number => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('from/to는 YYYY-MM-DD 형식이어야 합니다.');
    }
    const time = Date.parse(`${value}T00:00:00.000Z`);
    if (
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException('유효하지 않은 날짜입니다.');
    }
    return time;
  };
  const first = parse(from);
  const last = parse(to);
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (first > last || (last - first) / DAY >= 31 || to! > todayKst) {
    throw new BadRequestException(
      '조회 기간은 KST 기준 과거 31일 이내여야 합니다.',
    );
  }
  return {
    from: from!,
    to: to!,
    start: new Date(first - 9 * 60 * 60 * 1000).toISOString(),
    end: new Date(last + DAY - 9 * 60 * 60 * 1000).toISOString(),
  };
}

export function kstDate(timestamp: number): string {
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
