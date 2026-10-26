import { checkedUrl } from './crawl-fetch';

export const WONDERLIVET_PROFILE_SEED = 'wonderlivet-official-profile';
export const WONDERLIVET_PROFILE_FESTIVAL_URL =
  'https://www.wonderli.vet/lineup';

interface Profile {
  artistName: string;
  pageName: string;
  rule: 'hololive' | 'avex' | 'poclanos' | 'sony';
  imageHost: string;
  imagePath: RegExp;
}

const poclanosImagePath =
  /^\/drmvsn\/wp-content\/uploads\/[0-9]{4}\/[0-9]{2}\/[^/?#]+[.](jpg|jpeg|png|webp)$/i;

// Page and performer identities are reviewed; portrait URLs come from fresh HTML.
export const WONDERLIVET_PROFILES: Readonly<Record<string, Profile>> = {
  'https://hololive.hololivepro.com/talents/hoshimachi-suisei/': {
    artistName: 'Hoshimachi Suisei',
    pageName: '星街すいせい',
    rule: 'hololive',
    imageHost: 'hololive.hololivepro.com',
    imagePath:
      /^\/wp-content\/uploads\/[0-9]{4}\/[0-9]{2}\/[^/?#]+[.](jpg|jpeg|png|webp)$/i,
  },
  'https://www.avex.jp/ai/profile/': {
    artistName: 'Ai Otsuka',
    pageName: '大塚 愛',
    rule: 'avex',
    imageHost: 'img.imageimg.net',
    imagePath: /^\/artist\/ai\/img\/[^/?#]+[.](jpg|jpeg|png|webp)$/i,
  },
  'https://poclanos.com/artist/%ED%86%A0%EB%A7%88%ED%86%A0%EB%A7%9B/': {
    artistName: 'Tomatomat',
    pageName: '토마토맛',
    rule: 'poclanos',
    imageHost: 'poclanos.com',
    imagePath: poclanosImagePath,
  },
  'https://poclanos.com/artist/%EC%86%A1%EC%86%8C%ED%9D%AC/': {
    artistName: 'SONG SOHEE',
    pageName: '송소희',
    rule: 'poclanos',
    imageHost: 'poclanos.com',
    imagePath: poclanosImagePath,
  },
  'https://poclanos.com/artist/%ED%95%9C%EB%A1%9C%EB%A1%9C/': {
    artistName: 'HANRORO',
    pageName: '한로로',
    rule: 'poclanos',
    imageHost: 'poclanos.com',
    imagePath: poclanosImagePath,
  },
  'https://poclanos.com/artist/%EC%95%84%EC%9D%B4%EC%9A%B0%EC%97%90%EC%98%A4/':
    {
      artistName: 'A I W E O',
      pageName: '아이우에오',
      rule: 'poclanos',
      imageHost: 'poclanos.com',
      imagePath: poclanosImagePath,
    },
};

export const SUKIMASWITCH_PROFILE_URL =
  'https://www.sonymusic.co.jp/artist/sukimaswitch/profile/';
export const SUKIMASWITCH_PROFILE: Profile = {
  artistName: 'SUKIMASWITCH',
  pageName: 'スキマスイッチ',
  rule: 'sony',
  imageHost: 'www.sonymusic.co.jp',
  imagePath:
    /^\/adm_image\/common\/artist_image\/80007000\/80007594\/artist_photo\/[0-9]+[.]jpe?g$/i,
};

const approvedProfiles: Readonly<Record<string, Profile>> = {
  ...WONDERLIVET_PROFILES,
  [SUKIMASWITCH_PROFILE_URL]: SUKIMASWITCH_PROFILE,
};

const sqlLiteral = (value: string) => "'" + value.replace(/'/g, "''") + "'";

export const WONDERLIVET_PUBLIC_IMAGE_SQL = Object.entries(approvedProfiles)
  .map(([pageUrl, profile]) => {
    const origin =
      '^https://' +
      profile.imageHost.replace(/\./g, '[.]') +
      profile.imagePath.source.slice(1, -1).replace(/\\\//g, '/') +
      '$';
    return (
      '(source.url = ' +
      sqlLiteral(pageUrl) +
      ' AND source."parserConfig"->>\'artistName\' = ' +
      sqlLiteral(profile.artistName) +
      ' AND image."originUrl" ~* ' +
      sqlLiteral(origin) +
      ')'
    );
  })
  .join('\n      OR ');

export function wonderlivetProfileFor(
  pageUrl: string,
  config: Record<string, string>,
): Profile | null {
  let normalized: string;
  try {
    normalized = checkedUrl(pageUrl).toString();
  } catch {
    return null;
  }
  const profile = approvedProfiles[normalized];
  return config.seed === WONDERLIVET_PROFILE_SEED &&
    config.festivalSourceUrl === WONDERLIVET_PROFILE_FESTIVAL_URL &&
    config.artistName === profile?.artistName
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

function onlyOne<T>(values: T[]): T | null {
  return values.length === 1 ? values[0] : null;
}

function exactElementText(
  html: string,
  tag: string,
  className: string,
  expected: string,
): boolean {
  const values = [
    ...html.matchAll(
      new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi'),
    ),
  ]
    .filter((match) =>
      attr(match[1], 'class')?.split(/\s+/).includes(className),
    )
    .map((match) => match[2].replace(/<[^>]*>/g, '').trim());
  return onlyOne(values) === expected;
}

export function poclanosProfileImageCandidates(
  html: string,
  pageName: string,
): string[] {
  if (
    !html.includes(`<title>${pageName} | POCLANOS</title>`) ||
    !exactElementText(html, 'h1', 'page-title', pageName)
  )
    return [];
  const main = onlyOne(
    [...html.matchAll(/<main\b([^>]*)>([\s\S]*?)<\/main>/gi)].filter((match) =>
      attr(match[1], 'class')?.split(/\s+/).includes('artist-single'),
    ),
  )?.[2];
  if (!main) return [];
  const wrappers = [
    ...main.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi),
  ].filter((match) =>
    attr(match[1], 'class')?.split(/\s+/).includes('artist-img-wrap'),
  );
  const image = onlyOne(wrappers)?.[2];
  return image
    ? [...image.matchAll(/<img\b[^>]*>/gi)]
        .map((match) => attr(match[0], 'src'))
        .filter((value): value is string => Boolean(value))
    : [];
}

function profileImageCandidates(
  html: string,
  pageUrl: string,
  profile: Profile,
): string[] {
  switch (profile.rule) {
    case 'hololive': {
      const title = onlyOne(
        [...html.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)].map((match) =>
          match[1].trim(),
        ),
      );
      if (!title?.startsWith(`${profile.pageName} | `)) return [];
      const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map(
        (match) => match[0],
      );
      const pageClaim = onlyOne(
        metadata
          .filter((tag) => attr(tag, 'property') === 'og:url')
          .map((tag) => attr(tag, 'content')),
      );
      if (pageClaim !== pageUrl) return [];
      return [
        ...new Set(
          metadata
            .filter((tag) => attr(tag, 'property') === 'og:image')
            .map((tag) => attr(tag, 'content'))
            .filter((value): value is string => Boolean(value)),
        ),
      ];
    }
    case 'avex': {
      if (
        !html.includes(`<title>PROFILE | ${profile.pageName} - Avex</title>`) ||
        !exactElementText(html, 'h2', 'profGroup__name', profile.pageName)
      )
        return [];
      const wrappers = [
        ...html.matchAll(/<div\b([^>]*)>\s*(<img\b[^>]*>)\s*<\/div>/gi),
      ].filter((match) =>
        attr(match[1], 'class')?.split(/\s+/).includes('profGroup__mainImg'),
      );
      const image = onlyOne(wrappers)?.[2];
      return image
        ? [...image.matchAll(/<img\b[^>]*>/gi)]
            .map((match) => attr(match[0], 'data-src'))
            .filter((value): value is string => Boolean(value))
        : [];
    }
    case 'poclanos': {
      return poclanosProfileImageCandidates(html, profile.pageName);
    }
    case 'sony': {
      const title = onlyOne(
        [...html.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)].map((match) =>
          match[1].trim(),
        ),
      );
      if (
        title !==
        `プロフィール | ${profile.pageName} | ソニーミュージックオフィシャルサイト`
      )
        return [];
      const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map(
        (match) => match[0],
      );
      const pageClaim = onlyOne(
        metadata
          .filter((tag) => attr(tag, 'property') === 'og:url')
          .map((tag) => attr(tag, 'content')),
      );
      if (pageClaim !== pageUrl) return [];
      const header = onlyOne(
        [...html.matchAll(/<artist-header-component\b[^>]*>/gi)].map(
          (match) => match[0],
        ),
      );
      if (
        !header ||
        attr(header, 'name') !== profile.pageName ||
        attr(header, 'folder') !== 'sukimaswitch'
      )
        return [];
      const image = attr(header, 'image');
      const ogImage = onlyOne(
        metadata
          .filter((tag) => attr(tag, 'property') === 'og:image')
          .map((tag) => attr(tag, 'content')),
      );
      if (!image) return [];
      try {
        return ogImage === new URL(image, pageUrl).toString() ? [image] : [];
      } catch {
        return [];
      }
    }
  }
}

export function wonderlivetProfileImageUrl(
  html: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  const profile = wonderlivetProfileFor(pageUrl, config);
  if (!profile || Buffer.byteLength(html, 'utf8') > 2_000_000) return null;
  const candidates = profileImageCandidates(html, pageUrl, profile);
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
