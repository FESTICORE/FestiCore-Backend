import { checkedUrl } from './crawl-fetch';

export const ONEWAY_CHANNEL_SEED = 'oneway-official-channel';
export const ONEWAY_FESTIVAL_URL =
  'https://ticket.melon.com/performance/index.htm?prodId=213769';

interface Channel {
  artistName: string;
  title: string;
  channelId: string;
}

// These handles and channel IDs identify the artist-owned pages. The current
// photo URL is extracted from the page on each crawl, never seeded as data.
export const ONEWAY_CHANNELS: Readonly<Record<string, Channel>> = {
  'https://www.youtube.com/@sohyang.official': {
    artistName: '소향',
    title: 'Sohyang',
    channelId: 'UCHEz2Bsd3REidWKYOxA8XrQ',
  },
  'https://www.youtube.com/@moonlightv': {
    artistName: '달빛마을',
    title: '달빛마을 (Moonlight Village)',
    channelId: 'UCjWYW0HlOAV3U1sjPPsT7dA',
  },
};

const IMAGE_PATH = /^\/[A-Za-z0-9_-]{20,200}=s900-c-k-c0x00ffffff-no-rj$/;

export const ONEWAY_CHANNEL_PUBLIC_IMAGE_SQL = Object.entries(ONEWAY_CHANNELS)
  .map(
    ([url, channel]) =>
      `(source.url = '${url}' AND source."parserConfig"->>'festivalSourceUrl' = '${ONEWAY_FESTIVAL_URL}'` +
      ` AND source."parserConfig"->>'artistName' = '${channel.artistName}'` +
      ` AND image."originUrl" ~ '^https://yt3[.]googleusercontent[.]com/[A-Za-z0-9_-]{20,200}=s900-c-k-c0x00ffffff-no-rj$')`,
  )
  .join('\n      OR ');

export function onewayChannelFor(
  pageUrl: string,
  config: Record<string, string>,
): Channel | null {
  try {
    const channel = ONEWAY_CHANNELS[checkedUrl(pageUrl).toString()];
    return channel &&
      config.seed === ONEWAY_CHANNEL_SEED &&
      config.festivalSourceUrl === ONEWAY_FESTIVAL_URL &&
      config.artistName === channel.artistName
      ? channel
      : null;
  } catch {
    return null;
  }
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  ).exec(tag);
  return (match?.[1] ?? match?.[2] ?? null)?.replace(/&amp;/gi, '&') ?? null;
}

function uniqueMeta(
  html: string,
  marker: 'property' | 'rel',
  name: string,
  value: 'content' | 'href',
): string | null {
  const tagName = marker === 'rel' ? 'link' : 'meta';
  const entries = [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))]
    .map((match) => match[0])
    .filter((tag) => attribute(tag, marker) === name)
    .map((tag) => attribute(tag, value));
  return entries.length === 1 ? entries[0] : null;
}

export function onewayChannelImageUrl(
  html: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  const channel = onewayChannelFor(pageUrl, config);
  if (!channel || Buffer.byteLength(html, 'utf8') > 2_000_000) return null;
  const canonical = `https://www.youtube.com/channel/${channel.channelId}`;
  if (
    uniqueMeta(html, 'property', 'og:title', 'content') !== channel.title ||
    uniqueMeta(html, 'property', 'og:url', 'content') !== canonical ||
    uniqueMeta(html, 'rel', 'canonical', 'href') !== canonical
  )
    return null;
  const raw = uniqueMeta(html, 'property', 'og:image', 'content');
  if (!raw) return null;
  try {
    const image = checkedUrl(raw);
    return image.hostname === 'yt3.googleusercontent.com' &&
      IMAGE_PATH.test(image.pathname) &&
      !image.search &&
      !image.hash
      ? image
      : null;
  } catch {
    return null;
  }
}
