export const TOUR_API_SOURCE =
  'https://apis.data.go.kr/B551011/KorService2/searchFestival2';

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

export function tourApiPage(body: string): {
  items: RecordValue[];
  totalCount: number;
} {
  const payload = JSON.parse(body) as unknown;
  const response = record(record(payload)?.response);
  const header = record(response?.header);
  const resultCode = header?.resultCode;
  if (resultCode !== '0000' && resultCode !== '00')
    throw new Error('TourAPI 응답 오류');
  const result = record(response?.body);
  const totalCount = Number(result?.totalCount);
  if (!Number.isSafeInteger(totalCount) || totalCount < 0)
    throw new Error('TourAPI 목록 총건수가 올바르지 않습니다.');
  const raw = record(result?.items)?.item;
  const items =
    raw == null || raw === '' ? [] : Array.isArray(raw) ? raw : [raw];
  if (items.some((item) => !record(item)))
    throw new Error('TourAPI 목록 항목 형식이 올바르지 않습니다.');
  return { items: items as RecordValue[], totalCount };
}

export function tourApiCandidates(body: string) {
  const rows = JSON.parse(body) as unknown;
  if (!Array.isArray(rows))
    throw new Error('TourAPI 수집 형식이 올바르지 않습니다.');
  const candidates = new Map<
    string,
    {
      name: string;
      url: string;
      date: string;
      venue: string;
    }
  >();
  for (const raw of rows) {
    const row = record(raw);
    if (!row) continue;
    const id = row.contentid;
    const title = row.title;
    const start = row.eventstartdate;
    const end = row.eventenddate;
    const address = row.addr1;
    if (
      (typeof id !== 'string' && typeof id !== 'number') ||
      !/^\d+$/.test(String(id)) ||
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 160 ||
      typeof start !== 'string' ||
      typeof end !== 'string' ||
      !/^20\d{6}$/.test(start) ||
      !/^20\d{6}$/.test(end) ||
      typeof address !== 'string' ||
      !address.trim()
    )
      continue;
    const date = (value: string) =>
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const first = date(start);
    const last = date(end);
    const validDate = (value: string) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    };
    if (!validDate(first) || !validDate(last) || last < first) continue;
    candidates.set(String(id), {
      name: title.trim(),
      url: `https://apis.data.go.kr/B551011/KorService2/detailCommon2?contentId=${id}`,
      date: `${first} ~ ${last}`,
      venue: address.trim(),
    });
  }
  return [...candidates.values()];
}
