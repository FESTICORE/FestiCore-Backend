export const PRUGIO_LINEUP_URL =
  'https://www.mcst.go.kr/site/s_culture/culture/cultureView.jsp?pRo=160&pSeq=75117';
export const PRUGIO_FESTIVAL_ID = 'fst_dd02ec0ac1a69d4a';
export const PRUGIO_LINEUP_SEED = 'mcst-prugio-lineup';

export interface PrugioLineup {
  festivalId: string;
  name: string;
  venue: string;
  date: string;
  url: string;
  artists: { name: string; dates: string[] }[];
}

function contentText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePrugioLineup(body: string): PrugioLineup {
  if (Buffer.byteLength(body, 'utf8') > 2_000_000)
    throw new Error('푸르지오 공식 페이지 크기 제한을 초과했습니다.');
  const title = contentText(
    /<h3\b[^>]*class=["'][^"']*\bboard_tit\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(
      body,
    )?.[1] ?? '',
  );
  const details =
    /<div\b[^>]*class=["'][^"']*\bboard_detail\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      body,
    )?.[1] ?? '';
  const field = (label: string) =>
    contentText(
      new RegExp(`<dt>${label}<\\/dt>\\s*<dd>([\\s\\S]*?)<\\/dd>`, 'i').exec(
        details,
      )?.[1] ?? '',
    );
  if (
    title !== '제4회 푸르지오아트홀 뮤직페스티벌' ||
    field('기간') !== '2026.10.02.~2026.10.04.' ||
    field('장소') !== '서울 | 푸르지오아트홀'
  )
    throw new Error('푸르지오 공식 공연 신원·기간·장소가 일치하지 않습니다.');
  const section =
    /<div\b[^>]*class=["'][^"']*\bview_con\b[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["'][^"']*\bculture-guide\b/i.exec(
      body,
    )?.[1];
  if (!section) throw new Error('푸르지오 공식 공연 소개를 찾지 못했습니다.');
  const paragraphs = [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => contentText(match[1]))
    .filter(Boolean);
  const marker = paragraphs.indexOf('[출연자]');
  if (marker < 0) throw new Error('푸르지오 출연자 구획을 찾지 못했습니다.');
  const dates = ['2026-10-02', '2026-10-03', '2026-10-04'];
  const byDate = new Map<string, string[]>();
  let currentDate: string | null = null;
  for (const line of paragraphs.slice(marker + 1)) {
    const heading = /^([234])일\s*〈[^〉]+〉$/.exec(line);
    if (heading) {
      currentDate = `2026-10-0${heading[1]}`;
      if (byDate.has(currentDate))
        throw new Error('푸르지오 공연 날짜가 중복됩니다.');
      byDate.set(currentDate, []);
      continue;
    }
    const performers = /^(?:Sop|M\.Sop|Ten|B\.Bar|Bar|Pf)\s*-\s*(.+)$/i.exec(
      line,
    );
    if (!performers || !currentDate)
      throw new Error('푸르지오 출연자 항목을 해석하지 못했습니다.');
    const names = performers[1].split(',').map((name) => name.trim());
    if (names.some((name) => !/^[가-힣]{2,12}$/.test(name)))
      throw new Error('푸르지오 출연자 이름 형식이 잘못되었습니다.');
    byDate.get(currentDate)!.push(...names);
  }
  if (
    dates.some((date) => !byDate.has(date) || !byDate.get(date)?.length) ||
    [...byDate.values()].some(
      (names) => new Set(names).size !== names.length || names.length > 30,
    )
  )
    throw new Error('푸르지오 날짜별 출연자 명단이 불완전합니다.');
  const artists = new Map<string, string[]>();
  for (const date of dates)
    for (const name of byDate.get(date)!)
      artists.set(name, [...(artists.get(name) ?? []), date]);
  return {
    festivalId: PRUGIO_FESTIVAL_ID,
    name: title,
    venue: '푸르지오아트홀',
    date: '2026.10.02 - 2026.10.04',
    url: PRUGIO_LINEUP_URL,
    artists: [...artists].map(([name, artistDates]) => ({
      name,
      dates: artistDates,
    })),
  };
}
