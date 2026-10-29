import { checkedUrl } from './crawl-fetch';

export const DRDR_PROFILE_SEED = 'drdr-official-profile';

interface DrdrProfile {
  title: string;
  artistName: string;
  festivalSourceUrl: string;
}

// These post identities are verified against DRDR's public artist catalog.
// Portrait URLs are always read from the current published post.
export const DRDR_PROFILES: Readonly<Record<string, DrdrProfile>> = {
  'https://drdr.ac/wordpress/wp-json/wp/v2/posts/50': {
    title: 'HYUKOH///혁오',
    artistName: '혁오',
    festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
  },
  'https://drdr.ac/wordpress/wp-json/wp/v2/posts/1475': {
    title: 'OYSTERS///오이스터즈',
    artistName: 'OYSTERS',
    festivalSourceUrl: 'https://mintpaper.co.kr/festivals/178',
  },
  'https://drdr.ac/wordpress/wp-json/wp/v2/posts/1539': {
    title: 'The Shepherd Bois///양치기소년단',
    artistName: 'The Shepherd Bois',
    festivalSourceUrl: 'https://www.wonderli.vet/lineup',
  },
};

const IMAGE_PATH =
  /^\/wordpress\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/?#]+\.jpe?g$/i;

const sqlLiteral = (value: string) => "'" + value.replace(/'/g, "''") + "'";

export const DRDR_PUBLIC_IMAGE_SQL = Object.entries(DRDR_PROFILES)
  .map(
    ([pageUrl, profile]) =>
      `(source.url = ${sqlLiteral(pageUrl)} AND ` +
      `source."parserConfig"->>'festivalSourceUrl' = ${sqlLiteral(profile.festivalSourceUrl)} AND ` +
      `source."parserConfig"->>'artistName' = ${sqlLiteral(profile.artistName)} AND ` +
      `image."originUrl" ~* '^https://drdr[.]ac/wordpress/wp-content/uploads/[0-9]{4}/[0-9]{2}/[^/?#]+[.]jpe?g$')`,
  )
  .join('\n      OR ');

export function drdrProfileFor(
  pageUrl: string,
  config: Record<string, string>,
): DrdrProfile | null {
  let normalized: string;
  try {
    normalized = checkedUrl(pageUrl).toString();
  } catch {
    return null;
  }
  const profile = DRDR_PROFILES[normalized];
  return profile &&
    config.seed === DRDR_PROFILE_SEED &&
    config.festivalSourceUrl === profile.festivalSourceUrl &&
    config.artistName === profile.artistName
    ? profile
    : null;
}

export function drdrProfileImageUrl(
  body: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  const profile = drdrProfileFor(pageUrl, config);
  if (!profile || Buffer.byteLength(body, 'utf8') > 2_000_000) return null;
  let post: unknown;
  try {
    post = JSON.parse(body);
  } catch {
    return null;
  }
  if (!post || typeof post !== 'object') return null;
  const value = post as Record<string, unknown>;
  const postId = Number(new URL(pageUrl).pathname.split('/').at(-1));
  if (
    value.id !== postId ||
    value.status !== 'publish' ||
    !Array.isArray(value.categories) ||
    !value.categories.includes(11) ||
    (value.title as Record<string, unknown> | undefined)?.rendered !==
      profile.title
  )
    return null;
  const html = (value.content as Record<string, unknown> | undefined)?.rendered;
  if (typeof html !== 'string' || html.length > 1_000_000) return null;
  const section =
    /<p>\s*<strong>\s*MUSICIAN\s*<\/strong>\s*<\/p>\s*<p>\s*(<img\b[^>]*>)\s*<\/p>/i.exec(
      html,
    );
  const imageTag = section?.[1];
  const image = imageTag
    ? /(?:^|\s)src\s*=\s*"([^"]+)"/i.exec(imageTag)?.[1]
    : null;
  if (!image) return null;
  try {
    const url = checkedUrl(image);
    return url.hostname === 'drdr.ac' &&
      IMAGE_PATH.test(url.pathname) &&
      !url.search &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}
