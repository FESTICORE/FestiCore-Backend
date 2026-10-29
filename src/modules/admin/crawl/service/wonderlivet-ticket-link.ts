export const WONDERLIVET_LINK_PAGE = 'https://litt.ly/wonderlivet';
export const WONDERLIVET_TICKET_SEED = 'wonderlivet-official-ticket-links';
export const WONDERLIVET_DETAIL_SEED = 'wonderlivet-official-ticket-detail';

const MELON_PRODUCT =
  /^https:\/\/ticket\.melon\.com\/performance\/index\.htm\?prodId=[1-9]\d*$/;

function tagEnd(html: string, start: number): number {
  let quote = '';
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function attributes(tag: string): Map<string, string> | null {
  const result = new Map<string, string>();
  let index = 2;
  while (index < tag.length - 1) {
    while (/\s/.test(tag[index] ?? '')) index++;
    if (index >= tag.length - 1 || tag[index] === '/') break;
    const start = index;
    while (index < tag.length - 1 && !/[\s=/>]/.test(tag[index])) index++;
    if (index === start) return null;
    const name = tag.slice(start, index).toLowerCase();
    if (result.has(name)) return null;
    while (/\s/.test(tag[index] ?? '')) index++;
    if (tag[index] !== '=') {
      result.set(name, '');
      continue;
    }
    index++;
    while (/\s/.test(tag[index] ?? '')) index++;
    const quote = tag[index];
    if (quote !== '"' && quote !== "'") return null;
    index++;
    const end = tag.indexOf(quote, index);
    if (end < 0) return null;
    result.set(name, tag.slice(index, end));
    index = end + 1;
  }
  return result;
}

function anchors(body: string): { href: string; label: string }[] {
  const result: { href: string; label: string }[] = [];
  const html = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    const end = tagEnd(html, start + 2);
    if (end < 0) throw new Error('공식 링크 페이지의 태그가 불완전합니다.');
    cursor = end + 1;
    if (!/^<a(?=[\s>])/i.test(html.slice(start, end + 1))) continue;
    const parsed = attributes(html.slice(start, end + 1));
    if (!parsed)
      throw new Error('공식 링크 페이지의 앵커 속성이 올바르지 않습니다.');
    const closing = html.toLowerCase().indexOf('</a>', end + 1);
    if (closing < 0)
      throw new Error('공식 링크 페이지의 앵커가 닫히지 않았습니다.');
    result.push({
      href: (parsed.get('href') ?? '').replace(/&amp;/gi, '&'),
      label: html
        .slice(end + 1, closing)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }
  return result;
}

export function wonderlivetMelonProduct(body: string): string {
  if (Buffer.byteLength(body, 'utf8') > 200_000)
    throw new Error('공식 링크 페이지 크기 제한을 초과했습니다.');
  const html = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  if (
    !/<title>\s*WONDERLIVET[·\s]*원더리벳\s*<\/title>/i.test(html) ||
    !/<h1>\s*WONDERLIVET[·\s]*원더리벳\s*<\/h1>/i.test(html) ||
    !/원더리벳\s*2026\s*전체 라인업과 타임테이블이 공개되었습니다/.test(html) ||
    !/<h2>\s*TICKET\s*<\/h2>/i.test(html)
  )
    throw new Error('원더리벳 2026 공식 링크 페이지를 확인하지 못했습니다.');
  const links = anchors(html);
  if (
    !links.some(
      (link) =>
        link.href === 'https://www.wonderli.vet/' &&
        link.label.includes('홈페이지 바로가기'),
    )
  )
    throw new Error('원더리벳 공식 홈페이지 연결을 확인하지 못했습니다.');
  const labelled = links.filter((link) =>
    /\[멜론티켓\]\s*예매페이지 바로가기/.test(link.label),
  );
  const melonLinks = links.filter(
    (link) =>
      link.href.includes('ticket.melon.com/performance/') ||
      /\[멜론티켓\]/.test(link.label),
  );
  if (
    labelled.length !== 1 ||
    melonLinks.length !== 1 ||
    !MELON_PRODUCT.test(labelled[0].href)
  )
    throw new Error('공식 멜론티켓 상품 링크가 유일하고 정확해야 합니다.');
  return labelled[0].href;
}
