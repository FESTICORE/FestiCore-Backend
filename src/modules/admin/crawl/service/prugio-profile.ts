import { checkedUrl } from './crawl-fetch';
import { PRUGIO_LINEUP_URL } from './prugio-lineup';

export const PRUGIO_PROFILE_URL = 'https://www.kiffa.or.kr/sub05/sub04.php';
export const PRUGIO_PROFILE_SEED = 'prugio-official-profile';
export const PRUGIO_PROFILE_ARTIST = '서운정';

const IMAGE_PATH = /^\/images\/sub\/sub0504_img[0-9]{1,3}[.]jpe?g$/i;

export const PRUGIO_PUBLIC_IMAGE_SQL = `(
  source.url = '${PRUGIO_PROFILE_URL}'
  AND source."parserConfig"->>'festivalSourceUrl' = '${PRUGIO_LINEUP_URL}'
  AND source."parserConfig"->>'artistName' = '${PRUGIO_PROFILE_ARTIST}'
  AND image."originUrl" ~* '^https://www[.]kiffa[.]or[.]kr/images/sub/sub0504_img[0-9]{1,3}[.]jpe?g$'
)`;

export function prugioProfileFor(
  pageUrl: string,
  config: Record<string, string>,
): boolean {
  try {
    return (
      checkedUrl(pageUrl).toString() === PRUGIO_PROFILE_URL &&
      config.seed === PRUGIO_PROFILE_SEED &&
      config.festivalSourceUrl === PRUGIO_LINEUP_URL &&
      config.artistName === PRUGIO_PROFILE_ARTIST
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

function classHas(tag: string, name: string): boolean {
  return attribute(tag, 'class')?.split(/\s+/).includes(name) ?? false;
}

export function prugioProfileImageUrl(
  html: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  if (
    !prugioProfileFor(pageUrl, config) ||
    Buffer.byteLength(html) > 2_000_000 ||
    !html.includes('<title>한국국제물류주선업협회</title>')
  )
    return null;
  const ambassadorSections = [
    ...html.matchAll(
      /<div\b([^>]*)>\s*<h6\b[^>]*>홍보대사<\/h6>\s*<ul>([\s\S]*?)<\/ul>/gi,
    ),
  ].filter((match) => classHas(match[1], 'con3'));
  if (ambassadorSections.length !== 1) return null;
  const candidates: string[] = [];
  for (const row of ambassadorSections[0][2].matchAll(
    /<li>\s*([\s\S]*?)<\/li>/gi,
  )) {
    const imageWrap = [
      ...row[1].matchAll(/<div\b([^>]*)>\s*(<img\b[^>]*>)\s*<\/div>/gi),
    ].filter((match) => classHas(match[1], 'img_wrap'));
    const textWrap = [
      ...row[1].matchAll(
        /<div\b([^>]*)>\s*<p>([^<]*)<\/p>\s*<strong>([^<]*)<\/strong>\s*<\/div>/gi,
      ),
    ].filter((match) => classHas(match[1], 'txt_wrap'));
    if (
      textWrap.length !== 1 ||
      textWrap[0][3].trim() !== PRUGIO_PROFILE_ARTIST
    )
      continue;
    if (textWrap[0][2].trim() !== '소프라노' || imageWrap.length !== 1)
      return null;
    const raw = attribute(imageWrap[0][2], 'src');
    if (!raw) return null;
    candidates.push(raw);
  }
  if (candidates.length !== 1) return null;
  try {
    const image = checkedUrl(new URL(candidates[0], pageUrl).toString());
    return image.hostname === 'www.kiffa.or.kr' &&
      IMAGE_PATH.test(image.pathname) &&
      !image.search &&
      !image.hash
      ? image
      : null;
  } catch {
    return null;
  }
}
