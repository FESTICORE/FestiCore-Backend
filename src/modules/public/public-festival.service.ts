import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { Flag } from '../flags/flag.entity';

type Document = Record<string, unknown>;

function object(value: unknown): value is Document {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(value: unknown, names: readonly string[]): Document {
  if (!object(value)) return {};
  return Object.fromEntries(
    names.filter((name) => name in value).map((name) => [name, value[name]]),
  );
}

function projectedArray(value: unknown, names: readonly string[]): Document[] {
  return requiredArray(value).map((item) => fields(item, names));
}

function projectSource(value: unknown): Document {
  return fields(value, ['name', 'url', 'verifiedAt']);
}

function publicImageUrl(value: unknown): string | null {
  return typeof value === 'string' &&
    (value.startsWith('https://') || value.startsWith('/api/v1/flags/'))
    ? value
    : null;
}

function projectDirections(value: unknown): Document {
  const direction = fields(value, [
    'shuttle',
    'transit',
    'parking',
    'memo',
    'lastShuttleAt',
    'lastTrainAt',
    'mapLinks',
    'source',
  ]);
  for (const key of ['shuttle', 'transit', 'parking'] as const) {
    if (direction[key] !== null) {
      const section = fields(direction[key], [
        'body',
        'links',
        ...(key === 'transit' ? ['stationName', 'walkMinutes'] : []),
      ]);
      section.links = projectedArray(section.links, ['label', 'url']);
      direction[key] = section;
    }
  }
  direction.mapLinks = fields(direction.mapLinks, ['naver', 'kakao']);
  direction.source = projectSource(direction.source);
  return direction;
}

function projectPack(pack: Document): Document {
  const result = fields(pack, [
    'id',
    'name',
    'venue',
    'timezone',
    'flagsEnabled',
    'packVersion',
    'packUpdatedAt',
    'rules',
    'mapImageUrl',
    'mapAspect',
  ]);
  result.days = projectedArray(pack.days, ['date', 'startsAt', 'endsAt']);
  result.source = projectSource(pack.source);
  result.stages = projectedArray(pack.stages, ['id', 'name', 'order', 'color']);
  result.sets = projectedArray(pack.sets, [
    'id',
    'stageId',
    'artist',
    'startsAt',
    'endsAt',
    'note',
  ]);
  result.zones = projectedArray(pack.zones, [
    'id',
    'name',
    'kind',
    'x',
    'y',
    'order',
  ]);
  result.flags = requiredArray(pack.flags)
    .filter(
      (flag) =>
        (flag.visibility === undefined || flag.visibility === 'public') &&
        flag.hidden !== true,
    )
    .map((flag) => {
      const profile = fields(flag, [
        'id',
        'name',
        'bio',
        'followerCount',
        'planVisible',
        'homeZoneId',
      ]);
      profile.thumbUrl = publicImageUrl(flag.thumbUrl);
      profile.photoUrl = publicImageUrl(flag.photoUrl);
      profile.tags = Array.isArray(flag.tags)
        ? flag.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];
      profile.plan =
        flag.planVisible === true && Array.isArray(flag.plan)
          ? flag.plan.filter((id): id is string => typeof id === 'string')
          : [];
      return profile;
    });
  result.directions = projectDirections(pack.directions);
  result.checklist = projectedArray(pack.checklist, [
    'id',
    'label',
    'required',
    'note',
  ]);
  result.rules = Array.isArray(pack.rules)
    ? pack.rules.filter((rule): rule is string => typeof rule === 'string')
    : [];
  return result;
}

function requiredArray(value: unknown): Document[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Document =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function dateInSeoul(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

@Injectable()
export class PublicFestivalService {
  constructor(
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    @InjectRepository(Flag)
    private readonly flagRecords: Repository<Flag>,
  ) {}

  async published(id: string): Promise<Document> {
    const row = await this.festivals.findOne({ where: { id } });
    if (!row?.published || row.publishedVersion < 1)
      throw new NotFoundException('공개된 페스티벌을 찾을 수 없습니다.');
    return projectPack(row.published);
  }

  async list(
    after: string | undefined,
    limitValue: string | undefined,
    now = new Date(),
  ) {
    if (after !== undefined && typeof after !== 'string')
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'after는 단일 날짜 또는 커서여야 합니다.',
      });
    if (limitValue !== undefined && typeof limitValue !== 'string')
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'limit은 단일 정수여야 합니다.',
      });
    const cursor = after?.match(
      /^(\d{4}-\d{2}-\d{2})~([^~]+)~(fst_[0-9a-z]+)$/,
    );
    if (
      cursor &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(
        cursor[2],
      ) ||
        Number.isNaN(Date.parse(cursor[2])))
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'after 커서의 시작 시각이 올바르지 않습니다.',
      });
    const afterDate = cursor?.[1] ?? after;
    if (afterDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(afterDate))
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'after는 YYYY-MM-DD여야 합니다.',
      });
    if (
      afterDate &&
      (Number.isNaN(Date.parse(`${afterDate}T00:00:00Z`)) ||
        new Date(`${afterDate}T00:00:00Z`).toISOString().slice(0, 10) !==
          afterDate)
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: '유효하지 않은 after 날짜입니다.',
      });
    const limit = limitValue === undefined ? 20 : Number(limitValue);
    if (
      !/^(?:[1-9]|[1-4]\d|50)$/.test(limitValue ?? '20') ||
      !Number.isInteger(limit)
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'limit은 1..50이어야 합니다.',
      });

    const today = dateInSeoul(now);
    const floor =
      afterDate ??
      new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const firstStartsAt = `festival.published->'days'->0->>'startsAt'`;
    const firstInstant = `(${firstStartsAt})::timestamptz`;
    const lastDate = `festival.published->'days'->-1->>'date'`;
    const query = this.festivals
      .createQueryBuilder('festival')
      .where('festival.published IS NOT NULL')
      .andWhere('festival.publishedVersion > 0')
      .andWhere(`${lastDate} >= :floor`, { floor });
    if (cursor) {
      query.andWhere(
        `(${firstInstant} > CAST(:cursorAt AS timestamptz) OR (${firstInstant} = CAST(:cursorAt AS timestamptz) AND festival.id > :cursorId))`,
        { cursorAt: cursor[2], cursorId: cursor[3] },
      );
    }
    const rows = await query
      .orderBy(firstInstant, 'ASC')
      .addOrderBy('festival.id', 'ASC')
      .take(limit + 1)
      .getMany();
    const summaries = rows.flatMap((row) => {
      const pack = row.published;
      if (!pack || row.publishedVersion < 1) return [];
      const days = requiredArray(pack.days);
      const firstDate = days[0]?.date;
      const startsAt = days[0]?.startsAt;
      const lastDate = days[days.length - 1]?.date;
      if (
        typeof firstDate !== 'string' ||
        typeof startsAt !== 'string' ||
        typeof lastDate !== 'string' ||
        lastDate < floor
      )
        return [];
      const flags = requiredArray(pack.flags).filter(
        (flag) =>
          (flag.visibility === undefined || flag.visibility === 'public') &&
          flag.hidden !== true,
      );
      return [
        {
          id: row.id,
          name: pack.name,
          venue: pack.venue,
          firstDate,
          startsAt,
          lastDate,
          packVersion: row.publishedVersion,
          flagsEnabled: pack.flagsEnabled,
          thumbUrl: publicImageUrl(flags[0]?.thumbUrl),
          status:
            today < firstDate
              ? 'upcoming'
              : today > lastDate
                ? 'ended'
                : 'live',
        },
      ];
    });
    const items = summaries.slice(0, limit).map((summary) => ({
      id: summary.id,
      name: summary.name,
      venue: summary.venue,
      firstDate: summary.firstDate,
      lastDate: summary.lastDate,
      packVersion: summary.packVersion,
      flagsEnabled: summary.flagsEnabled,
      thumbUrl: summary.thumbUrl,
      status: summary.status,
    }));
    const nextCursor =
      summaries.length > limit
        ? `${floor}~${summaries[limit - 1].startsAt}~${summaries[limit - 1].id}`
        : null;
    return { items, nextCursor };
  }

  async version(id: string) {
    const pack = await this.published(id);
    return {
      packVersion: pack.packVersion as number,
      packUpdatedAt: pack.packUpdatedAt as string,
      etag: `"v${pack.packVersion as number}"`,
    };
  }

  async flags(id: string, tags: string[] | undefined) {
    const pack = await this.published(id);
    const valid = new Set(['slam', 'sing', 'train', 'calm', 'newbie']);
    if (tags?.some((tag) => !valid.has(tag)))
      throw new BadRequestException({
        code: 'VALIDATION',
        message: '지원하지 않는 tag입니다.',
      });
    if (pack.flagsEnabled === false)
      return { items: [], packVersion: pack.packVersion as number };
    const records = await this.flagRecords.find({ where: { festivalId: id } });
    const profiles = new Map(
      requiredArray(pack.flags).map((flag) => [flag.id, flag]),
    );
    for (const flag of records) {
      if (flag.visibility !== 'public' || flag.hidden) {
        profiles.delete(flag.id);
        continue;
      }
      profiles.set(flag.id, {
        id: flag.id,
        name: flag.name,
        thumbUrl: flag.thumbKey
          ? `/api/v1/flags/${encodeURIComponent(flag.id)}/thumbnail`
          : flag.thumbUrl,
        photoUrl: flag.photoKey
          ? `/api/v1/flags/${encodeURIComponent(flag.id)}/photo`
          : flag.photoUrl,
        tags: flag.tags,
        bio: flag.bio,
        followerCount: flag.followerCount,
        planVisible: flag.planVisible,
        plan: flag.planVisible ? flag.plan : [],
        homeZoneId: flag.homeZoneId,
      });
    }
    const items = [...profiles.values()].filter(
      (flag) =>
        !tags?.length ||
        (Array.isArray(flag.tags) &&
          (flag.tags as unknown[]).some(
            (tag) => typeof tag === 'string' && tags.includes(tag),
          )),
    );
    return { items, packVersion: pack.packVersion as number };
  }

  etag(body: unknown): string {
    return `"${createHash('sha256').update(JSON.stringify(body)).digest('hex')}"`;
  }
}
