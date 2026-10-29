export type VenuePoint = {
  latitude: number;
  longitude: number;
  label: string;
};

export type VerifiedVenueLocation = VenuePoint & {
  source: { name: string; url: string; verifiedAt: string };
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function venuePoint(value: unknown): VenuePoint | null {
  if (!record(value)) return null;
  const { latitude, longitude, label } = value;
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof label !== 'string' ||
    !label.trim() ||
    [...label].length > 80
  )
    return null;
  return { latitude, longitude, label: label.trim() };
}

export function venueLabelMatches(label: string, venue: unknown): boolean {
  if (typeof venue !== 'string') return false;
  const normalize = (value: string) =>
    value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalize(label) === normalize(venue);
}

export function verifiedVenueLocation(
  value: unknown,
): VerifiedVenueLocation | null {
  const point = venuePoint(value);
  if (!point || !record(value)) return null;
  const source = value.source;
  if (!record(source)) return null;
  if (
    typeof source.name !== 'string' ||
    !source.name.trim() ||
    [...source.name].length > 80 ||
    typeof source.url !== 'string' ||
    typeof source.verifiedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      source.verifiedAt,
    ) ||
    Number.isNaN(Date.parse(source.verifiedAt))
  )
    return null;
  try {
    const url = new URL(source.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !url.hostname
    )
      return null;
  } catch {
    return null;
  }
  return {
    ...point,
    source: {
      name: source.name.trim(),
      url: source.url,
      verifiedAt: source.verifiedAt,
    },
  };
}
