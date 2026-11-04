import { DataSource } from 'typeorm';
import { artistNameKeys } from '../../common/artist-name';
import { CrawlTimetableSet } from '../admin/crawl/entity/crawl-timetable-revision.entity';
import { DiscoverySummary } from './crawl-catalog';

type Performance = { startsAt: string; date: string; stageName: string | null };
export type SearchArtist = { name: string; performances: Performance[] };
type PublishedItem = { id: string; published: Record<string, unknown> };

type LineupRow = {
  productUrl: string;
  artists: { name: string; date?: string }[];
};
type TimetableRow = {
  festivalSourceUrl: string;
  linkedSourceUrl: string | null;
  sets: CrawlTimetableSet[];
};

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function addArtist(
  artists: SearchArtist[],
  keys: Map<string, SearchArtist>,
  name: unknown,
  performance?: Performance,
): void {
  if (typeof name !== 'string' || !name.trim()) return;
  const normalized = artistNameKeys(name);
  if (!normalized.length) return;
  let artist = normalized.map((key) => keys.get(key)).find(Boolean);
  if (!artist) {
    artist = { name: name.trim(), performances: [] };
    artists.push(artist);
  }
  for (const key of normalized) keys.set(key, artist);
  if (
    performance &&
    !artist.performances.some(
      (item) =>
        item.startsAt === performance.startsAt &&
        item.date === performance.date &&
        item.stageName === performance.stageName,
    )
  ) {
    artist.performances.push(performance);
  }
}

function performanceOf(set: CrawlTimetableSet): Performance | undefined {
  if (
    typeof set.startsAt !== 'string' ||
    typeof set.date !== 'string' ||
    typeof set.stageName !== 'string'
  )
    return undefined;
  return {
    startsAt: set.startsAt,
    date: set.date,
    stageName: set.stageName,
  };
}

/** Add only names and schedule facts to the already paged public list. */
export async function projectSearchArtists(
  db: DataSource,
  ids: string[],
  published: PublishedItem[],
  discovered: DiscoverySummary[],
): Promise<Map<string, SearchArtist[]>> {
  const result = new Map<string, SearchArtist[]>();
  const keyMaps = new Map<string, Map<string, SearchArtist>>();
  for (const id of ids) {
    result.set(id, []);
    keyMaps.set(id, new Map());
  }
  const add = (id: string, name: unknown, performance?: Performance) => {
    const artists = result.get(id);
    const keys = keyMaps.get(id);
    if (artists && keys) addArtist(artists, keys, name, performance);
  };

  for (const { id, published: pack } of published) {
    if (!result.has(id)) continue;
    if (records(pack.sets).length === 0)
      for (const artist of records(pack.artists)) add(id, artist.name);
    const stageNames = new Map(
      records(pack.stages)
        .filter(
          (stage) =>
            typeof stage.id === 'string' && typeof stage.name === 'string',
        )
        .map((stage) => [stage.id as string, stage.name as string]),
    );
    for (const set of records(pack.sets)) {
      const startsAt = set.startsAt;
      const date =
        typeof startsAt === 'string' && !Number.isNaN(Date.parse(startsAt))
          ? new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Seoul',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date(startsAt))
          : null;
      add(
        id,
        set.artist,
        date && typeof startsAt === 'string'
          ? {
              startsAt,
              date,
              stageName:
                typeof set.stageId === 'string'
                  ? (stageNames.get(set.stageId) ?? null)
                  : null,
            }
          : undefined,
      );
    }
  }

  const entries = discovered.filter((entry) => result.has(entry.id));
  for (const entry of entries)
    for (const artist of entry.artists ?? []) add(entry.id, artist.name);
  const sourceUrls = [...new Set(entries.flatMap((entry) => entry.sourceUrls))];
  const products = sourceUrls.filter((url) =>
    /^https:\/\/world\.nol\.com\/en\/ticket\/products\/\d+$/.test(url),
  );
  const lineups = products.length
    ? await db.query<LineupRow[]>(
        `SELECT revision."productUrl", revision.artists
         FROM crawl_lineup_revisions revision
         JOIN crawl_sources lineup_source ON lineup_source.id = revision."sourceId"
         WHERE revision.status = 'approved'
           AND revision."productUrl" = ANY($1::text[])
           AND lineup_source.url = revision."productUrl"
           AND lineup_source.kind = 'discovery'
           AND lineup_source.parser = 'ticket-list'
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
      )
    : [];
  for (const entry of entries)
    for (const lineup of lineups)
      if (entry.sourceUrls.includes(lineup.productUrl))
        for (const artist of lineup.artists ?? []) add(entry.id, artist.name);

  const timetables = sourceUrls.length
    ? await db.query<TimetableRow[]>(
        `SELECT DISTINCT ON (revision."sourceId")
           revision."festivalSourceUrl",
           CASE WHEN timetable_source.kind = 'timetable'
             AND timetable_source.enabled = true
             AND timetable_source."parserConfig"->>'festivalSourceUrl' = revision."festivalSourceUrl"
             THEN (
               SELECT official_source."parserConfig"->>'festivalSourceUrl'
               FROM crawl_sources official_source
               WHERE official_source.kind = 'discovery'
                 AND official_source.enabled = true
                 AND official_source.url = revision."festivalSourceUrl"
                 AND official_source."parserConfig"->>'festivalSourceUrl' = ANY($1::text[])
               LIMIT 1
             ) ELSE NULL END AS "linkedSourceUrl",
           revision.sets
         FROM crawl_timetable_revisions revision
         LEFT JOIN crawl_sources timetable_source ON timetable_source.id = revision."sourceId"
         WHERE revision.status = 'verified'
           AND (revision."festivalSourceUrl" = ANY($1::text[])
             OR (timetable_source.kind = 'timetable'
               AND timetable_source.enabled = true
               AND timetable_source."parserConfig"->>'festivalSourceUrl' = revision."festivalSourceUrl"
               AND EXISTS (
                 SELECT 1 FROM crawl_sources official_source
                 WHERE official_source.kind = 'discovery'
                   AND official_source.enabled = true
                   AND official_source.url = revision."festivalSourceUrl"
                   AND official_source."parserConfig"->>'festivalSourceUrl' = ANY($1::text[])
               )))
         ORDER BY revision."sourceId", revision."verifiedAt" DESC,
           revision."createdAt" DESC, revision.id DESC`,
        [sourceUrls],
      )
    : [];
  for (const entry of entries)
    for (const revision of timetables)
      if (
        entry.sourceUrls.includes(revision.festivalSourceUrl) ||
        (revision.linkedSourceUrl &&
          entry.sourceUrls.includes(revision.linkedSourceUrl))
      )
        for (const set of revision.sets ?? [])
          add(entry.id, set.artist, performanceOf(set));
  return result;
}
