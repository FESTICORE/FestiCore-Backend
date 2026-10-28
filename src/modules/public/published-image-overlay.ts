import { createHash } from 'crypto';
import { normalizeArtistName } from '../../common/artist-name';
import {
  SOHYANG_COMMONS_CREDIT,
  SOHYANG_COMMONS_SEED,
} from '../admin/crawl/service/sohyang-commons-profile';
import { PUBLIC_PACK_PROJECTION_VERSION } from '../redis/service/cache.service';

type Document = Record<string, unknown>;

export interface PublicImageRow {
  id: string;
  seed: string | null;
  artistName: string | null;
  reviewFestivalId: string | null;
  festivalSourceUrl: string | null;
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  sourceUrl: string | null;
  rightsRunId: string | null;
}

const imagePath = /^\/api\/v1\/festivals\/images\/([0-9a-f-]{36})\.webp$/;

export function storedImageId(value: unknown): string | null {
  return typeof value === 'string'
    ? (imagePath.exec(value)?.[1] ?? null)
    : null;
}

export function overlayPublishedImages(
  pack: Document,
  festivalId: string,
  rows: PublicImageRow[],
): { document: Document; etag: string } {
  const visible = new Map(rows.map((row) => [row.id, row]));
  const reviewedByName = new Map<string, PublicImageRow[]>();
  for (const row of rows) {
    if (row.reviewFestivalId !== festivalId || !row.artistName) continue;
    const key = normalizeArtistName(row.artistName);
    reviewedByName.set(key, [...(reviewedByName.get(key) ?? []), row]);
  }
  const imageFor = (artistName: unknown, stored: unknown) => {
    const previousId = storedImageId(stored);
    const previous = previousId ? visible.get(previousId) : null;
    if (previous) {
      if (previous.seed !== 'commons-approved-profile') return previous;
      if (
        previous.reviewFestivalId === festivalId &&
        typeof artistName === 'string' &&
        previous.artistName &&
        normalizeArtistName(previous.artistName) ===
          normalizeArtistName(artistName)
      )
        return previous;
    }
    if (typeof artistName !== 'string') return null;
    const candidates =
      reviewedByName.get(normalizeArtistName(artistName)) ?? [];
    return candidates.length === 1 ? candidates[0] : null;
  };
  const creditFor = (row: PublicImageRow | null) => {
    if (!row) return undefined;
    if (row.seed === SOHYANG_COMMONS_SEED) return SOHYANG_COMMONS_CREDIT;
    if (
      row.seed !== 'commons-approved-profile' ||
      !row.author ||
      !row.license ||
      !row.licenseUrl ||
      !row.sourceUrl
    )
      return undefined;
    return {
      author: row.author,
      license: row.license,
      licenseUrl: row.licenseUrl,
      sourceUrl: row.sourceUrl,
      changes: 'WebP 변환',
    };
  };
  const projectArtist = (value: unknown, nameField: 'name' | 'artist') => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return value;
    const item = value as Document;
    const row = imageFor(item[nameField], item.imageUrl);
    const imageUrl = row ? `/api/v1/festivals/images/${row.id}.webp` : null;
    const imageCredit = creditFor(row);
    const rest = { ...item };
    delete rest.imageCredit;
    return { ...rest, imageUrl, ...(imageCredit ? { imageCredit } : {}) };
  };
  const document: Document = {
    ...pack,
    artists: Array.isArray(pack.artists)
      ? pack.artists.map((artist) => projectArtist(artist, 'name'))
      : pack.artists,
    sets: Array.isArray(pack.sets)
      ? pack.sets.map((set) => projectArtist(set, 'artist'))
      : pack.sets,
    timetable: Array.isArray(pack.timetable)
      ? pack.timetable.map((set) => projectArtist(set, 'artist'))
      : pack.timetable,
  };
  const thumbId = storedImageId(pack.thumbUrl);
  if (thumbId && !visible.has(thumbId)) document.thumbUrl = null;
  const fingerprint = rows
    .map((row) => `${row.id}:${row.rightsRunId ?? ''}`)
    .sort()
    .join('|');
  const version = Number(pack.packVersion);
  const etag = fingerprint
    ? `"${createHash('sha256').update(`${version}:${fingerprint}`).digest('hex')}"`
    : `"cdm${PUBLIC_PACK_PROJECTION_VERSION}-v${version}"`;
  return { document, etag };
}
