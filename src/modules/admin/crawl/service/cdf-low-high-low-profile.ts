import { checkedUrl } from './crawl-fetch';
import { CDF_FESTIVAL_URL } from './cdf-profile';

export const CDF_LOW_HIGH_LOW_PROFILE_SEED = 'cdf-low-high-low-profile';
export const CDF_LOW_HIGH_LOW_PROFILE_URL =
  'https://ticket.melon.com/artist/index.htm?artistId=2754370';

const ARTIST_NAME = '로우하이로우';
const FESTIVAL_NAME = 'LOW HIGH LOW';
const IMAGE_PATH =
  /^\/cm2\/artistcrop\/images\/027\/54\/370\/2754370_[0-9]{14}[.]jpe?g$/i;

export const CDF_LOW_HIGH_LOW_PUBLIC_IMAGE_SQL = `(
  source.url = '${CDF_LOW_HIGH_LOW_PROFILE_URL}'
  AND source."parserConfig"->>'festivalSourceUrl' = '${CDF_FESTIVAL_URL}'
  AND source."parserConfig"->>'artistName' = '${ARTIST_NAME}'
  AND source."parserConfig"->>'artistAlias' = '${FESTIVAL_NAME}'
  AND image."originUrl" ~* '^https://cdnimg[.]melon[.]co[.]kr/cm2/artistcrop/images/027/54/370/2754370_[0-9]{14}[.]jpe?g$'
)`;

export function cdfLowHighLowProfileFor(
  pageUrl: string,
  config: Record<string, string>,
): boolean {
  try {
    return (
      checkedUrl(pageUrl).toString() === CDF_LOW_HIGH_LOW_PROFILE_URL &&
      config.seed === CDF_LOW_HIGH_LOW_PROFILE_SEED &&
      config.festivalSourceUrl === CDF_FESTIVAL_URL &&
      config.artistName === ARTIST_NAME &&
      config.artistAlias === FESTIVAL_NAME
    );
  } catch {
    return false;
  }
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
}

export function cdfLowHighLowProfileImageUrl(
  html: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  if (
    !cdfLowHighLowProfileFor(pageUrl, config) ||
    Buffer.byteLength(html, 'utf8') > 2_000_000
  )
    return null;
  const profiles = [
    ...html.matchAll(
      /<div\b[^>]*class=["'][^"']*\bwrap_artist_profile\b[^"']*["'][^>]*>([\s\S]*?)<!--\s*\/\/wrap_artist_profile\s*-->/gi,
    ),
  ];
  if (profiles.length !== 1) return null;
  const titles = [
    ...profiles[0][1].matchAll(
      /<p\b[^>]*class=["'][^"']*\btit_artist\b[^"']*["'][^>]*>([^<]*)<\/p>/gi,
    ),
  ];
  if (titles.length !== 1 || titles[0][1].trim() !== ARTIST_NAME) return null;
  const thumbnails = [
    ...profiles[0][1].matchAll(
      /<div\b[^>]*class=["'][^"']*\bbox_artist_thumb\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    ),
  ];
  if (thumbnails.length !== 1) return null;
  const imageTags = thumbnails[0][1].match(/<img\b[^>]*>/gi) ?? [];
  if (imageTags.length !== 1 || attribute(imageTags[0], 'alt') !== ARTIST_NAME)
    return null;
  const src = attribute(imageTags[0], 'src');
  if (!src) return null;
  try {
    const image = checkedUrl(new URL(src, pageUrl).toString());
    return image.hostname === 'cdnimg.melon.co.kr' &&
      IMAGE_PATH.test(image.pathname) &&
      !image.search &&
      !image.hash
      ? image
      : null;
  } catch {
    return null;
  }
}
