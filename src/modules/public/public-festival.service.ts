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
import { CrawlTimetableSet } from '../admin/crawl/entity/crawl-timetable-revision.entity';
import { PUBLIC_CRAWL_IMAGE_SQL } from './crawl-image-policy';
import { Flag } from '../flags/flag.entity';
import { artistNameKeys, normalizeArtistName } from '../../common/artist-name';
import {
  CacheService,
  PUBLIC_PACK_PROJECTION_VERSION,
} from '../redis/service/cache.service';
import {
  attachPrugioLineup,
  discoverySummaries,
  DiscoveryRow,
  DiscoverySummary,
  PublishedDiscoveryRow,
} from './crawl-catalog';
import {
  PRUGIO_LINEUP_SEED,
  PRUGIO_LINEUP_URL,
} from '../admin/crawl/service/prugio-lineup';
import {
  WONDERLIVET_DETAIL_SEED,
  WONDERLIVET_LINK_PAGE,
  WONDERLIVET_TICKET_SEED,
} from '../admin/crawl/service/wonderlivet-ticket-link';
import { WONDERLIVET_FESTIVAL_URL } from '../admin/crawl/service/wonderlivet-lineup';

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

function artistImageForName(
  name: string,
  imageByName: Map<string, Set<string>>,
): string | null {
  const images = new Set(
    artistNameKeys(name).flatMap((key) => [...(imageByName.get(key) ?? [])]),
  );
  return images.size === 1 ? [...images][0] : null;
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

export function publicPackEtag(packVersion: number): string {
  return `"cdm${PUBLIC_PACK_PROJECTION_VERSION}-v${packVersion}"`;
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
  const artists = new Map<string, { name: string; imageUrl: string | null }>();
  for (const set of requiredArray(result.sets)) {
    if (typeof set.artist !== 'string' || !set.artist.trim()) continue;
    const name = set.artist.trim();
    const key = artistNameKeys(name)[0];
    const imageUrl = set.imageUrl as string | null;
    const existing = artists.get(key);
    if (!existing) artists.set(key, { name, imageUrl });
    else if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
  }
  result.artists = [...artists.values()];
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
           catalog.url AS "catalogUrl",
           source."parserConfig"->>'seed' AS "sourceSeed",
           item->>'decision' AS decision,
           p.status AS "proposalStatus",
           p."createdAt" AS created_at,
           p.id AS proposal_id
         FROM crawl_proposals p
         LEFT JOIN crawl_sources source ON source.id = p."sourceId"
         CROSS JOIN LATERAL jsonb_array_elements(p.items) item
         CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(source."parserConfig"->'festivalSourceUrls') = 'array'
             THEN source."parserConfig"->'festivalSourceUrls'
             ELSE jsonb_build_array(COALESCE(
               NULLIF(source."parserConfig"->>'festivalSourceUrl', ''),
               item->'after'->>'url')) END
         ) catalog(url)
         WHERE p.kind = 'festival.new'
           AND item->'after'->>'url' IS NOT NULL
       ), latest AS (
         SELECT DISTINCT ON (url) * FROM candidates
         ORDER BY url, created_at DESC, proposal_id DESC
       ), details AS (
         SELECT "catalogUrl" AS url,
           (array_agg(candidate->>'officialInstagramUrl' ORDER BY created_at DESC, proposal_id DESC)
             FILTER (WHERE "sourceSeed" IS DISTINCT FROM 'official-ticket-link-detail'
               AND decision IS DISTINCT FROM 'rejected'
               AND "proposalStatus" IS DISTINCT FROM 'rejected'
               AND candidate->>'officialInstagramUrl' IS NOT NULL))[1] AS account,
           (array_agg(candidate->>'posterUrl' ORDER BY created_at DESC, proposal_id DESC)
             FILTER (WHERE "sourceSeed" IS DISTINCT FROM 'official-ticket-link-detail'
               AND decision IS DISTINCT FROM 'rejected'
               AND "proposalStatus" IS DISTINCT FROM 'rejected'
               AND candidate->>'posterUrl' IS NOT NULL))[1] AS poster,
           (array_agg(jsonb_build_object(
               'artists', candidate->'artists', 'url', candidate->>'url')
               ORDER BY created_at DESC, proposal_id DESC, candidates.url DESC)
             FILTER (WHERE "sourceSeed" IS DISTINCT FROM 'official-ticket-link-detail'
               AND decision IS DISTINCT FROM 'rejected'
               AND "proposalStatus" IS DISTINCT FROM 'rejected'
               AND regexp_replace(candidate->>'url', '[?#].*$', '') NOT IN (
                 'https://www.mintpaper.co.kr/posts/4819',
                 'https://mintpaper.co.kr/posts/4819')
               AND jsonb_array_length(CASE WHEN jsonb_typeof(candidate->'artists') = 'array'
                 THEN candidate->'artists' ELSE '[]'::jsonb END) > 0))[1] AS "artistDetails",
           (array_agg(candidate->'artists'
               ORDER BY created_at DESC, proposal_id DESC, candidates.url DESC)
             FILTER (WHERE "sourceSeed" = 'official-lineup'
               AND decision IS DISTINCT FROM 'rejected'
               AND "proposalStatus" IS DISTINCT FROM 'rejected'
               AND regexp_replace(candidate->>'url', '[?#].*$', '') IN (
                 'https://www.mintpaper.co.kr/posts/4819',
                 'https://mintpaper.co.kr/posts/4819')
               AND jsonb_array_length(CASE WHEN jsonb_typeof(candidate->'artists') = 'array'
                 THEN candidate->'artists' ELSE '[]'::jsonb END) > 0))[1] AS "officialProfileArtists"
         FROM candidates GROUP BY "catalogUrl"
       )
       SELECT (latest.candidate - 'artistSourceUrl' - 'officialProfileArtists') || jsonb_strip_nulls(jsonb_build_object(
           'officialInstagramUrl', details.account, 'posterUrl', details.poster,
           'artists', details."artistDetails"->'artists',
           'artistSourceUrl', details."artistDetails"->>'url',
           'officialProfileArtists', details."officialProfileArtists"
         )) AS candidate,
         latest.decision,
         latest."proposalStatus",
         (SELECT item->'after'
          FROM crawl_proposals proposal
          JOIN crawl_sources source ON source.id = proposal."sourceId"
          CROSS JOIN LATERAL jsonb_array_elements(proposal.items) item
          WHERE source.kind = 'discovery' AND source.url = $1::text
            AND source."parserConfig"->>'seed' = $2::text
            AND proposal.kind = 'festival.new'
            AND proposal.status <> 'rejected'
            AND item->>'decision' <> 'rejected'
          ORDER BY proposal."createdAt" DESC, proposal.id DESC
          LIMIT 1) AS "prugioCandidate"
       FROM latest JOIN details USING (url)`,
      [PRUGIO_LINEUP_URL, PRUGIO_LINEUP_SEED],
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
    const summaries = discoverySummaries(discoveryRows, publishedRows);
    attachPrugioLineup(summaries, discoveryRows[0]?.prugioCandidate);
    await this.attachVerifiedWonderlivetTicket(summaries);
    const festivalSourceUrl = 'https://mintpaper.co.kr/festivals/178';
    const related = summaries.filter(
      (summary) =>
        summary.sourceUrl === festivalSourceUrl ||
        summary.sourceUrls.includes(festivalSourceUrl),
    );
    if (!related.length) return summaries;

    const linkRows = await this.dataSource.query<
      { url: string; verifiedTicketUrls: string }[]
    >(
      `SELECT child.url, parent."parserConfig"->>'verifiedTicketUrls' AS "verifiedTicketUrls"
       FROM crawl_sources parent JOIN crawl_sources child
         ON child."parserConfig"->>'festivalSourceUrl' =
            parent."parserConfig"->>'festivalSourceUrl'
       WHERE parent.url = $1 AND parent.enabled = true AND child.enabled = true
         AND parent."parserConfig"->>'seed' = 'official-ticket-links'
         AND parent."parserConfig"->>'festivalSourceUrl' = $2
         AND child."parserConfig"->>'seed' = 'official-ticket-link-detail'
       ORDER BY child.url`,
      ['https://www.mintpaper.co.kr/posts/4821', festivalSourceUrl],
    );
    const verifiedUrls: string[] = [];
    let noticeOrder: string[] = [];
    for (const row of linkRows) {
      let allowed: unknown;
      try {
        allowed = JSON.parse(row.verifiedTicketUrls);
      } catch {
        continue;
      }
      if (
        !Array.isArray(allowed) ||
        allowed.length > 5 ||
        !allowed.every(
          (url) =>
            typeof url === 'string' &&
            /^https:\/\/(?:nol\.yanolja\.com\/ticket\/products|ticket\.yes24\.com\/Perf)\/\d+$/.test(
              url,
            ),
        ) ||
        !allowed.includes(row.url) ||
        verifiedUrls.includes(row.url)
      )
        continue;
      if (!noticeOrder.length) noticeOrder = allowed as string[];
      verifiedUrls.push(row.url);
    }
    verifiedUrls.sort(
      (a, b) => noticeOrder.indexOf(a) - noticeOrder.indexOf(b),
    );
    const verifiedYes24Ids = new Set(
      verifiedUrls
        .map(
          (url) => /^https:\/\/ticket\.yes24\.com\/Perf\/(\d+)$/.exec(url)?.[1],
        )
        .filter((id): id is string => !!id),
    );
    const verifiedYes24Product = (url: string) => {
      if (!url.startsWith('https://ticket.yes24.com/')) return true;
      const id =
        /^https:\/\/ticket\.yes24\.com\/(?:English\/)?Perf\/(\d+)$/.exec(
          url,
        )?.[1];
      return !!id && verifiedYes24Ids.has(id);
    };
    const official =
      related.find((summary) => summary.sourceUrl === festivalSourceUrl) ??
      related.find((summary) => summary.sourceUrls.includes(festivalSourceUrl));
    if (official) {
      const eventName = official.name
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      for (const summary of summaries) {
        if (summary === official) continue;
        const productId =
          /^https:\/\/ticket\.yes24\.com\/(?:English\/)?Perf\/(\d+)$/.exec(
            summary.sourceUrl,
          )?.[1];
        if (
          !productId ||
          !verifiedYes24Ids.has(productId) ||
          summary.name
            .normalize('NFKC')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase() !== eventName ||
          summary.firstDate !== official.firstDate ||
          summary.lastDate < summary.firstDate ||
          summary.lastDate > official.lastDate ||
          summary.sourceUrls.some((url) => {
            const match =
              /^https:\/\/ticket\.yes24\.com\/(?:English\/)?Perf\/(\d+)$/.exec(
                url,
              );
            return (
              url.startsWith('https://ticket.yes24.com/') &&
              match?.[1] !== productId
            );
          })
        )
          continue;
        summary.sourceUrls = [
          ...new Set([
            ...summary.sourceUrls,
            festivalSourceUrl,
            `https://ticket.yes24.com/Perf/${productId}`,
          ]),
        ];
        official.sourceUrls = [
          ...new Set([
            ...official.sourceUrls,
            summary.sourceUrl,
            `https://ticket.yes24.com/Perf/${productId}`,
          ]),
        ];
      }
    }
    for (const summary of related) {
      if (
        /^https:\/\/nol\.yanolja\.com\/ticket\/products\//.test(
          summary.sourceUrl,
        ) ||
        !verifiedYes24Product(summary.sourceUrl)
      )
        summary.sourceUrl = festivalSourceUrl;
      summary.sourceUrls = [
        ...new Set([
          ...summary.sourceUrls.filter(
            (url) =>
              (!/^https:\/\/nol\.yanolja\.com\//.test(url) ||
                verifiedUrls.includes(url)) &&
              verifiedYes24Product(url),
          ),
          festivalSourceUrl,
        ]),
      ];
      const primary = summary.ticketLinks.find(
        (link) =>
          link.url === summary.sourceUrl &&
          (link.label !== 'NOL' || verifiedUrls.includes(link.url)) &&
          verifiedYes24Product(link.url),
      );
      const nol = verifiedUrls
        .filter(
          (url) =>
            url !== primary?.url && url.startsWith('https://nol.yanolja.com/'),
        )
        .map((url) => ({ label: 'NOL', url }));
      const yes24 = verifiedUrls
        .filter(
          (url) =>
            url !== primary?.url && url.startsWith('https://ticket.yes24.com/'),
        )
        .map((url) => ({ label: '예스24', url }));
      const other = summary.ticketLinks.filter(
        (link) =>
          link.url !== primary?.url &&
          link.label !== 'NOL' &&
          !verifiedUrls.includes(link.url) &&
          !/^https:\/\/nol\.yanolja\.com\//.test(link.url) &&
          verifiedYes24Product(link.url) &&
          link.label !== '공식 인스타그램',
      );
      const instagram = summary.ticketLinks.filter(
        (link) => link.label === '공식 인스타그램',
      );
      summary.ticketLinks = [
        ...(primary ? [primary] : []),
        ...nol,
        ...yes24,
        ...other,
        ...instagram,
      ].slice(0, 5);
    }
    return summaries;
  }

  private async attachVerifiedWonderlivetTicket(
    summaries: DiscoverySummary[],
  ): Promise<void> {
    const eventName = /^WONDERLIVET 2026(?: \(원더리벳 2026\))?$/;
    if (
      !summaries.some(
        (summary) =>
          eventName.test(summary.name) &&
          summary.firstDate === '2026-11-20' &&
          summary.lastDate === '2026-11-22' &&
          /^https:\/\/ticket\.melon\.com\/performance\/index\.htm\?prodId=[1-9]\d*$/.test(
            summary.sourceUrl,
          ),
      )
    )
      return;
    const rows = await this.dataSource.query<
      { url: string; candidate: unknown }[]
    >(
      `SELECT child.url, latest.candidate
       FROM crawl_sources parent
       JOIN crawl_runs verified ON verified.id::text =
         parent."parserConfig"->>'verifiedRunId'
       JOIN crawl_sources child ON child.url =
         parent."parserConfig"->>'verifiedTicketUrl'
       JOIN LATERAL (
         SELECT run.result, run."contentHash", run."proposalId" FROM crawl_runs run
         WHERE run."sourceId" = child.id
         ORDER BY run."startedAt" DESC, run.id DESC LIMIT 1
       ) childRun ON childRun.result IN ('proposed', 'unchanged', 'nochange-parsed')
       JOIN LATERAL (
         SELECT p.id AS "proposalId", p.status, p."runId", item->>'decision' AS decision,
           item->'after' AS candidate
         FROM crawl_proposals p
         CROSS JOIN LATERAL jsonb_array_elements(p.items) item
         WHERE p."sourceId" = child.id AND p.kind = 'festival.new'
           AND item->'after'->>'url' = child.url
         ORDER BY p."createdAt" DESC, p.id DESC
         LIMIT 1
       ) latest ON true
       JOIN crawl_runs proposedRun ON proposedRun.id = latest."runId"
         AND proposedRun."sourceId" = child.id
         AND proposedRun.result = 'proposed'
         AND proposedRun."contentHash" IS NOT NULL
         AND (
           (childRun.result IN ('proposed', 'unchanged')
             AND proposedRun."contentHash" = childRun."contentHash")
           OR (childRun.result = 'nochange-parsed'
             AND childRun."proposalId" = latest."proposalId")
         )
       WHERE parent.kind = 'discovery' AND parent.url = $1::text
         AND parent.enabled = true
         AND parent."parserConfig"->>'seed' = $2::text
         AND parent."parserConfig"->>'festivalSourceUrl' = $3::text
         AND verified."sourceId" = parent.id
         AND verified.result IN ('nochange-parsed', 'unchanged')
         AND NOT EXISTS (
           SELECT 1 FROM crawl_runs newer
           WHERE newer."sourceId" = parent.id
             AND newer."startedAt" > verified."startedAt"
         )
         AND child.kind = 'discovery' AND child.enabled = true
         AND child."parserConfig"->>'seed' = $4::text
         AND child."parserConfig"->>'festivalSourceUrl' = $3::text
         AND child."parserConfig"->'festivalSourceUrls' =
           jsonb_build_array(child.url, $3::text)
         AND latest.status IS DISTINCT FROM 'rejected'
         AND latest.decision IS DISTINCT FROM 'rejected'`,
      [
        WONDERLIVET_LINK_PAGE,
        WONDERLIVET_TICKET_SEED,
        WONDERLIVET_FESTIVAL_URL,
        WONDERLIVET_DETAIL_SEED,
      ],
    );
    for (const row of rows) {
      if (
        !/^https:\/\/ticket\.melon\.com\/performance\/index\.htm\?prodId=[1-9]\d*$/.test(
          row.url,
        )
      )
        continue;
      const candidate = row.candidate;
      if (
        !object(candidate) ||
        candidate.url !== row.url ||
        typeof candidate.name !== 'string' ||
        !eventName.test(candidate.name)
      )
        continue;
      const verified = discoverySummaries([{ candidate }]);
      if (
        verified.length !== 1 ||
        verified[0].firstDate !== '2026-11-20' ||
        verified[0].lastDate !== '2026-11-22'
      )
        continue;
      for (const summary of summaries) {
        if (
          summary.sourceUrl !== row.url ||
          !eventName.test(summary.name) ||
          summary.firstDate !== verified[0].firstDate ||
          summary.lastDate !== verified[0].lastDate
        )
          continue;
        if (!summary.sourceUrls.includes(WONDERLIVET_FESTIVAL_URL))
          summary.sourceUrls.push(WONDERLIVET_FESTIVAL_URL);
      }
    }
  }

  async discovered(id: string): Promise<DiscoverySummary | null> {
    const entry = (await this.discoveryCatalog()).find(
      (item) => item.id === id,
    );
    if (!entry) return null;
    await this.attachStoredImages([entry]);
    return entry;
  }

  private async attachStoredImages(
    entries: DiscoverySummary[],
    includeTimetableArtists = false,
  ): Promise<Map<string, string>> {
    const imageUrls = [
      ...new Set(
        entries.flatMap((entry) => [
          ...(entry.posterUrl ? [entry.posterUrl] : []),
          ...(entry.artists?.flatMap((artist) =>
            artist.sourceUrl ? [artist.sourceUrl] : [],
          ) ?? []),
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
    const festivalSourceUrls = [
      ...new Set(
        entries
          .filter((entry) => includeTimetableArtists || entry.artists?.length)
          .flatMap((entry) => entry.sourceUrls),
      ),
    ];
    const officialGallerySourceSql = `source."parserConfig"->>'seed' = 'official-artist-gallery'
      AND source."parserConfig"->>'artistOfficialNameSource' =
        'official-notice-and-modal-site'
      AND EXISTS (
        SELECT 1 FROM crawl_sources gallery
        WHERE gallery.kind = 'artist-gallery'
          AND gallery.enabled = true
          AND gallery.url = source.url
          AND gallery."parserConfig"->>'seed' = 'xmf-official-gallery'
          AND gallery."parserConfig"->>'festivalSourceUrl' =
            source."parserConfig"->>'festivalSourceUrl'
      )`;
    const profileImages = festivalSourceUrls.length
      ? await this.dataSource.query<
          {
            festivalSourceUrl: string;
            artistName: string;
            artistAlias: string | null;
            artistOfficialName: string | null;
            seed: string | null;
            id: string;
          }[]
        >(
          `SELECT DISTINCT ON (source."parserConfig"->>'festivalSourceUrl', source."parserConfig"->>'artistName')
             source."parserConfig"->>'festivalSourceUrl' AS "festivalSourceUrl",
             source."parserConfig"->>'artistName' AS "artistName",
             source."parserConfig"->>'artistAlias' AS "artistAlias",
             source."parserConfig"->>'seed' AS seed,
             CASE WHEN ${officialGallerySourceSql}
               THEN source."parserConfig"->>'artistOfficialName'
               ELSE NULL END AS "artistOfficialName", image.id
           FROM crawl_images image
           JOIN crawl_sources source ON source.id = image."sourceId"
           WHERE source.kind = 'artist-image'
             AND source."parserConfig"->>'festivalSourceUrl' = ANY($1::text[])
             AND ${PUBLIC_CRAWL_IMAGE_SQL}
           ORDER BY source."parserConfig"->>'festivalSourceUrl',
             source."parserConfig"->>'artistName',
             CASE WHEN source."parserConfig"->>'seed' = 'official-gmf-lineup'
               THEN 0
               WHEN ${officialGallerySourceSql}
               THEN 1 ELSE 2 END, image."lastSeenAt" DESC`,
          [festivalSourceUrls],
        )
      : [];
    const profileImageIdsByArtist = new Map<string, Set<string>>();
    for (const image of profileImages) {
      for (const name of [
        image.artistName,
        image.artistAlias,
        image.artistOfficialName,
      ]) {
        if (!name) continue;
        const key = `${image.festivalSourceUrl}\u0000${name}`;
        const ids = profileImageIdsByArtist.get(key) ?? new Set<string>();
        ids.add(image.id);
        profileImageIdsByArtist.set(key, ids);
      }
    }
    const profileImageByArtist = new Map<string, string>();
    for (const [key, ids] of profileImageIdsByArtist) {
      if (ids.size === 1) profileImageByArtist.set(key, [...ids][0]);
    }
    const profileImageByName = new Map<string, Set<string>>();
    for (const image of profileImages) {
      for (const name of [
        image.artistName,
        image.artistAlias,
        image.artistOfficialName,
      ]) {
        if (!name) continue;
        for (const nameKey of artistNameKeys(name)) {
          const normalizedKey = `${image.festivalSourceUrl}\u0000${nameKey}`;
          const imageIds =
            profileImageByName.get(normalizedKey) ?? new Set<string>();
          imageIds.add(image.id);
          profileImageByName.set(normalizedKey, imageIds);
        }
      }
    }
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
      if (
        includeTimetableArtists &&
        entry.sourceUrl === 'https://mintpaper.co.kr/festivals/172' &&
        !entry.artists?.length
      ) {
        const names = new Set(
          (entry.artists ?? []).flatMap((artist) =>
            artistNameKeys(artist.name),
          ),
        );
        for (const image of profileImages) {
          if (
            image.seed !== 'official-gmf-lineup' ||
            image.festivalSourceUrl !== entry.sourceUrl
          )
            continue;
          const keys = artistNameKeys(image.artistName);
          if (keys.some((key) => names.has(key))) continue;
          entry.artists = [
            ...(entry.artists ?? []),
            { name: image.artistName },
          ];
          keys.forEach((key) => names.add(key));
        }
      }
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
        const primaryProfileIds = new Set(
          artistNameKeys(artist.name).flatMap((nameKey) => [
            ...(profileImageByName.get(`${entry.sourceUrl}\u0000${nameKey}`) ??
              []),
          ]),
        );
        const matchingProfileIds = new Set(
          entry.sourceUrls.flatMap((sourceUrl) =>
            artistNameKeys(artist.name).flatMap((nameKey) => [
              ...(profileImageByName.get(`${sourceUrl}\u0000${nameKey}`) ?? []),
            ]),
          ),
        );
        const imageId =
          (primaryProfileIds.size === 1 ? [...primaryProfileIds][0] : null) ??
          (artist.sourceUrl && imageByUrl.get(artist.sourceUrl)) ??
          (primaryProfileIds.size === 0 && matchingProfileIds.size === 1
            ? [...matchingProfileIds][0]
            : null);
        return {
          ...artist,
          imageUrl: imageId ? `/api/v1/festivals/images/${imageId}.webp` : null,
        };
      });
    }
    return profileImageByArtist;
  }

  private async reviewedLineup(
    sourceUrls: string[],
  ): Promise<{ name: string; date?: string }[]> {
    const products = sourceUrls.filter((url) =>
      /^https:\/\/world\.nol\.com\/en\/ticket\/products\/\d+$/.test(url),
    );
    if (!products.length) return [];
    const rows = await this.dataSource.query<
      { artists: { name: string; date?: string }[] }[]
    >(
      `SELECT revision.artists FROM crawl_lineup_revisions revision
       JOIN crawl_sources lineup_source ON lineup_source.id = revision."sourceId"
       WHERE revision.status = 'approved' AND revision."productUrl" = ANY($1::text[])
         AND lineup_source.url = revision."productUrl"
         AND lineup_source.kind = 'discovery' AND lineup_source.parser = 'ticket-list'
         AND lineup_source.enabled = TRUE
         AND EXISTS (
           SELECT 1 FROM crawl_runs run
           WHERE run."sourceId" = revision."sourceId"
             AND run.id = (
               SELECT newest.id FROM crawl_runs newest
               WHERE newest."sourceId" = revision."sourceId"
               ORDER BY newest."startedAt" DESC LIMIT 1
             )
             AND run.result <> 'failed' AND run."finishedAt" IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(COALESCE(run."lineupEvidence", '[]'::jsonb)) evidence
               WHERE evidence->>'sourceUrl' = revision."productUrl"
                 AND evidence->>'imageUrl' = revision."imageUrl"
                 AND evidence->>'imageHash' = revision."imageHash"
                 AND evidence->>'parserVersion' = revision."parserVersion"
                 AND evidence->>'status' = 'ok'
                 AND evidence->'rawLines' = revision."rawLines"
             )
         )
       ORDER BY revision."reviewedAt" DESC, revision.id DESC`,
      [products],
    );
    const names = new Set<string>();
    return rows
      .flatMap((row) => row.artists ?? [])
      .filter((artist) => {
        const keys = artistNameKeys(artist.name);
        if (keys.some((key) => names.has(key))) return false;
        keys.forEach((key) => names.add(key));
        return true;
      });
  }

  async detail(id: string) {
    if (!/^fst_[0-9a-z]+$/.test(id))
      throw new NotFoundException({
        code: 'FESTIVAL_NOT_FOUND',
        message: '축제를 찾을 수 없습니다.',
      });
    const published = await this.festivals.findOne({ where: { id } });
    if (published?.published && published.publishedVersion > 0) {
      const pack = projectPack(published.published);
      return pack;
    }
    const entry = (await this.discoveryCatalog()).find(
      (item) => item.id === id,
    );
    if (!entry)
      throw new NotFoundException({
        code: 'FESTIVAL_NOT_FOUND',
        message: '축제를 찾을 수 없습니다.',
      });
    const reviewed = await this.reviewedLineup(entry.sourceUrls);
    const knownArtists = new Set(
      (entry.artists ?? []).flatMap((artist) => artistNameKeys(artist.name)),
    );
    for (const artist of reviewed) {
      const keys = artistNameKeys(artist.name);
      if (keys.some((key) => knownArtists.has(key))) continue;
      entry.artists = [...(entry.artists ?? []), { name: artist.name }];
      keys.forEach((key) => knownArtists.add(key));
    }
    const profileImages = await this.attachStoredImages([entry], true);
    const revisions = await this.dataSource.query<
      {
        id: string;
        sourceUrl: string;
        sourceImageId: string | null;
        verifiedAt: Date;
        sets: CrawlTimetableSet[];
      }[]
    >(
      `SELECT DISTINCT ON (revision."sourceId")
         revision.id, revision."sourceUrl", revision."verifiedAt", revision."sets",
         CASE WHEN image.id IS NOT NULL AND ${PUBLIC_CRAWL_IMAGE_SQL}
           THEN image.id ELSE NULL END AS "sourceImageId"
       FROM crawl_timetable_revisions revision
       LEFT JOIN crawl_sources timetable_source
         ON timetable_source.id = revision."sourceId"
       LEFT JOIN crawl_images image ON image.id = revision."imageId"
       LEFT JOIN crawl_sources source ON source.id = image."sourceId"
       WHERE revision.status = 'verified'
         AND (
           revision."festivalSourceUrl" = ANY($1::text[])
           OR (
             timetable_source.kind = 'timetable'
             AND timetable_source.enabled = true
             AND timetable_source."parserConfig"->>'festivalSourceUrl' =
               revision."festivalSourceUrl"
             AND EXISTS (
               SELECT 1 FROM crawl_sources official_source
               WHERE official_source.kind = 'discovery'
                 AND official_source.enabled = true
                 AND official_source.url = revision."festivalSourceUrl"
                 AND official_source."parserConfig"->>'festivalSourceUrl' =
                   ANY($1::text[])
             )
           )
         )
       ORDER BY revision."sourceId", revision."verifiedAt" DESC,
         revision."createdAt" DESC, revision.id DESC`,
      [entry.sourceUrls],
    );
    const artistImages = new Map<string, Set<string>>();
    const primaryArtistImages = new Map<string, Set<string>>();
    const addArtistImage = (
      imagesByName: Map<string, Set<string>>,
      name: string,
      imageUrl: string,
    ) => {
      for (const key of artistNameKeys(name)) {
        const images = imagesByName.get(key) ?? new Set<string>();
        images.add(imageUrl);
        imagesByName.set(key, images);
      }
    };
    for (const artist of entry.artists ?? []) {
      if (artist.imageUrl)
        addArtistImage(primaryArtistImages, artist.name, artist.imageUrl);
    }
    for (const [key, imageId] of profileImages) {
      const [festivalSourceUrl, artistName] = key.split('\u0000');
      if (!entry.sourceUrls.includes(festivalSourceUrl)) continue;
      const imageUrl = `/api/v1/festivals/images/${imageId}.webp`;
      addArtistImage(artistImages, artistName, imageUrl);
      if (festivalSourceUrl === entry.sourceUrl)
        addArtistImage(primaryArtistImages, artistName, imageUrl);
    }
    const artistImage = (name: string) =>
      artistImageForName(name, primaryArtistImages) ??
      artistImageForName(name, artistImages);
    const timetable = (revisions ?? []).flatMap((revision) =>
      revision.sets.map((set, index) => ({
        id: `${revision.id}-${index}`,
        artist: set.artist,
        date: set.date,
        stageName: set.stageName,
        startsAt: set.startsAt,
        endsAt: set.endsAt,
        imageUrl: artistImage(set.artist),
        sourceUrl: revision.sourceUrl,
        sourceImageUrl: revision.sourceImageId
          ? `/api/v1/festivals/images/${revision.sourceImageId}.webp`
          : null,
        verifiedAt: revision.verifiedAt,
      })),
    );
    timetable.sort(
      (a, b) =>
        Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
        a.date.localeCompare(b.date) ||
        normalizeArtistName(a.stageName).localeCompare(
          normalizeArtistName(b.stageName),
        ) ||
        artistNameKeys(a.artist)[0].localeCompare(
          artistNameKeys(b.artist)[0],
        ) ||
        new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime() ||
        a.id.localeCompare(b.id),
    );
    const seenSets = new Set<string>();
    const uniqueTimetable = timetable.filter((set) => {
      const key = JSON.stringify([
        set.date,
        normalizeArtistName(set.stageName),
        Number.isNaN(Date.parse(set.startsAt))
          ? set.startsAt
          : Date.parse(set.startsAt),
        artistNameKeys(set.artist)[0],
      ]);
      if (seenSets.has(key)) return false;
      seenSets.add(key);
      return true;
    });
    const artists = new Map(
      (entry.artists ?? []).map((artist) => [
        artist.name,
        {
          imageUrl: artistImage(artist.name),
          ...(artist.profileUrl ? { profileUrl: artist.profileUrl } : {}),
          ...(artist.dates ? { dates: artist.dates } : {}),
        },
      ]),
    );
    for (const set of uniqueTimetable) {
      if (!artists.has(set.artist))
        artists.set(set.artist, { imageUrl: set.imageUrl });
    }
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
      artists: [...artists].map(([name, details]) => ({ name, ...details })),
      timetable: uniqueTimetable,
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
      etag: publicPackEtag(pack.packVersion as number),
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
