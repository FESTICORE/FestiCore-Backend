import { checkedUrl } from './crawl-fetch';

export interface ApprovedCommonsExpectation {
  fileKey: string;
  author: string;
  license: string;
  licenseUrl: string;
}

export interface ApprovedCommonsProfile {
  imageUrl: URL;
  credit: {
    author: string;
    license: string;
    licenseUrl: string;
    sourceUrl: string;
  };
}

const MAX_HTML_BYTES = 2_000_000;
const FILE_PATH = /^\/wikipedia\/commons\/[a-f0-9]\/[a-f0-9]{2}\/([^/]+)$/i;
const LICENSE_URL =
  /^https:\/\/creativecommons\.org\/licenses\/by\/(2\.0|2\.5|3\.0|4\.0)\/?$/;

export function canonicalCcByLicenseUrl(
  value: string,
  license: string,
): string | null {
  const match = LICENSE_URL.exec(value);
  if (!match || license !== `CC BY ${match[1]}`) return null;
  return `https://creativecommons.org/licenses/by/${match[1]}`;
}

function decodeText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(
      /&#(?:x([a-f0-9]+)|([0-9]+));/gi,
      (
        _whole: string,
        hex: string | undefined,
        decimal: string | undefined,
      ) => {
        const point = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
        return point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
      },
    )
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp);/gi,
      (_, entity: string) =>
        ({
          amp: '&',
          quot: '"',
          apos: "'",
          lt: '<',
          gt: '>',
          nbsp: ' ',
        })[entity.toLowerCase()] ?? '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function fileName(key: string): string | null {
  if (!/^File:[^/?#<>]{1,250}$/u.test(key)) return null;
  return key.slice(5).replaceAll(' ', '_');
}

function elementsByClass(html: string, className: string): string[] {
  const matches: string[] = [];
  const escaped = className.replaceAll('_', '(?:_|&#95;)');
  const expression = new RegExp(
    `<span\\b(?=[^>]*\\bclass=["'](?:[^"']*\\s)?${escaped}(?:\\s[^"']*)?["'])[^>]*>([\\s\\S]*?)<\\/span>`,
    'gi',
  );
  for (const match of html.matchAll(expression))
    matches.push(decodeText(match[1]));
  return matches;
}

/**
 * A Commons file page is evidence of the displayed metadata, not proof that
 * the pictured person is the festival artist. The caller must separately
 * verify that identity and the official lineup before approving publication.
 */
export function parseApprovedCommonsProfile(
  html: string,
  filePageUrl: string,
  expected: ApprovedCommonsExpectation,
): ApprovedCommonsProfile | null {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return null;
  const expectedName = fileName(expected.fileKey);
  if (!expectedName || !expected.author.trim()) return null;
  const canonicalLicenseUrl = canonicalCcByLicenseUrl(
    expected.licenseUrl,
    expected.license,
  );
  if (!canonicalLicenseUrl) return null;

  let page: URL;
  try {
    page = checkedUrl(filePageUrl);
    if (
      page.hostname !== 'commons.wikimedia.org' ||
      page.search ||
      page.hash ||
      decodeURIComponent(page.pathname).replaceAll(' ', '_') !==
        `/wiki/File:${expectedName}`
    )
      return null;
  } catch {
    return null;
  }

  const heading =
    /<h1\b(?=[^>]*\bid=["']firstHeading["'])[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (
    !heading ||
    decodeText(heading[1]).replaceAll(' ', '_') !== `File:${expectedName}`
  )
    return null;

  // Commons can retain a file page while deletion, license, or personality
  // rights are disputed. An explicit warning makes this source ineligible.
  if (
    /(?:deletion request|speedy deletion|delete template|license-recheck|personality rights|no permission since|copyright violation)/i.test(
      html,
    ) ||
    /<[^>]+\bclass=["'][^"']*\blicense-review-(?:failed|needed)\b[^"']*["'][^>]*>/i.test(
      html,
    )
  )
    return null;

  const author =
    /<td\b[^>]*\bid=["']fileinfotpl(?:_|&#95;)aut["'][^>]*>\s*Author\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(
      html,
    );
  if (!author || decodeText(author[1]) !== expected.author.trim()) return null;

  const licenses = elementsByClass(html, 'licensetpl_link');
  const labels = elementsByClass(html, 'licensetpl_short');
  if (
    licenses.length !== 1 ||
    labels.length !== 1 ||
    canonicalCcByLicenseUrl(licenses[0], expected.license) !==
      canonicalLicenseUrl ||
    labels[0] !== expected.license
  )
    return null;

  const imageLink =
    /<div\b(?=[^>]*\bclass=["']fullImageLink["'])(?=[^>]*\bid=["']file["'])[^>]*>\s*<a\b[^>]*\bhref=["']([^"']+)["']/i.exec(
      html,
    );
  if (!imageLink) return null;
  try {
    const image = checkedUrl(imageLink[1].replaceAll('&amp;', '&'));
    const match = FILE_PATH.exec(image.pathname);
    if (image.hostname !== 'upload.wikimedia.org' || !match || image.hash)
      return null;
    const originalName = decodeURIComponent(match[1]);
    if (
      originalName !== expectedName ||
      !/\.(?:jpe?g|png|webp)$/i.test(originalName)
    )
      return null;
    if (image.search) {
      if (
        (image.searchParams.size !== 2 && image.searchParams.size !== 3) ||
        image.searchParams.get('utm_source') !== 'commons.wikimedia.org' ||
        image.searchParams.get('utm_content') !== 'original' ||
        (image.searchParams.has('utm_campaign') &&
          image.searchParams.get('utm_campaign') !== 'index')
      )
        return null;
      image.search = '';
    }
    return {
      imageUrl: image,
      credit: {
        author: expected.author.trim(),
        license: expected.license,
        licenseUrl: canonicalLicenseUrl,
        sourceUrl: page.href,
      },
    };
  } catch {
    return null;
  }
}
