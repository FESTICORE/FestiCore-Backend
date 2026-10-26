import { checkedUrl } from './crawl-fetch';
import { poclanosProfileImageCandidates } from './wonderlivet-profile';

export const FESTIVAL_PROFILE_SEED = 'festival-official-profile';

interface Profile {
  artistName: string;
  festivalSourceUrl: string;
  pageName: string;
  rule: 'poclanos' | 'levistance' | 'hisplan';
  imageHost: string;
  imagePath: RegExp;
}

// The Seoul lineup spelling is retained as the saved artist identity. Poclanos
// publishes the reviewed official profile under the distinct H1 spelling.
export const FESTIVAL_PROFILES: Readonly<Record<string, Profile>> = {
  'https://poclanos.com/artist/%EC%B6%94%EB%8B%A4%ED%98%9C%EC%B0%A8%EC%A7%80%EC%8A%A4/':
    {
      artistName: '추다해차지스',
      festivalSourceUrl:
        'https://festival.seoul.go.kr/festival/main/festivalView.do?festacode=848',
      pageName: '추다혜차지스',
      rule: 'poclanos',
      imageHost: 'poclanos.com',
      imagePath:
        /^\/drmvsn\/wp-content\/uploads\/[0-9]{4}\/[0-9]{2}\/[^/?#]+[.](jpg|jpeg|png|webp)$/i,
    },
  'https://www.levistance.com/about': {
    artistName: '레비스탕스',
    festivalSourceUrl:
      'https://ticket.melon.com/performance/index.htm?prodId=213769',
    pageName: 'LEVISTANCE',
    rule: 'levistance',
    imageHost: 'images.squarespace-cdn.com',
    imagePath:
      /^\/content\/v1\/6752a80810127d336fce8328\/[0-9a-f-]{36}\/[^/?#]+[.](jpg|jpeg|png|webp)$/i,
  },
  'https://www.inhisplan.com/': {
    artistName: '히스플랜',
    festivalSourceUrl:
      'https://ticket.melon.com/performance/index.htm?prodId=213769',
    pageName: 'HISPLAN',
    rule: 'hisplan',
    imageHost: 'www.inhisplan.com',
    imagePath: /^\/assets\/photo\/promo\/[^/?#]+[.](jpg|jpeg|png|webp)$/i,
  },
};

const sqlLiteral = (value: string) => "'" + value.replace(/'/g, "''") + "'";

export const FESTIVAL_PUBLIC_IMAGE_SQL = Object.entries(FESTIVAL_PROFILES)
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

export function festivalProfileFor(
  pageUrl: string,
  config: Record<string, string>,
): Profile | null {
  let normalized: string;
  try {
    normalized = checkedUrl(pageUrl).toString();
  } catch {
    return null;
  }
  const profile = FESTIVAL_PROFILES[normalized];
  return profile &&
    config.seed === FESTIVAL_PROFILE_SEED &&
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

function levistanceImageCandidates(html: string): string[] {
  if (!html.includes('<title>About &mdash; LEVISTANCE</title>')) return [];
  const sections = [
    ...html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi),
  ].filter(
    (match) =>
      attr(match[1], 'data-test') === 'page-section' &&
      /<strong>WE ARE LEVISTANCE\.<\/strong>/.test(match[2]) &&
      /<strong>안녕하세요 레비스탕스입니다\.<\/strong>/.test(match[2]),
  );
  if (sections.length !== 1) return [];
  return [
    ...new Set(
      [...sections[0][2].matchAll(/<img\b[^>]*>/gi)]
        .map((match) => match[0])
        .filter((tag) => /\sdata-sqsp-image-block-image(?:\s|>)/i.test(tag))
        .map((tag) => attr(tag, 'src'))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function hisplanImageCandidates(html: string): string[] {
  if (
    !html.includes('<title>HISPLAN | 히스플랜</title>') ||
    !html.includes('히스플랜은 노래로 하나님을 노래하는 사람들.')
  )
    return [];
  const banners = [
    ...html.matchAll(/<div\b([^>]*)>\s*(<img\b[^>]*>)/gi),
  ].filter((match) =>
    attr(match[1], 'class')?.split(/\s+/).includes('promo-photo-banner'),
  );
  return banners
    .filter((match) => attr(match[2], 'alt') === '히스플랜 팀')
    .map((match) => attr(match[2], 'src'))
    .filter((value): value is string => Boolean(value));
}

export function festivalProfileImageUrl(
  html: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  const profile = festivalProfileFor(pageUrl, config);
  if (!profile || Buffer.byteLength(html, 'utf8') > 2_000_000) return null;
  const candidates =
    profile.rule === 'poclanos'
      ? poclanosProfileImageCandidates(html, profile.pageName)
      : profile.rule === 'levistance'
        ? levistanceImageCandidates(html)
        : hisplanImageCandidates(html);
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
