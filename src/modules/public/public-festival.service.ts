import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AdminFestival } from '../admin/festival/festival.entity';
import { festivalSetId } from '../admin/festival/festival-set-id';
import { PUBLIC_CRAWL_IMAGE_SQL } from './crawl-image-policy';
import { officialWonderlivetArtistImage } from './wonderlivet-artist-images';
import { Flag } from '../flags/flag.entity';
import { CacheService } from '../redis/service/cache.service';
import {
  discoverySummaries,
  DiscoveryRow,
  DiscoverySummary,
  PublishedDiscoveryRow,
} from './crawl-catalog';

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
    (value.startsWith('https://') ||
      value.startsWith('/api/v1/flags/') ||
      value.startsWith('/api/v1/festivals/images/'))
    ? value
    : null;
}

function storedArtistImageUrl(value: unknown): string | null {
  return typeof value === 'string' &&
    /^\/api\/v1\/festivals\/images\/[0-9a-f-]{36}\.webp$/.test(value)
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
  result.thumbUrl = publicImageUrl(pack.thumbUrl);
  result.ticketLinks = projectedArray(pack.ticketLinks, ['label', 'url']);
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
    'imageUrl',
  ]).map((set) => ({
    ...set,
    id: festivalSetId(set),
    imageUrl: storedArtistImageUrl(set.imageUrl),
  }));
  const stageNames = new Map(
    requiredArray(result.stages)
      .filter((stage) => typeof stage.id === 'string')
      .map((stage) => [stage.id, stage.name]),
  );
  result.timetable = requiredArray(result.sets)
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
    .map((set) => ({
      ...set,
      date:
        typeof set.startsAt === 'string'
          ? dateInSeoul(new Date(set.startsAt))
          : null,
      stageName: stageNames.get(set.stageId) ?? null,
    }));
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

export function envelopeEtag(etag: string): string {
  return `"cdm1-${etag.slice(1, -1)}"`;
}

@Injectable()
export class PublicFestivalService {
  constructor(
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    @InjectRepository(Flag)
    private readonly flagRecords: Repository<Flag>,
    private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  async published(id: string): Promise<Document> {
    const generation = await this.cache.packGeneration(id);
    if (generation !== null) {
      const cached = await this.cache.getPack<Document>(id, generation);
      if (cached !== null) return cached;
    }
    const row = await this.festivals.findOne({ where: { id } });
    if (!row?.published || row.publishedVersion < 1)
      throw new NotFoundException({
        code: 'FESTIVAL_NOT_FOUND',
        message: '공개된 페스티벌을 찾을 수 없습니다.',
      });
    const document = projectPack(row.published);
    if (generation !== null) await this.cache.setPack(id, generation, document);
    return document;
  }

  private async discoveryCatalog(): Promise<DiscoverySummary[]> {
    const discoveryRows = await this.dataSource.query<DiscoveryRow[]>(
      `WITH candidates AS (
         SELECT item->'after' AS candidate,
           item->'after'->>'url' AS url,
           item->>'decision' AS decision,
           p.status AS "proposalStatus",
           p."createdAt" AS created_at,
           p.id AS proposal_id
         FROM crawl_proposals p
         CROSS JOIN LATERAL jsonb_array_elements(p.items) item
         WHERE p.kind = 'festival.new'
           AND item->'after'->>'url' IS NOT NULL
       ), latest AS (
         SELECT DISTINCT ON (url) * FROM candidates
         ORDER BY url, created_at DESC, proposal_id DESC
       ), details AS (
         SELECT url,
           (array_agg(candidate->>'officialInstagramUrl' ORDER BY created_at DESC, proposal_id DESC)
             FILTER (WHERE decision IS DISTINCT FROM 'rejected'
               AND "proposalStatus" IS DISTINCT FROM 'rejected'
               AND candidate->>'officialInstagramUrl' IS NOT NULL))[1] AS account,
           (array_agg(candidate->>'posterUrl' ORDER BY created_at DESC, proposal_id DESC)
             FILTER (WHERE decision IS DISTINCT FROM 'rejected'
               AND "proposalStatus" IS DISTINCT FROM 'rejected'
               AND candidate->>'posterUrl' IS NOT NULL))[1] AS poster,
           (array_agg(candidate->'artists' ORDER BY created_at DESC, proposal_id DESC)
             FILTER (WHERE decision IS DISTINCT FROM 'rejected'
               AND "proposalStatus" IS DISTINCT FROM 'rejected'
               AND jsonb_array_length(CASE WHEN jsonb_typeof(candidate->'artists') = 'array'
                 THEN candidate->'artists' ELSE '[]'::jsonb END) > 0))[1] AS artists
         FROM candidates GROUP BY url
       )
       SELECT latest.candidate || jsonb_strip_nulls(jsonb_build_object(
           'officialInstagramUrl', details.account, 'posterUrl', details.poster,
           'artists', details.artists
         )) AS candidate,
         latest.decision,
         latest."proposalStatus"
       FROM latest JOIN details USING (url)`,
    );
    const publishedRows = await this.dataSource.query<PublishedDiscoveryRow[]>(
      `SELECT published->>'name' AS name,
         published->>'venue' AS venue,
         published->'days'->0->>'date' AS "firstDate",
         published->'days'->-1->>'date' AS "lastDate",
         published->'source'->>'url' AS "sourceUrl"
       FROM admin_festivals
       WHERE published IS NOT NULL AND "publishedVersion" > 0`,
    );
    return discoverySummaries(discoveryRows, publishedRows);
  }

  private async attachStoredImages(entries: DiscoverySummary[]): Promise<void> {
    const imageUrls = [
      ...new Set(
        entries.flatMap((entry) => [
          ...(entry.posterUrl ? [entry.posterUrl] : []),
          ...(entry.artists?.flatMap((artist) => {
            const sourceUrl =
              officialWonderlivetArtistImage(entry.sourceUrl, artist.name) ??
              artist.sourceUrl;
            return sourceUrl ? [sourceUrl] : [];
          }) ?? []),
        ]),
      ),
    ];
    const images = imageUrls.length
      ? await this.dataSource.query<{ originUrl: string; id: string }[]>(
          `SELECT DISTINCT ON (image."originUrl") image."originUrl", image.id
       FROM crawl_images image
       JOIN crawl_sources source ON source.id = image."sourceId"
       WHERE image."originUrl" = ANY($1::text[])
         AND ${PUBLIC_CRAWL_IMAGE_SQL}
       ORDER BY image."originUrl", image."lastSeenAt" DESC`,
          [imageUrls],
        )
      : [];
    const imageByUrl = new Map(
      images.map((image) => [image.originUrl, image.id]),
    );
    const englishProductIds = [
      ...new Set(
        entries.flatMap((entry) => {
          if (entry.posterUrl) return [];
          const id =
            /^https:\/\/ticket\.yes24\.com\/English\/Perf\/(\d+)$/.exec(
              entry.sourceUrl,
            )?.[1];
          return id ? [id] : [];
        }),
      ),
    ];
    const englishPosterByProduct = new Map<string, string>();
    if (englishProductIds.length) {
      const pattern = `-(${englishProductIds.join('|')})[.](?:jpg|jpeg|png|webp)$`;
      const posters = await this.dataSource.query<
        { originUrl: string; id: string }[]
      >(
        `SELECT image."originUrl", image.id
         FROM crawl_images image
         JOIN crawl_sources source ON source.id = image."sourceId"
         WHERE source.url = 'https://ticket.yes24.com/English/Genre/Concert'
           AND image."originUrl" ~ $1
           AND ${PUBLIC_CRAWL_IMAGE_SQL}
         ORDER BY image."lastSeenAt" DESC`,
        [pattern],
      );
      for (const poster of posters) {
        const id = /-(\d+)\.(?:jpg|jpeg|png|webp)$/i.exec(
          poster.originUrl,
        )?.[1];
        if (id && !englishPosterByProduct.has(id))
          englishPosterByProduct.set(id, poster.id);
      }
    }
    for (const entry of entries) {
      const englishProductId =
        /^https:\/\/ticket\.yes24\.com\/English\/Perf\/(\d+)$/.exec(
          entry.sourceUrl,
        )?.[1];
      const posterId =
        (entry.posterUrl && imageByUrl.get(entry.posterUrl)) ||
        (englishProductId && englishPosterByProduct.get(englishProductId));
      if (posterId)
        entry.thumbUrl = `/api/v1/festivals/images/${posterId}.webp`;
      entry.artists = entry.artists?.map((artist) => {
        const sourceUrl =
          officialWonderlivetArtistImage(entry.sourceUrl, artist.name) ??
          artist.sourceUrl;
        const imageId = sourceUrl && imageByUrl.get(sourceUrl);
        return {
          ...artist,
          imageUrl: imageId ? `/api/v1/festivals/images/${imageId}.webp` : null,
        };
      });
    }
  }

  async detail(id: string) {
    if (!/^fst_[0-9a-z]+$/.test(id))
      throw new NotFoundException({
        code: 'FESTIVAL_NOT_FOUND',
        message: '축제를 찾을 수 없습니다.',
      });
    const published = await this.festivals.findOne({ where: { id } });
    if (published?.published && published.publishedVersion > 0)
      return projectPack(published.published);
    const entry = (await this.discoveryCatalog()).find(
      (item) => item.id === id,
    );
    if (!entry)
      throw new NotFoundException({
        code: 'FESTIVAL_NOT_FOUND',
        message: '축제를 찾을 수 없습니다.',
      });
    await this.attachStoredImages([entry]);
    return {
      id: entry.id,
      name: entry.name,
      venue: entry.venue,
      firstDate: entry.firstDate,
      lastDate: entry.lastDate,
      status: entry.status,
      packVersion: entry.packVersion,
      flagsEnabled: entry.flagsEnabled,
      thumbUrl: entry.thumbUrl,
      ticketLinks: entry.ticketLinks,
      sourceUrl: entry.sourceUrl,
      officialInstagramUrl: entry.officialInstagramUrl ?? null,
      artists:
        entry.artists?.map((artist) => ({
          name: artist.name,
          imageUrl: artist.imageUrl ?? null,
        })) ?? [],
      timetable: [],
    };
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
      return [
        {
          id: row.id,
          name: pack.name,
          venue: pack.venue,
          firstDate,
          startsAt,
          sortAt: startsAt,
          lastDate,
          packVersion: row.publishedVersion,
          flagsEnabled: pack.flagsEnabled,
          thumbUrl:
            publicImageUrl(pack.thumbUrl) ??
            (pack.flagsEnabled ? requiredArray(pack.flags) : [])
              .filter(
                (flag) =>
                  object(flag) &&
                  (flag.visibility === undefined ||
                    flag.visibility === 'public') &&
                  flag.hidden !== true,
              )
              .map((flag) => publicImageUrl(flag.thumbUrl))
              .find((url) => url !== null) ??
            null,
          ticketLinks: projectedArray(pack.ticketLinks, ['label', 'url']),
          status:
            today < firstDate
              ? 'upcoming'
              : today > lastDate
                ? 'ended'
                : 'live',
        },
      ];
    });
    const discovered = (await this.discoveryCatalog()).filter((entry) => {
      if (entry.lastDate < floor) return false;
      if (!cursor) return true;
      const sort = Date.parse(entry.sortAt) - Date.parse(cursor[2]);
      return sort > 0 || (sort === 0 && entry.id > cursor[3]);
    });
    await this.attachStoredImages(discovered);
    const ordered = [...summaries, ...discovered].sort(
      (a, b) =>
        Date.parse(a.sortAt) - Date.parse(b.sortAt) || a.id.localeCompare(b.id),
    );
    const items = ordered.slice(0, limit).map((summary) => ({
      id: summary.id,
      name: summary.name,
      venue: summary.venue,
      firstDate: summary.firstDate,
      lastDate: summary.lastDate,
      packVersion: summary.packVersion,
      flagsEnabled: summary.flagsEnabled,
      thumbUrl: summary.thumbUrl,
      ticketLinks: summary.ticketLinks,
      status: summary.status,
      ...('sourceUrl' in summary ? { sourceUrl: summary.sourceUrl } : {}),
      ...('officialInstagramUrl' in summary
        ? { officialInstagramUrl: summary.officialInstagramUrl }
        : {}),
    }));
    const nextCursor =
      ordered.length > limit
        ? `${floor}~${ordered[limit - 1].sortAt}~${ordered[limit - 1].id}`
        : null;
    return { items, nextCursor };
  }

  async version(id: string) {
    const pack = await this.published(id);
    return {
      packVersion: pack.packVersion as number,
      packUpdatedAt: pack.packUpdatedAt as string,
      etag: envelopeEtag(`"v${pack.packVersion as number}"`),
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
