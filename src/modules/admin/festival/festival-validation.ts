import { BadRequestException } from '@nestjs/common';
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

function iso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
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
  const days = draft.days;
  if (!Array.isArray(days) || days.length < 1 || days.length > 7)
    errors.push('days: 1..7개 필요');
  else {
    let previous = '';
    for (const [index, day] of days.entries()) {
      if (
        !object(day) ||
        typeof day.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
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
        day.date <= previous
      )
        errors.push(`days[${index}]: 날짜 순서 또는 시간 범위 오류`);
      previous = day.date;
    }
  }
  if (typeof draft.flagsEnabled !== 'boolean')
    errors.push('flagsEnabled: boolean 필요');
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
      (name === 'stages' && forPublish && value.length < 1)
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
