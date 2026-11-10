import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { brotliCompressSync } from 'zlib';
import { artistNameKeys } from '../../../common/artist-name';
import { verifiedVenueLocation } from '../../../common/festival-location';
import {
  AdminFestival,
  AdminFestivalVersion,
  FestivalDocument,
} from './festival.entity';
import {
  mergeDraft,
  normalizeLegacyReturnTimes,
  validateDraft,
} from './festival-validation';
import { AdminAuditService } from '../audit/admin-audit.service';
import { CacheService } from '../../redis/service/cache.service';
import { PublicFestivalService } from '../../public/public-festival.service';
import { DiscoverySummary } from '../../public/crawl-catalog';
import { LiveActivityService } from '../../notification/live-activity.service';
import {
  recordUserNotifications,
  withInboxSavepoint,
} from '../../notification/user-notification.service';

export interface CrawledFestivalDetail {
  id: string;
  name: string;
  venue: string;
  firstDate: string;
  lastDate: string;
  sourceUrl: string;
  thumbUrl?: string | null;
  ticketLinks: { label: string; url: string }[];
  artists?: unknown[];
  location?: unknown;
  officialInstagramUrl?: string | null;
}

export interface CrawledFestivalTimetable {
  days: unknown[];
  stages: unknown[];
  sets: unknown[];
}

function contentKey(document: FestivalDocument): string {
  return JSON.stringify(publicationContent(document), (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
}

function publicationContent(document: FestivalDocument): FestivalDocument {
  const content = { ...document };
  delete content.packVersion;
  delete content.packUpdatedAt;
  return content;
}

type ArtistImage = { imageUrl: string; imageCredit?: unknown };
const STORED_ARTIST_IMAGE =
  /^\/api\/v1\/festivals\/images\/[0-9a-f-]{36}\.webp$/;

function item(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 수집 출연진의 저장 사진을 이름으로 찾는다. 이름 하나에 사진이 둘 이상 맞으면 고르지 않는다. */
function crawledArtistImages(
  artists: unknown[] | undefined,
): (name: unknown) => ArtistImage | null {
  const images = new Map<string, Map<string, ArtistImage>>();
  for (const value of artists ?? []) {
    const artist = item(value);
    if (
      typeof artist?.name !== 'string' ||
      typeof artist.imageUrl !== 'string' ||
      !STORED_ARTIST_IMAGE.test(artist.imageUrl)
    )
      continue;
    const image: ArtistImage = {
      imageUrl: artist.imageUrl,
      ...(artist.imageCredit ? { imageCredit: artist.imageCredit } : {}),
    };
    for (const key of artistNameKeys(artist.name)) {
      const byUrl = images.get(key) ?? new Map<string, ArtistImage>();
      byUrl.set(image.imageUrl, image);
      images.set(key, byUrl);
    }
  }
  return (name) => {
    if (typeof name !== 'string') return null;
    const found = new Map(
      artistNameKeys(name).flatMap((key) => [...(images.get(key) ?? [])]),
    );
    return found.size === 1 ? [...found.values()][0] : null;
  };
}

/** 이름이 맞는 항목의 사진만 최신 수집 사진으로 바꾼다. 맞는 사진이 없으면 그대로 둔다. */
function withLatestImages(
  items: unknown,
  nameField: 'artist' | 'name',
  imageFor: (name: unknown) => ArtistImage | null,
): unknown {
  if (!Array.isArray(items)) return items;
  return (items as unknown[]).map((value) => {
    const entry = item(value);
    const image = entry ? imageFor(entry[nameField]) : null;
    if (!entry || !image) return value;
    // 공연에는 사진 출처를 두지 않는다. 공개 응답이 저장된 권리 정보로 다시 붙인다.
    if (nameField === 'artist')
      return entry.imageUrl === image.imageUrl
        ? value
        : { ...entry, imageUrl: image.imageUrl };
    const next: Record<string, unknown> = {
      ...entry,
      imageUrl: image.imageUrl,
    };
    delete next.imageCredit;
    if (image.imageCredit) next.imageCredit = image.imageCredit;
    return next;
  });
}

const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
const SOURCE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function sourceWarnings(draft: FestivalDocument): string[] {
  const source = draft.source;
  const verifiedAt =
    source && typeof source === 'object' && 'verifiedAt' in source
      ? source.verifiedAt
      : undefined;
  const verifiedTime =
    typeof verifiedAt === 'string' ? Date.parse(verifiedAt) : NaN;
  return Number.isFinite(verifiedTime) &&
    Date.now() - verifiedTime > SOURCE_STALE_AFTER_MS
    ? ['출처 확인 시각이 7일을 지났습니다. 최신 정보를 확인해 주세요.']
    : [];
}
function newId(): string {
  const bytes = randomBytes(8);
  return 'fst_' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function draftFor(
  id: string,
  input: { name: string; venue: string; days: unknown[] },
  source: { name: string; url: string | null; verifiedAt: string },
  thumbUrl: string | null = null,
  ticketLinks: { label: string; url: string }[] = [],
  eventPeriod?: { firstDate: string; lastDate: string },
): FestivalDocument {
  return {
    id,
    name: input?.name,
    venue: input?.venue,
    timezone: 'Asia/Seoul',
    days: input?.days,
    ...(eventPeriod ? { eventPeriod } : {}),
    thumbUrl,
    ticketLinks,
    flagsEnabled: false,
    stages: [],
    sets: [],
    zones: [],
    flags: [],
    directions: {
      shuttle: null,
      transit: null,
      parking: null,
      memo: null,
      lastShuttleAt: null,
      lastTrainAt: null,
      mapLinks: { naver: null, kakao: null },
      location: null,
      source,
    },
    checklist: [],
    rules: [],
    mapImageUrl: null,
    mapAspect: null,
    mapStages: [],
    source,
  };
}

function draftErrors(draft: FestivalDocument): void {
  const errors = validateDraft(draft);
  if (errors.length)
    throw new BadRequestException({
      code: 'VALIDATION',
      message: errors.join('; '),
      errors,
    });
}

function conflict(current: AdminFestival): never {
  throw new HttpException(
    {
      code: 'DRAFT_CONFLICT',
      message: '초안 버전이 변경되었습니다.',
      draft: current.draft,
      draftVersion: current.draftVersion,
    },
    412,
  );
}

@Injectable()
export class AdminFestivalService {
  constructor(
    @InjectRepository(AdminFestival)
    private readonly festivals: Repository<AdminFestival>,
    @InjectRepository(AdminFestivalVersion)
    private readonly versions: Repository<AdminFestivalVersion>,
    private readonly dataSource: DataSource,
    private readonly audit: AdminAuditService,
    private readonly cache: CacheService,
    private readonly publicFestivals: PublicFestivalService,
    private readonly liveActivity: LiveActivityService,
  ) {}

  async list() {
    const rows = await this.festivals.find({ order: { createdAt: 'DESC' } });
    const table = await this.dataSource.query<{ present: string | null }[]>(
      `SELECT to_regclass('crawl_proposals') AS present`,
    );
    const counts = table[0]?.present
      ? await this.dataSource.query<{ festivalId: string; count: number }[]>(
          `SELECT "festivalId", count(*)::int AS count FROM "crawl_proposals" WHERE status = 'open' AND "festivalId" IS NOT NULL GROUP BY "festivalId"`,
        )
      : [];
    const openByFestival = new Map(
      counts.map((count) => [count.festivalId, count.count]),
    );
    return {
      items: rows.map((f) => ({
        id: f.id,
        name: f.draft.name,
        venue: f.draft.venue,
        days: f.draft.days,
        eventPeriod: f.draft.eventPeriod ?? null,
        thumbUrl: f.draft.thumbUrl ?? null,
        draftVersion: f.draftVersion,
        publishedVersion: f.publishedVersion,
        openProposals: openByFestival.get(f.id) ?? 0,
      })),
    };
  }

  async create(
    input: { name: string; venue: string; days: unknown[] },
    actor: string | null,
  ) {
    const draft = draftFor(newId(), input, {
      name: '관리자 입력',
      url: null,
      verifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
    draftErrors(draft);
    const row = this.festivals.create({
      id: draft.id as string,
      draft,
      draftVersion: 1,
      draftUpdatedBy: actor,
      published: null,
      publishedVersion: 0,
    });
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(AdminFestival).save(row);
      await this.audit.record(manager, {
        actor,
        action: 'festival.created',
        target: `festival:${row.id}`,
        before: null,
        after: { draftVersion: row.draftVersion, draft: row.draft },
      });
    });
    return this.draftResponse(row);
  }

  async importDiscovered(
    id: string,
    input: { days?: unknown[] } | undefined,
    actor: string | null,
  ) {
    if (!/^fst_[0-9a-f]{16}$/.test(id))
      throw new NotFoundException('발견된 축제를 찾을 수 없습니다.');
    if (await this.festivals.exist({ where: { id } }))
      throw new ConflictException('이미 관리 중인 축제입니다.');
    const entry: DiscoverySummary | null =
      await this.publicFestivals.discovered(id);
    if (!entry) throw new NotFoundException('발견된 축제를 찾을 수 없습니다.');
    const days = input?.days === undefined ? [] : input.days;
    if (
      !Array.isArray(days) ||
      (days.length > 0 &&
        ((days[0] as { date?: unknown } | undefined)?.date !==
          entry.firstDate ||
          (days[days.length - 1] as { date?: unknown } | undefined)?.date !==
            entry.lastDate))
    )
      throw new BadRequestException({
        code: 'VALIDATION',
        message:
          'days의 첫날과 마지막 날은 발견된 축제 날짜 범위와 같아야 합니다.',
      });
    const draft = draftFor(
      id,
      { name: entry.name, venue: entry.venue, days },
      {
        name: '공개 수집 카탈로그',
        url: entry.sourceUrl,
        verifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
      entry.thumbUrl ?? entry.posterUrl ?? null,
      entry.ticketLinks,
      { firstDate: entry.firstDate, lastDate: entry.lastDate },
    );
    if (entry.location)
      draft.directions = {
        ...(draft.directions as Record<string, unknown>),
        location: entry.location,
      };
    draftErrors(draft);
    const row = this.festivals.create({
      id,
      draft,
      draftVersion: 1,
      draftUpdatedBy: actor,
      published: null,
      publishedVersion: 0,
    });
    try {
      await this.dataSource.transaction(async (manager) => {
        const inserted = await manager.query<{ draftUpdatedAt: Date }[]>(
          `INSERT INTO admin_festivals
             ("id", "draft", "draftVersion", "draftUpdatedBy", "published", "publishedVersion")
           VALUES ($1, $2::jsonb, 1, $3, NULL, 0)
           RETURNING "draftUpdatedAt"`,
          [id, JSON.stringify(draft), actor],
        );
        row.draftUpdatedAt = inserted[0].draftUpdatedAt;
        await this.audit.record(manager, {
          actor,
          action: 'festival.discovered.imported',
          target: `festival:${id}`,
          before: null,
          after: { draftVersion: 1, draft },
        });
      });
    } catch (error) {
      const databaseError = error as {
        code?: string;
        driverError?: { code?: string };
      };
      if (
        databaseError.code === '23505' ||
        databaseError.driverError?.code === '23505'
      )
        throw new ConflictException('이미 관리 중인 축제입니다.');
      throw error;
    }
    return this.draftResponse(row);
  }

  async getDraft(id: string) {
    return this.draftResponse(await this.get(id));
  }

  async patch(
    id: string,
    patch: unknown,
    ifMatch: string | undefined,
    actor: string | null,
  ) {
    const expected = this.matchVersion(ifMatch);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AdminFestival);
      const row = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('페스티벌을 찾을 수 없습니다.');
      if (row.draftVersion !== expected) conflict(row);
      const next = normalizeLegacyReturnTimes(
        mergeDraft(row.draft, patch),
        patch,
      );
      // Metadata drafts must remain editable through the ordinary admin API.
      // A partial schedule is a draft, not an unpublished metadata pack.
      if (
        next.timetableStatus === 'unpublished' &&
        ['days', 'stages', 'sets'].some(
          (key) => Array.isArray(next[key]) && next[key].length > 0,
        )
      )
        delete next.timetableStatus;
      if (
        next.eventPeriod &&
        next.timetableStatus === undefined &&
        validateDraft(next, true).length === 0
      )
        next.timetableStatus = 'verified';
      const errors = validateDraft(next);
      if (errors.length)
        throw new BadRequestException({
          code: 'VALIDATION',
          message: errors.join('; '),
          errors,
        });
      const before = { draftVersion: row.draftVersion, draft: row.draft };
      row.draft = next;
      row.draftVersion++;
      row.draftUpdatedBy = actor;
      await repo.save(row);
      await this.audit.record(manager, {
        actor,
        action: 'festival.draft.updated',
        target: `festival:${id}`,
        before,
        after: { draftVersion: row.draftVersion, draft: row.draft },
      });
      return this.draftResponse(row);
    });
  }

  async replaceArray(
    id: string,
    field: 'sets' | 'zones',
    items: unknown,
    ifMatch: string | undefined,
    actor: string | null,
  ) {
    if (!Array.isArray(items))
      throw new BadRequestException(`${field}: 배열이 필요합니다.`);
    return this.patch(id, { [field]: items }, ifMatch, actor);
  }

  async diff(id: string) {
    const row = await this.get(id);
    const before = row.published ?? {};
    const after = row.draft;
    const items: { path: string; before: unknown; after: unknown }[] = [];
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        items.push({
          path: `/${key}`,
          before: before[key] ?? null,
          after: after[key] ?? null,
        });
    }
    return { items };
  }

  async publish(
    id: string,
    note: string,
    ifMatch: string | undefined,
    actor: string | null,
  ) {
    if (typeof note !== 'string' || [...note].length > 500)
      throw new BadRequestException('note는 500자 이하의 문자열이어야 합니다.');
    const expected = this.matchVersion(ifMatch);
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AdminFestival);
      const row = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('페스티벌을 찾을 수 없습니다.');
      if (row.draftVersion !== expected) conflict(row);
      const draft = normalizeLegacyReturnTimes(row.draft);
      const errors = validateDraft(draft, true);
      if (errors.length)
        throw new BadRequestException({
          code: 'VALIDATION',
          message: errors.join('; '),
          errors,
        });
      return this.writePublication(manager, row, draft, note, actor);
    });
    await this.cache.invalidatePack(id);
    return result;
  }

  async publishCrawled(
    detail: CrawledFestivalDetail,
    timetable: CrawledFestivalTimetable | null,
  ): Promise<{ packVersion: number; changed: boolean }> {
    if (!/^fst_[0-9a-f]{16}$/.test(detail.id))
      throw new BadRequestException('수집된 축제 ID가 올바르지 않습니다.');
    const result = await this.dataSource.transaction(async (manager) => {
      // Serialize corrections to the same source before resolving its stable ID.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`crawl-source:${detail.sourceUrl}`],
      );
      const matches = await manager.query<{ id: string }[]>(
        `SELECT "id" FROM "admin_festivals"
         WHERE "published"->'source'->>'url' = $1
            OR ("published" IS NULL AND "draft"->'source'->>'url' = $1)`,
        [detail.sourceUrl],
      );
      if (matches.length > 1)
        throw new ConflictException('같은 출처의 관리 축제가 여러 개입니다.');
      const id = matches[0]?.id ?? detail.id;
      // Covers absent rows; manual publishers take the same existing-row lock.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [id],
      );
      const repo = manager.getRepository(AdminFestival);
      let row = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      // 관리자가 보유한 미발행 초안은 자동 발행으로 덮어쓰지 않는다.
      if (row && !row.published)
        return { id, packVersion: row.publishedVersion, changed: false };
      const previous = row?.published;
      const previousSource = previous?.source as
        { verifiedAt?: string } | undefined;
      const source = {
        name: '공개 수집 카탈로그',
        url: detail.sourceUrl,
        verifiedAt:
          previousSource?.verifiedAt ??
          new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      const document = previous
        ? publicationContent(previous)
        : draftFor(id, { ...detail, days: [] }, source);
      Object.assign(document, {
        name: detail.name,
        venue: detail.venue,
        eventPeriod: { firstDate: detail.firstDate, lastDate: detail.lastDate },
        thumbUrl: detail.thumbUrl ?? null,
        ticketLinks: detail.ticketLinks,
        source,
      });
      // Date corrections cannot invalidate a retained verified timetable.
      // Adopt their new period only together with its complete replacement.
      if (!timetable && Array.isArray(previous?.days) && previous.days.length) {
        if (previous.eventPeriod === undefined) delete document.eventPeriod;
        else document.eventPeriod = previous.eventPeriod;
      }
      if (detail.artists !== undefined) document.artists = detail.artists;
      const imageFor = crawledArtistImages(detail.artists);
      if (detail.officialInstagramUrl !== undefined)
        document.officialInstagramUrl = detail.officialInstagramUrl;
      if (detail.location !== undefined) {
        const directions = document.directions as Record<string, unknown>;
        const oldLocation = verifiedVenueLocation(directions?.location);
        const nextLocation = verifiedVenueLocation(detail.location);
        const stableLocation =
          oldLocation?.source && nextLocation?.source
            ? {
                ...nextLocation,
                source: {
                  ...nextLocation.source,
                  verifiedAt: oldLocation.source.verifiedAt,
                },
              }
            : nextLocation;
        document.directions = {
          ...directions,
          location:
            oldLocation &&
            stableLocation &&
            contentKey(oldLocation) === contentKey(stableLocation)
              ? oldLocation
              : detail.location,
        };
      }
      if (timetable) {
        if (
          !timetable.days.length ||
          !timetable.stages.length ||
          !timetable.sets.length
        )
          throw new BadRequestException('완전한 검증 시간표가 필요합니다.');
        Object.assign(document, timetable, { timetableStatus: 'verified' });
      } else if (!Array.isArray(document.days) || !document.days.length) {
        Object.assign(document, {
          days: [],
          stages: [],
          sets: [],
          timetableStatus: 'unpublished',
        });
      }
      // 남겨 둔 공연도 다시 수집한 출연진 사진을 쓴다.
      document.sets = withLatestImages(document.sets, 'artist', imageFor);
      const errors = validateDraft(document, true);
      if (errors.length)
        throw new BadRequestException({
          code: 'VALIDATION',
          message: errors.join('; '),
          errors,
        });
      if (row) await this.refreshDraftImages(manager, row, detail, imageFor);
      if (previous && contentKey(previous) === contentKey(document))
        return { id, packVersion: row!.publishedVersion, changed: false };
      if (!row) {
        row = repo.create({
          id,
          draft: document,
          draftVersion: 1,
          draftUpdatedBy: null,
          published: null,
          publishedVersion: 0,
        });
        // A concurrent manual import does not take our advisory lock. Insert
        // explicitly so its draft wins instead of save() updating that row.
        await manager.query(
          `INSERT INTO "admin_festivals"
           ("id", "draft", "draftVersion", "draftUpdatedBy", "published", "publishedVersion")
           VALUES ($1, $2::jsonb, 1, NULL, NULL, 0)`,
          [id, JSON.stringify(document)],
        );
      }
      // Existing drafts belong to their editors, even when actor is null.
      const published = await this.writePublication(
        manager,
        row,
        document,
        '공개 수집 정보 자동 발행',
        null,
      );
      return { id, packVersion: published.packVersion, changed: true };
    });
    if (result.changed) await this.cache.invalidatePack(result.id);
    return { packVersion: result.packVersion, changed: result.changed };
  }

  /**
   * 관리 초안에 다시 수집한 출연진 사진을 넣는다. 초안의 다른 편집 내용은 건드리지 않고,
   * 출연진 목록이 비어 있을 때만 수집 목록을 채운다.
   */
  private async refreshDraftImages(
    manager: EntityManager,
    row: AdminFestival,
    detail: CrawledFestivalDetail,
    imageFor: (name: unknown) => ArtistImage | null,
  ) {
    const draft = row.draft;
    const next: FestivalDocument = {
      ...draft,
      sets: withLatestImages(draft.sets, 'artist', imageFor),
    };
    if (draft.sets === undefined) delete next.sets;
    if (Array.isArray(draft.artists) && draft.artists.length)
      next.artists = withLatestImages(draft.artists, 'name', imageFor);
    else if (detail.artists?.length) next.artists = detail.artists;
    if (contentKey(next) === contentKey(draft)) return;
    const before = { draftVersion: row.draftVersion, draft };
    row.draft = next;
    row.draftVersion++;
    row.draftUpdatedBy = null;
    await manager.getRepository(AdminFestival).save(row);
    await this.audit.record(manager, {
      actor: null,
      action: 'festival.draft.updated',
      target: `festival:${row.id}`,
      before,
      after: { draftVersion: row.draftVersion, draft: row.draft },
    });
  }

  private async writePublication(
    manager: EntityManager,
    row: AdminFestival,
    draft: FestivalDocument,
    note: string,
    actor: string | null,
  ) {
    const id = row.id;
    const repo = manager.getRepository(AdminFestival);
    const packVersion = row.publishedVersion + 1;
    const pack = {
      ...draft,
      packVersion,
      packUpdatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    if (
      brotliCompressSync(Buffer.from(JSON.stringify(pack))).length >
      200 * 1024
    )
      throw new BadRequestException('압축된 팩이 200KB를 초과합니다.');
    const sizeBytes = Buffer.byteLength(JSON.stringify(pack));
    const previousVersion = row.publishedVersion;
    row.published = pack;
    row.publishedVersion = packVersion;
    await repo.save(row);
    await manager.getRepository(AdminFestivalVersion).save({
      festivalId: id,
      packVersion,
      pack,
      publishedBy: actor,
      note,
      sizeBytes,
    });
    const pushedDevices = await this.queuePackUpdate(manager, id, packVersion);
    await this.liveActivity.enqueueFestival(id, manager);
    await this.audit.record(manager, {
      actor,
      action: 'festival.published',
      target: `festival:${id}`,
      before: { packVersion: previousVersion },
      after: { packVersion, note },
    });
    return {
      packVersion,
      etag: `"v${packVersion}"`,
      pushedDevices,
      warnings: sourceWarnings(row.draft),
    };
  }

  async versionsList(id: string) {
    await this.get(id);
    const rows = await this.versions.find({
      where: { festivalId: id },
      order: { packVersion: 'DESC' },
    });
    return {
      items: rows.map(
        ({ packVersion, publishedAt, publishedBy, note, sizeBytes }) => ({
          packVersion,
          publishedAt,
          publishedBy,
          note,
          sizeBytes,
        }),
      ),
    };
  }

  async rollback(id: string, toVersion: number, actor: string | null) {
    if (!Number.isSafeInteger(toVersion) || toVersion < 1)
      throw new BadRequestException('toVersion은 양의 정수여야 합니다.');
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AdminFestival);
      const row = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('페스티벌을 찾을 수 없습니다.');
      const target = await manager
        .getRepository(AdminFestivalVersion)
        .findOneBy({ festivalId: id, packVersion: toVersion });
      if (!target) throw new NotFoundException('발행 버전을 찾을 수 없습니다.');
      const packVersion = row.publishedVersion + 1;
      const pack = {
        ...target.pack,
        packVersion,
        packUpdatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      if (
        brotliCompressSync(Buffer.from(JSON.stringify(pack))).length >
        200 * 1024
      )
        throw new BadRequestException('압축된 팩이 200KB를 초과합니다.');
      const previousVersion = row.publishedVersion;
      row.published = pack;
      row.publishedVersion = packVersion;
      await repo.save(row);
      await manager.getRepository(AdminFestivalVersion).save({
        festivalId: id,
        packVersion,
        pack,
        publishedBy: actor,
        note: `Rollback to ${toVersion}`,
        sizeBytes: Buffer.byteLength(JSON.stringify(pack)),
      });
      const pushedDevices = await this.queuePackUpdate(
        manager,
        id,
        packVersion,
      );
      await this.liveActivity.enqueueFestival(id, manager);
      await this.audit.record(manager, {
        actor,
        action: 'festival.rolled_back',
        target: `festival:${id}`,
        before: { packVersion: previousVersion },
        after: { packVersion, toVersion },
      });
      return { packVersion, etag: `"v${packVersion}"`, pushedDevices };
    });
    await this.cache.invalidatePack(id);
    return result;
  }

  private async queuePackUpdate(
    manager: EntityManager,
    id: string,
    version: number,
  ): Promise<number> {
    const queued = await manager.query<{ id: string }[]>(
      `INSERT INTO "notification_deliveries"
        ("id", "deviceId", "festivalId", "eventKey", "scheduledAt", "nextAttemptAt")
       SELECT gen_random_uuid(), s."deviceId", $1::varchar, $2::varchar, now(), now()
       FROM "device_subscriptions" s
       JOIN "devices" d ON d."id" = s."deviceId"
       WHERE s."festivalId" = $1 AND s."packUpdates" = true
         AND d."notifyPackUpdates" = true
         AND d."apnsToken" IS NOT NULL AND d."apnsEnvironment" IS NOT NULL
       ON CONFLICT ("deviceId", "eventKey") DO NOTHING
       RETURNING "id"`,
      [id, `pack-updated:${id}:${version}`],
    );
    await withInboxSavepoint(manager, async () => {
      // 알림함은 푸시 설정과 무관하게 이 축제를 핀한 로그인 계정에 남긴다.
      const owners = await manager.query<
        Array<{ userId: string; name: string | null }>
      >(
        `SELECT DISTINCT d."userId", f."published"->>'name' AS "name"
         FROM "device_subscriptions" s
         JOIN "devices" d ON d."id" = s."deviceId" AND d."userId" IS NOT NULL
         JOIN "admin_festivals" f ON f."id" = s."festivalId"
         WHERE s."festivalId" = $1::varchar AND s."pinned" = true`,
        [id],
      );
      await recordUserNotifications(
        manager,
        owners.map((row) => row.userId),
        {
          type: 'pack.updated',
          festivalId: id,
          title: `${owners[0]?.name ?? '축제'} 정보 업데이트`,
          body: '새 축제 정보가 준비됐어요. 앱에서 팩을 받아 두세요.',
          route: `/festivals/${id}`,
          subject: { packVersion: String(version) },
          dedupeKey: `pack.updated:${id}:${version}`,
        },
      );
    });
    return queued.length;
  }

  private async get(id: string): Promise<AdminFestival> {
    const row = await this.festivals.findOneBy({ id });
    if (!row) throw new NotFoundException('페스티벌을 찾을 수 없습니다.');
    return row;
  }

  private matchVersion(value: string | undefined): number {
    if (!value || !/^"d[1-9]\d*"$/.test(value))
      throw new HttpException(
        'If-Match: "d{draftVersion}" 헤더가 필요합니다.',
        428,
      );
    return Number(value.slice(2, -1));
  }

  private draftResponse(row: AdminFestival) {
    return {
      ...row.draft,
      draftVersion: row.draftVersion,
      draftUpdatedAt: row.draftUpdatedAt,
      draftUpdatedBy: row.draftUpdatedBy,
      warnings: sourceWarnings(row.draft),
    };
  }
}
