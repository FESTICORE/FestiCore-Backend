import { checkedUrl } from './crawl-fetch';

export const SOHYANG_COMMONS_SEED = 'sohyang-commons-profile';
export const SOHYANG_COMMONS_PAGE =
  'https://commons.wikimedia.org/wiki/File:180212_%EC%86%8C%ED%96%A5.png';
export const SOHYANG_FESTIVAL_URL =
  'https://ticket.melon.com/performance/index.htm?prodId=213769';
export const SOHYANG_COMMONS_ARTIST = '소향';

// The file page attributes the 2018 photograph to 뉴스인스타 and records a
// Commons-reviewed CC BY 3.0 license. Our stored WebP is a format conversion.
export const SOHYANG_COMMONS_CREDIT = {
  author: '뉴스인스타',
  license: 'CC BY 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
  sourceUrl: SOHYANG_COMMONS_PAGE,
  changes: 'Commons 밝기 보정본을 WebP 형식으로 변환',
} as const;

export function sohyangCommonsSourceFor(
  pageUrl: string,
  config: Record<string, string>,
): boolean {
  try {
    return (
      checkedUrl(pageUrl).href === SOHYANG_COMMONS_PAGE &&
      config.seed === SOHYANG_COMMONS_SEED &&
      config.festivalSourceUrl === SOHYANG_FESTIVAL_URL &&
      config.artistName === SOHYANG_COMMONS_ARTIST
    );
  } catch {
    return false;
  }
}

export function sohyangCommonsImageUrl(
  html: string,
  pageUrl: string,
  config: Record<string, string>,
): URL | null {
  if (
    !sohyangCommonsSourceFor(pageUrl, config) ||
    Buffer.byteLength(html, 'utf8') > 2_000_000 ||
    !html.includes('<h1 id="firstHeading"') ||
    !html.includes('File:180212 소향.png') ||
    !/title="Category:Sohyang"/.test(html) ||
    !/<td id="fileinfotpl&#95;aut"[^>]*>Author<\/td>\s*<td>\s*뉴스인스타\s*<\/td>/.test(
      html,
    ) ||
    !/<span class="licensetpl&#95;link"[^>]*>https:\/\/creativecommons\.org\/licenses\/by\/3\.0<\/span>/.test(
      html,
    ) ||
    !/<span class="licensetpl&#95;short"[^>]*>CC BY 3\.0\s*<\/span>/.test(
      html,
    ) ||
    !html.includes(
      'who confirmed that it was available there under the stated license',
    )
  )
    return null;

  const match = /<div class="fullImageLink" id="file"><a href="([^"]+)"/.exec(
    html,
  );
  if (!match) return null;
  try {
    const image = checkedUrl(match[1].replace(/&amp;/g, '&'));
    if (
      image.hostname !== 'upload.wikimedia.org' ||
      !/^\/wikipedia\/commons\/[a-f0-9]\/([a-f0-9]{2})\/180212_%EC%86%8C%ED%96%A5\.png$/i.test(
        image.pathname,
      ) ||
      image.hash
    )
      return null;
    image.search = '';
    return image;
  } catch {
    return null;
  }
}

export const SOHYANG_COMMONS_PUBLIC_IMAGE_SQL = `(
  source.url = 'https://commons.wikimedia.org/wiki/File:180212_%EC%86%8C%ED%96%A5.png'
  AND source."parserConfig"->>'festivalSourceUrl' = 'https://ticket.melon.com/performance/index.htm?prodId=213769'
  AND source."parserConfig"->>'artistName' = '소향'
  AND image."originUrl" ~* '^https://upload[.]wikimedia[.]org/wikipedia/commons/[a-f0-9]/[a-f0-9]{2}/180212_%EC%86%8C%ED%96%A5[.]png$'
  AND EXISTS (
    SELECT 1 FROM crawl_runs rights_run
    WHERE rights_run.id = image."runId"
      AND rights_run."sourceId" = source.id
      AND rights_run.result IN ('unchanged', 'nochange-parsed')
      AND rights_run."finishedAt" >= now() - interval '36 hours'
      AND rights_run.id = (
        SELECT latest.id FROM crawl_runs latest
        WHERE latest."sourceId" = source.id
          AND latest."finishedAt" IS NOT NULL
        ORDER BY latest."startedAt" DESC, latest.id DESC
        LIMIT 1
      )
  )
)`;
