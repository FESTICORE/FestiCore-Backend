import { checkedUrl } from './crawl-fetch';
import type { TimetableImageColumn } from './timetable-image-ocr';

export interface TimetableSourceColumn extends TimetableImageColumn {
  stageName: string;
}

export interface TimetableSourceConfig {
  festivalSourceUrl: string;
  sourcePageUrl: string;
  date: string;
  expectedRows: number;
  columns: TimetableSourceColumn[];
}

/** A source is one official timetable image for one festival day. */
export function timetableSourceConfig(
  raw: Record<string, string>,
): TimetableSourceConfig {
  const festivalSourceUrl = checkedUrl(raw.festivalSourceUrl ?? '').toString();
  const sourcePageUrl = checkedUrl(raw.sourcePageUrl ?? '').toString();
  const date = raw.date ?? '';
  const parsedDate = new Date(`${date}T00:00:00Z`);
  const expectedRows = Number(raw.expectedRows);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date ||
    !Number.isInteger(expectedRows) ||
    expectedRows < 1 ||
    expectedRows > 100 ||
    !raw.columns ||
    raw.columns.length > 8000
  )
    throw new Error(
      '시간표 소스의 날짜·공연 수·무대 설정이 올바르지 않습니다.',
    );
  let columns: TimetableSourceColumn[];
  try {
    columns = JSON.parse(raw.columns) as TimetableSourceColumn[];
  } catch {
    throw new Error('시간표 무대 설정 JSON이 올바르지 않습니다.');
  }
  if (
    !Array.isArray(columns) ||
    !columns.length ||
    columns.length > 8 ||
    columns.some(
      (column) =>
        !column ||
        typeof column.stageName !== 'string' ||
        !column.stageName.trim() ||
        column.stageName.length > 100 ||
        !/^stg_[a-zA-Z0-9_-]{1,80}$/.test(column.stageId) ||
        ![column.left, column.top, column.width, column.height].every(
          (value) => typeof value === 'number' && Number.isFinite(value),
        ) ||
        column.left < 0 ||
        column.top < 0 ||
        column.width <= 0 ||
        column.height <= 0 ||
        (column.artistPosition !== undefined &&
          !['before', 'after'].includes(column.artistPosition)) ||
        column.left + column.width > 1 ||
        column.top + column.height > 1,
    ) ||
    new Set(columns.map((column) => column.stageId)).size !== columns.length
  )
    throw new Error('시간표 무대 영역이 올바르지 않습니다.');
  return {
    festivalSourceUrl,
    sourcePageUrl,
    date,
    expectedRows,
    columns,
  };
}
