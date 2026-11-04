import { BadRequestException } from '@nestjs/common';
import {
  venueLabelMatches,
  verifiedVenueLocation,
} from '../../../common/festival-location';
import { isIsoInstant as iso } from '../../../common/iso-instant';
import type { FestivalDocument } from './festival.entity';

const keys = new Set([
  'name',
  'venue',
  'timezone',
  'days',
  'thumbUrl',
  'ticketLinks',
  'flagsEnabled',
  'source',
  'stages',
  'sets',
  'zones',
  'flags',
  'directions',
  'checklist',
  'rules',
  'mapImageUrl',
  'mapAspect',
]);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

const MAX_LAST_DEPARTURES = 31;
const LEGACY_RETURN_TIME_KEYS = ['lastShuttleAt', 'lastTrainAt'] as const;

/**
 * 형식이 정해지기 전에 저장된 막차·셔틀 단일 값(예: "23:40")은 ISO8601이 아니어도
 * 초안 PATCH와 발행을 막지 않도록 null로 바꾼다. 이번 요청이 직접 보낸 값은 바꾸지 않아
 * 새 자유 문장 입력은 그대로 검증 오류가 된다.
 */
export function normalizeLegacyReturnTimes(
  draft: FestivalDocument,
  patch?: unknown,
): FestivalDocument {
  const directions = draft.directions;
  if (!object(directions)) return draft;
  const sent =
    object(patch) && object(patch.directions) ? patch.directions : {};
  const stale = LEGACY_RETURN_TIME_KEYS.filter(
    (key) =>
      typeof directions[key] === 'string' &&
      !iso(directions[key]) &&
      sent[key] === undefined,
  );
  if (!stale.length) return draft;
  return {
    ...draft,
    directions: {
      ...directions,
      ...Object.fromEntries(stale.map((key) => [key, null])),
    },
  };
}

/** 귀가 정보: 막차·셔틀 시각은 오프셋이 있는 ISO8601이고 날짜별로 한 번만 둔다. */
function validateReturnDirections(
  draft: FestivalDocument,
  forPublish: boolean,
): string[] {
  const errors: string[] = [];
  const directions = draft.directions as Record<string, unknown>;
  for (const key of ['lastShuttleAt', 'lastTrainAt']) {
    const value = directions[key];
    if (value !== undefined && value !== null && !iso(value))
      errors.push(`directions.${key}: 오프셋 포함 ISO8601 또는 null 필요`);
  }
  const shuttle = directions.shuttle;
  if (
    object(shuttle) &&
    shuttle.stopName !== undefined &&
    shuttle.stopName !== null &&
    (typeof shuttle.stopName !== 'string' ||
      [...shuttle.stopName.trim()].length < 1 ||
      [...shuttle.stopName].length > 40)
  )
    errors.push('directions.shuttle.stopName: 1..40자 또는 null 필요');
  const departures = directions.lastDepartures;
  if (departures === undefined) return errors;
  if (!Array.isArray(departures) || departures.length > MAX_LAST_DEPARTURES) {
    errors.push(
      `directions.lastDepartures: 최대 ${MAX_LAST_DEPARTURES}개 배열 필요`,
    );
    return errors;
  }
  const dayDates = new Set(
    (Array.isArray(draft.days) ? (draft.days as unknown[]) : [])
      .filter(object)
      .map((day) => day.date),
  );
  const seen = new Set<string>();
  departures.forEach((item: unknown, index) => {
    const at = `directions.lastDepartures[${index}]`;
    if (!object(item) || !calendarDate(item.date)) {
      errors.push(`${at}.date: YYYY-MM-DD 필요`);
      return;
    }
    if (seen.has(item.date)) errors.push(`${at}.date: 날짜 중복`);
    seen.add(item.date);
    if (forPublish && !dayDates.has(item.date))
      errors.push(`${at}.date: days에 있는 개최일이어야 함`);
    const times = ['shuttleAt', 'trainAt'].map((key) => item[key]);
    times.forEach((value, i) => {
      if (value !== undefined && value !== null && !iso(value))
        errors.push(
          `${at}.${i ? 'trainAt' : 'shuttleAt'}: 오프셋 포함 ISO8601 또는 null 필요`,
        );
    });
    if (times.every((value) => value === undefined || value === null))
      errors.push(`${at}: shuttleAt 또는 trainAt 중 하나 필요`);
  });
  return errors;
}

export function validateDraft(
  draft: FestivalDocument,
  forPublish = false,
): string[] {
  const errors: string[] = [];
  const str = (key: string, min: number, max: number) => {
    const v = draft[key];
    if (typeof v !== 'string' || [...v].length < min || [...v].length > max)
      errors.push(`${key}: ${min}..${max}자`);
  };
  str('name', 1, 60);
  str('venue', 1, 80);
  if (draft.timezone !== 'Asia/Seoul')
    errors.push('timezone: Asia/Seoul만 허용');
  const period = draft.eventPeriod;
  const hasPeriod = period !== undefined;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  if (hasPeriod) {
    if (
      !object(period) ||
      !calendarDate(period.firstDate) ||
      !calendarDate(period.lastDate) ||
      Date.parse(`${period.lastDate}T00:00:00Z`) -
        Date.parse(`${period.firstDate}T00:00:00Z`) >
        31 * 86_400_000 ||
      period.lastDate < period.firstDate
    )
      errors.push('eventPeriod: 첫날부터 마지막 날까지 최대 32일 필요');
    else {
      firstDate = period.firstDate;
      lastDate = period.lastDate;
    }
  }
  const metadataOnly =
    firstDate !== null &&
    draft.timetableStatus === 'unpublished' &&
    ['days', 'stages', 'sets'].every(
      (key) => Array.isArray(draft[key]) && draft[key].length === 0,
    );
  if (
    draft.timetableStatus !== undefined &&
    draft.timetableStatus !== 'unpublished' &&
    draft.timetableStatus !== 'verified'
  )
    errors.push('timetableStatus: unpublished 또는 verified 필요');
  if (draft.timetableStatus === 'unpublished' && !metadataOnly)
    errors.push(
      'timetableStatus: 미공개 일정은 유효한 eventPeriod와 빈 days/stages/sets 필요',
    );
  const days = draft.days;
  if (
    !Array.isArray(days) ||
    days.length > 32 ||
    (!hasPeriod && days.length < 1)
  )
    errors.push(
      'days: 1..32개 필요 (날짜 전용 초안은 eventPeriod와 빈 배열 허용)',
    );
  else {
    if (forPublish && !metadataOnly && days.length === 0)
      errors.push('days: 발행하려면 검증된 시작/종료 시각 필요');
    let previous = '';
    for (const [index, day] of days.entries()) {
      if (
        !object(day) ||
        !calendarDate(day.date) ||
        !iso(day.startsAt) ||
        !iso(day.endsAt)
      ) {
        errors.push(`days[${index}]: 날짜와 시작/종료 시각이 필요`);
        continue;
      }
      const duration = Date.parse(day.endsAt) - Date.parse(day.startsAt);
      const calendar = new Date(`${day.date}T00:00:00Z`);
      if (
        Number.isNaN(calendar.getTime()) ||
        calendar.toISOString().slice(0, 10) !== day.date ||
        duration <= 0 ||
        duration > 18 * 3600_000 ||
        day.date <= previous ||
        (firstDate !== null && (day.date < firstDate || day.date > lastDate!))
      )
        errors.push(`days[${index}]: 날짜 순서 또는 시간 범위 오류`);
      previous = day.date;
    }
    const firstDay: unknown = days[0];
    const lastDay: unknown = days[days.length - 1];
    if (
      forPublish &&
      firstDate !== null &&
      days.length > 0 &&
      (!object(firstDay) ||
        firstDay.date !== firstDate ||
        !object(lastDay) ||
        lastDay.date !== lastDate)
    )
      errors.push(
        'days: 발행 일정은 eventPeriod의 첫날과 마지막 날을 포함해야 함',
      );
  }
  if (typeof draft.flagsEnabled !== 'boolean')
    errors.push('flagsEnabled: boolean 필요');
  if (
    object(draft.directions) &&
    draft.directions.location !== undefined &&
    draft.directions.location !== null
  ) {
    const location = verifiedVenueLocation(draft.directions.location);
    if (!location || !venueLabelMatches(location.label, draft.venue))
      errors.push(
        'directions.location: 검증된 위도·경도, 공연장 일치 장소명과 HTTPS 출처가 필요',
      );
  }
  if (object(draft.directions))
    errors.push(...validateReturnDirections(draft, forPublish));
  if (
    draft.thumbUrl !== undefined &&
    draft.thumbUrl !== null &&
    (typeof draft.thumbUrl !== 'string' ||
      !/^(https:\/\/[^\s]+|\/api\/v1\/festivals\/images\/[0-9a-f-]+\.webp)$/.test(
        draft.thumbUrl,
      ))
  )
    errors.push('thumbUrl: HTTPS URL, 보관 이미지 경로 또는 null 필요');
  if (
    draft.ticketLinks !== undefined &&
    (!Array.isArray(draft.ticketLinks) ||
      draft.ticketLinks.length > 5 ||
      new Set(draft.ticketLinks.map((link) => (object(link) ? link.url : null)))
        .size !== draft.ticketLinks.length ||
      draft.ticketLinks.some(
        (link) =>
          !object(link) ||
          typeof link.label !== 'string' ||
          [...link.label].length < 1 ||
          [...link.label].length > 20 ||
          typeof link.url !== 'string' ||
          !/^https:\/\/[^\s]+$/.test(link.url),
      ))
  )
    errors.push('ticketLinks: 최대 5개, 1..20자 라벨과 HTTPS URL 필요');
  for (const [name, max] of [
    ['stages', 8],
    ['sets', 400],
    ['zones', 40],
    ['flags', 200],
    ['checklist', 40],
    ['rules', 20],
  ] as const) {
    const value = draft[name];
    if (
      !Array.isArray(value) ||
      value.length > max ||
      (name === 'stages' && forPublish && !metadataOnly && value.length < 1)
    )
      errors.push(`${name}: 배열 크기 오류`);
  }
  const stages = Array.isArray(draft.stages) ? draft.stages : [];
  const stageIds = new Set(stages.filter(object).map((s) => s.id));
  if (new Set(stages.filter(object).map((s) => s.id)).size !== stages.length)
    errors.push('stages: ID 중복');
  for (const [i, stage] of stages.entries()) {
    if (
      !object(stage) ||
      typeof stage.id !== 'string' ||
      !stage.id.startsWith('stg_') ||
      typeof stage.name !== 'string' ||
      [...stage.name].length < 1 ||
      [...stage.name].length > 24 ||
      !Number.isSafeInteger(stage.order) ||
      (stage.order as number) < 1
    )
      errors.push(`stages[${i}]: ID/이름/순서 오류`);
  }
  const sets = Array.isArray(draft.sets) ? draft.sets : [];
  if (forPublish && !metadataOnly && hasPeriod && sets.length === 0)
    errors.push('sets: 날짜 전용 수집 초안은 검증된 공연 세트가 필요');
  const byStage = new Map<unknown, { starts: number; ends: number }[]>();
  for (const [i, set] of sets.entries()) {
    if (
      !object(set) ||
      !stageIds.has(set.stageId) ||
      typeof set.artist !== 'string' ||
      [...set.artist].length < 1 ||
      [...set.artist].length > 60 ||
      !iso(set.startsAt) ||
      !iso(set.endsAt)
    ) {
      errors.push(`sets[${i}]: 무대/아티스트/시간 오류`);
      continue;
    }
    const starts = Date.parse(set.startsAt),
      ends = Date.parse(set.endsAt);
    if (ends <= starts) errors.push(`sets[${i}]: 종료가 시작보다 빠름`);
    if (
      set.imageUrl !== undefined &&
      set.imageUrl !== null &&
      (typeof set.imageUrl !== 'string' ||
        !/^\/api\/v1\/festivals\/images\/[0-9a-f-]{36}\.webp$/.test(
          set.imageUrl,
        ))
    )
      errors.push(`sets[${i}]: 보관된 출연진 이미지 경로만 허용`);
    if (
      Array.isArray(days) &&
      !days.some(
        (day) =>
          object(day) &&
          iso(day.startsAt) &&
          iso(day.endsAt) &&
          starts >= Date.parse(day.startsAt) &&
          ends <= Date.parse(day.endsAt),
      )
    )
      errors.push(`sets[${i}]: 페스티벌 시간 밖`);
    byStage.set(set.stageId, [
      ...(byStage.get(set.stageId) ?? []),
      { starts, ends },
    ]);
  }
  for (const [stage, items] of byStage) {
    items.sort((a, b) => a.starts - b.starts);
    if (items.some((item, i) => i > 0 && item.starts < items[i - 1].ends))
      errors.push(`stage ${String(stage)}: 세트 시간 겹침`);
  }
  const zones = Array.isArray(draft.zones) ? draft.zones : [];
  for (const [i, zone] of zones.entries()) {
    if (
      !object(zone) ||
      typeof zone.id !== 'string' ||
      !zone.id.startsWith('zon_') ||
      typeof zone.name !== 'string' ||
      [...zone.name].length < 1 ||
      [...zone.name].length > 20 ||
      typeof zone.x !== 'number' ||
      zone.x < 0 ||
      zone.x > 1 ||
      typeof zone.y !== 'number' ||
      zone.y < 0 ||
      zone.y > 1
    )
      errors.push(`zones[${i}]: 좌표는 0..1`);
  }
  if (
    draft.mapImageUrl !== null &&
    (typeof draft.mapImageUrl !== 'string' ||
      !draft.mapImageUrl.startsWith('https://') ||
      typeof draft.mapAspect !== 'number' ||
      draft.mapAspect <= 0)
  )
    errors.push('mapImageUrl/mapAspect: HTTPS 이미지와 종횡비 필요');
  if (
    !object(draft.source) ||
    typeof draft.source.name !== 'string' ||
    !iso(draft.source.verifiedAt)
  )
    errors.push('source: 이름과 검증 시각 필요');
  const flags = Array.isArray(draft.flags) ? draft.flags : [];
  if (draft.flagsEnabled === false && flags.length > 0)
    errors.push('flags: flagsEnabled=false이면 비어 있어야 함');
  if (flags.some((flag) => object(flag) && flag.visibility === 'private'))
    errors.push('flags: 비공개 깃발은 팩에 포함할 수 없음');
  return errors;
}

export function mergeDraft(
  current: FestivalDocument,
  patch: unknown,
): FestivalDocument {
  if (!object(patch) || Object.keys(patch).length === 0)
    throw new BadRequestException('JSON Merge Patch 객체가 필요합니다.');
  for (const key of Object.keys(patch))
    if (!keys.has(key))
      throw new BadRequestException(`수정할 수 없는 필드: ${key}`);
  const merge = (base: unknown, change: unknown): unknown => {
    if (!object(change)) return change;
    const result = object(base) ? { ...base } : {};
    for (const [key, value] of Object.entries(change)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        throw new BadRequestException(`수정할 수 없는 필드: ${key}`);
      if (value === null) delete result[key];
      else result[key] = merge(result[key], value);
    }
    return result;
  };
  return merge(current, patch) as FestivalDocument;
}
