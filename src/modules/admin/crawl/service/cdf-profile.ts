import { checkedUrl } from './crawl-fetch';

export const CDF_FESTIVAL_URL = 'https://mintpaper.co.kr/festivals/178';
export const CDF_PROFILE_SEED = 'cdf-official-profile';

type Rule =
  | 'kardi'
  | 'onewe'
  | 'axmxp'
  | 'ftisland'
  | 'solutions'
  | 'idiotape'
  | 'poclanos';

interface Profile {
  artistName: string;
  officialHandle: string;
  rule: Rule;
  imageHost: string;
  imagePath: RegExp;
  query?: string;
}

export const CDF_PROFILES: Readonly<Record<string, Profile>> = {
  'https://www.bandkardi.com/profile': {
    artistName: 'KARDI',
    officialHandle: 'bandkardi_',
    rule: 'kardi',
    imageHost: 'www.bandkardi.com',
    imagePath: /^\/_next\/static\/media\/[^/]+\.webp$/,
  },
  'https://oneweofficial.jp/profile': {
    artistName: 'ONEWE(원위)',
    officialHandle: 'official_onewe',
    rule: 'onewe',
    imageHost: 'storage.googleapis.com',
    imagePath: /^\/image\.fanicon\.net\/cms\/[0-9]+_[a-z0-9]+\.jpe?g$/i,
  },
  'https://www.fncent.com/c/2/9': {
    artistName: 'AxMxP',
    officialHandle: 'axmxp_official',
    rule: 'axmxp',
    imageHost: 'fncent.com',
    imagePath: /^\/files\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]+\.jpe?g$/i,
  },
  'https://m.fncent.com/FTISLAND/b/introduce/1281': {
    artistName: 'FTISLAND',
    officialHandle: 'ftisland',
    rule: 'ftisland',
    imageHost: 'www.fncent.com',
    imagePath: /^\/files\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]+\.jpe?g$/i,
  },
  'https://mpmgmusic.com/thesolutions': {
    artistName: 'THE SOLUTIONS',
    officialHandle: 'the_solutions',
    rule: 'solutions',
    imageHost: 'contents.sixshop.com',
    imagePath:
      /^\/thumbnails\/uploadedFiles\/\d+\/default\/image_[a-z0-9_]+\.jpe?g$/i,
  },
  'https://ebbmusic.eu/artists/idiotape/': {
    artistName: 'IDIOTAPE',
    officialHandle: 'idiotapeofficial',
    rule: 'idiotape',
    imageHost: 'ebbmusic.eu',
    imagePath: /^\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/]+\.jpe?g$/i,
  },
  'https://poclanos.com/artist/%ED%8F%AC%EC%A0%B8%EA%B5%B0%EB%8B%A8/': {
    artistName: '포져군단',
    officialHandle: 'poseridiott',
    rule: 'poclanos',
    imageHost: 'poclanos.com',
    imagePath: /^\/drmvsn\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/]+\.jpe?g$/i,
  },
  'https://poclanos.com/artist/%EA%B7%B9%EB%8F%99%EC%95%84%EC%8B%9C%EC%95%84%ED%83%80%EC%9D%B4%EA%B1%B0%EC%A6%88/':
    {
      artistName: '극동아시아타이거즈',
      officialHandle: 'far_east_asian_tigers',
      rule: 'poclanos',
      imageHost: 'poclanos.com',
      imagePath: /^\/drmvsn\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/]+\.jpe?g$/i,
    },
  'https://poclanos.com/artist/%EC%8B%A4%EB%A6%AC%EC%B9%B4%EA%B2%94/': {
    artistName: '실리카겔',
    officialHandle: 'silicagel.official',
    rule: 'poclanos',
    imageHost: 'poclanos.com',
    imagePath: /^\/drmvsn\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/]+\.jpe?g$/i,
  },
};

const sqlLiteral = (value: string) => "'" + value.replace(/'/g, "''") + "'";

// The public lookup and image endpoint use the same restrictive origin test.
export const CDF_PUBLIC_IMAGE_SQL = Object.entries(CDF_PROFILES)
  .map(([pageUrl, profile]) => {
    const path = profile.imagePath.source
      .slice(1, -1)
      .replace(/\\\//g, '/')
      .replace(/\[\^\/\]/g, '[^/?]')
      .replace(/\\d/g, '[0-9]');
    const host = profile.imageHost.replace(/\./g, '[.]');
    const query = profile.query === '?1' ? '[?]1' : '';
    const origin = '^https://' + host + path + query + '$';
    return (
      '(source.url = ' +
      sqlLiteral(pageUrl) +
      ' AND source."parserConfig"->>\'artistName\' = ' +
      sqlLiteral(profile.artistName) +
      ' AND source."parserConfig"->>\'officialHandle\' = ' +
      sqlLiteral(profile.officialHandle) +
      ' AND image."originUrl" ~* ' +
      sqlLiteral(origin) +
      ')'
    );
  })
  .join('\n      OR ');

export function cdfProfileFor(
  pageUrl: string,
  config: Record<string, string>,
): Profile | null {
  let normalized: string;
  try {
    normalized = checkedUrl(pageUrl).toString();
  } catch {
    return null;
  }
  const profile = CDF_PROFILES[normalized];
  return config.seed === CDF_PROFILE_SEED &&
    config.festivalSourceUrl === CDF_FESTIVAL_URL &&
    config.artistName === profile?.artistName &&
    config.officialHandle === profile?.officialHandle
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

function exactTagText(
  html: string,
  tag: string,
  requiredAttr: string,
  requiredValue: string,
  expected: string,
): boolean {
  const matches = [
    ...html.matchAll(
      new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi'),
    ),
  ]
    .filter((match) => {
      const value = attr(match[1], requiredAttr);
      return requiredAttr === 'class'
        ? value?.split(/\s+/).includes(requiredValue)
        : value === requiredValue;
    })
    .map((match) => match[2].replace(/<[^>]*>/g, '').trim());
  return matches.length === 1 && matches[0] === expected;
}

function imageAttributes(
  html: string,
  predicate: (tag: string) => boolean,
): string[] {
  return [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter(predicate)
    .flatMap((tag) => {
      const src = attr(tag, 'src');
      return src ? [src] : [];
    });
}

function profileImageCandidates(html: string, profile: Profile): string[] {
  switch (profile.rule) {
    case 'kardi': {
      if (!exactTagText(html, 'h1', 'id', 'profile-title', 'KARDI')) return [];
      const sections = [
        ...html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi),
      ].filter((match) => attr(match[1], 'aria-label') === 'KARDI members');
      return sections.flatMap((section) =>
        imageAttributes(
          section[2],
          (tag) => attr(tag, 'alt') === 'KARDI members',
        ),
      );
    }
    case 'onewe': {
      const groupName = profile.artistName.split('(')[0].trim();
      const titles = [...html.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)].map(
        (match) => match[1].trim(),
      );
      if (titles.length !== 1 || titles[0] !== `profile | ${groupName}`)
        return [];
      const lists = [
        ...html.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi),
      ].filter((match) =>
        attr(match[1], 'class')?.split(/\s+/).includes('members__list'),
      );
      if (lists.length !== 1) return [];
      const cards = [
        ...lists[0][2].matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi),
      ].filter((match) =>
        attr(match[1], 'class')?.split(/\s+/).includes('member'),
      );
      const group = cards.filter((card) => {
        const names = [...card[2].matchAll(/<div\b([^>]*)>\s*([^<]*)<\/div>/gi)]
          .filter((match) =>
            attr(match[1], 'class')?.split(/\s+/).includes('member__name'),
          )
          .map((match) => match[2].trim());
        return names.length === 1 && names[0] === groupName;
      });
      if (group.length !== 1) return [];
      const avatars = [
        ...group[0][2].matchAll(/<div\b([^>]*)>([\s\S]*?)<\/div>/gi),
      ].filter((match) =>
        attr(match[1], 'class')?.split(/\s+/).includes('member__avatar'),
      );
      return avatars.length === 1
        ? imageAttributes(avatars[0][2], () => true)
        : [];
    }
    case 'axmxp': {
      const titles = [
        ...html.matchAll(
          /<div\b[^>]*class=["'][^"']*\badd_tit\b[^"']*["'][^>]*>\s*AxMxP\s*<\/div>/gi,
        ),
      ];
      if (titles.length !== 1) return [];
      const cardStart = html.lastIndexOf('<li', titles[0].index);
      if (cardStart < 0) return [];
      const card = html.slice(cardStart, titles[0].index + titles[0][0].length);
      const picture =
        /<div\b[^>]*class=["'][^"']*\bpic\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
          card,
        )?.[1] ?? '';
      if (!/<a\b[^>]*href=["']\/AxMxP["']/i.test(picture)) return [];
      return imageAttributes(picture, () => true);
    }
    case 'ftisland': {
      if (!exactTagText(html, 'h3', 'class', 'mini_title', 'FTISLAND'))
        return [];
      const picture =
        /<div\b[^>]*id=["']mini_visu["'][^>]*>([\s\S]*?)<\/div>/i.exec(
          html,
        )?.[1] ?? '';
      return imageAttributes(picture, () => true);
    }
    case 'solutions': {
      if (
        !/<title\b[^>]*>\s*THE SOLUTIONS\s*\|\s*MPMG MUSIC[^<]*<\/title>/i.test(
          html,
        )
      )
        return [];
      const hero =
        /<div\b[^>]*class=["'][^"']*\bheroWrapper\b[^"']*\bdesktop\b[^"']*["'][^>]*>[\s\S]{0,1000}?<div\b([^>]*class=["'][^"']*\bheroImgDiv\b[^"']*["'][^>]*)>/i.exec(
          html,
        )?.[1];
      if (!hero) return [];
      const style = attr(hero, 'style') ?? '';
      return [
        ...style.matchAll(
          /background-image\s*:\s*url\(\s*['"]?([^)'"]+)['"]?\s*\)/gi,
        ),
      ].map((match) => match[1]);
    }
    case 'idiotape': {
      const title = [...html.matchAll(/<meta\b[^>]*>/gi)]
        .map((match) => match[0])
        .filter((tag) => attr(tag, 'property') === 'og:title')
        .map((tag) => attr(tag, 'content'));
      if (title.length !== 1 || title[0] !== 'Idiotape - EBB Music') return [];
      if (
        !/<a\b[^>]*href=["']https:\/\/www\.instagram\.com\/idiotapeofficial\/["'][^>]*class=["'][^"']*\bsocial-link\b/i.test(
          html,
        )
      )
        return [];
      const ogImages = [...html.matchAll(/<meta\b[^>]*>/gi)]
        .map((match) => match[0])
        .filter((tag) => attr(tag, 'property') === 'og:image')
        .flatMap((tag) => {
          const content = attr(tag, 'content');
          return content ? [content] : [];
        });
      const portraits = imageAttributes(
        html,
        (tag) =>
          attr(tag, 'class')?.split(/\s+/).includes('wp-post-image') ?? false,
      );
      return ogImages.length === 1 &&
        portraits.length === 1 &&
        ogImages[0] === portraits[0]
        ? portraits
        : [];
    }
    case 'poclanos': {
      const main =
        /<main\b[^>]*class=["'][^"']*\bartist-single\b[^"']*["'][^>]*>([\s\S]*?)<\/main>/i.exec(
          html,
        )?.[1] ?? '';
      if (!exactTagText(main, 'h1', 'class', 'page-title', profile.artistName))
        return [];
      const wrapper =
        /<span\b[^>]*class=["'][^"']*\bartist-img-wrap\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
          main,
        )?.[1] ?? '';
      return imageAttributes(wrapper, () => true);
    }
  }
}

export function cdfProfileImageUrl(
  html: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  const profile = cdfProfileFor(pageUrl, config);
  if (!profile || Buffer.byteLength(html, 'utf8') > 2_000_000) return null;
  const candidates = profileImageCandidates(html, profile);
  if (candidates.length !== 1) return null;
  try {
    const url = checkedUrl(new URL(candidates[0], pageUrl).toString());
    return url.hostname === profile.imageHost &&
      profile.imagePath.test(url.pathname) &&
      url.search === (profile.query ?? '') &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}
