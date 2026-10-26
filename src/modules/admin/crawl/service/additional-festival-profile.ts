import { checkedUrl } from './crawl-fetch';
import { poclanosProfileImageCandidates } from './wonderlivet-profile';

export const ADDITIONAL_FESTIVAL_PROFILE_SEED =
  'additional-festival-official-profile';
export const SEOUL_MUSIC_SOURCE_URL = 'https://ticket.yes24.com/Perf/60368';

interface Profile {
  artistName: string;
  festivalSourceUrl: string;
  rule: 'antenna' | 'poclanos';
  imageHost: string;
  imagePath: RegExp;
}

// Only page and artist identities are registered. Image URLs are read from the
// current official HTML on every crawl, then saved by the normal image store.
export const ADDITIONAL_FESTIVAL_PROFILES: Readonly<Record<string, Profile>> = {
  'https://antenna.co.kr/KwonJinAh': {
    artistName: '권진아',
    festivalSourceUrl: SEOUL_MUSIC_SOURCE_URL,
    rule: 'antenna',
    imageHost: 'cdn.imweb.me',
    imagePath: /^\/thumbnail\/[0-9]{8}\/[0-9a-f]+[.]jpe?g$/i,
  },
  'https://poclanos.com/artist/%EC%98%A5%EC%83%81%EB%8B%AC%EB%B9%9B/': {
    artistName: '옥상달빛',
    festivalSourceUrl: SEOUL_MUSIC_SOURCE_URL,
    rule: 'poclanos',
    imageHost: 'poclanos.com',
    imagePath:
      /^\/drmvsn\/wp-content\/uploads\/[0-9]{4}\/[0-9]{2}\/[^/?#]+[.]jpe?g$/i,
  },
};

const sqlLiteral = (value: string) => "'" + value.replace(/'/g, "''") + "'";

export const ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL = Object.entries(
  ADDITIONAL_FESTIVAL_PROFILES,
)
  .map(([pageUrl, profile]) => {
    const origin =
      '^https://' +
      profile.imageHost.replace(/\./g, '[.]') +
      profile.imagePath.source.slice(1, -1).replace(/\\\//g, '/') +
      '$';
    return (
      '(source.url = ' +
      sqlLiteral(pageUrl) +
      ' AND source."parserConfig"->>\'festivalSourceUrl\' = ' +
      sqlLiteral(profile.festivalSourceUrl) +
      ' AND source."parserConfig"->>\'artistName\' = ' +
      sqlLiteral(profile.artistName) +
      ' AND image."originUrl" ~* ' +
      sqlLiteral(origin) +
      ')'
    );
  })
  .join('\n      OR ');

export function additionalFestivalProfileFor(
  pageUrl: string,
  config: Record<string, string>,
): Profile | null {
  let normalized: string;
  try {
    normalized = checkedUrl(pageUrl).toString();
  } catch {
    return null;
  }
  const profile = ADDITIONAL_FESTIVAL_PROFILES[normalized];
  return profile &&
    config.seed === ADDITIONAL_FESTIVAL_PROFILE_SEED &&
    config.festivalSourceUrl === profile.festivalSourceUrl &&
    config.artistName === profile.artistName
    ? profile
    : null;
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  ).exec(tag);
  return (match?.[1] ?? match?.[2] ?? null)?.replace(/&amp;/gi, '&') ?? null;
}

function antennaImageCandidates(html: string, pageUrl: string): string[] {
  const pageClaim = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attr(tag, 'property') === 'og:url')
    .map((tag) => attr(tag, 'content'));
  if (
    pageClaim.length !== 1 ||
    pageClaim[0] !== pageUrl ||
    [...html.matchAll(/<h3\b[^>]*>권진아(?:<[^>]*>)*<\/h3>/gi)].length !== 1 ||
    !/<h6\b[^>]*>Kwon Jin Ah<\/h6>/i.test(html)
  )
    return [];
  return [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attr(tag, 'class')?.split(/\s+/).includes('org_image'))
    .map((tag) => attr(tag, 'src'))
    .filter((value): value is string => Boolean(value));
}

export function additionalFestivalProfileImageUrl(
  html: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  const profile = additionalFestivalProfileFor(pageUrl, config);
  if (!profile || Buffer.byteLength(html, 'utf8') > 2_000_000) return null;
  const candidates =
    profile.rule === 'antenna'
      ? antennaImageCandidates(html, pageUrl)
      : poclanosProfileImageCandidates(html, '옥상달빛');
  if (candidates.length !== 1) return null;
  try {
    const image = checkedUrl(new URL(candidates[0], pageUrl).toString());
    return image.hostname === profile.imageHost &&
      profile.imagePath.test(image.pathname) &&
      !image.search &&
      !image.hash
      ? image
      : null;
  } catch {
    return null;
  }
}
