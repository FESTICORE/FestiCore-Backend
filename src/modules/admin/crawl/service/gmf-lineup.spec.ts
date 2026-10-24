import { GMF_IMAGE_ORIGIN, parseGmfLineup } from './gmf-lineup';

function pages(
  options: {
    cards?: number;
    duplicate?: boolean;
    missingHandle?: boolean;
    badOrigin?: boolean;
  } = {},
) {
  const count = options.cards ?? 48;
  const data: Record<string, unknown> = {};
  const banners = Array.from({ length: count }, (_, index) => {
    const artist = `Artist ${index + 1}`;
    const path = `/GMF_2026_${index + 1}_aabbccdd00.jpg`;
    data[`UploadFile:${index}`] = {
      url: `${options.badOrigin && index === 0 ? 'https://wrong.example' : GMF_IMAGE_ORIGIN}${path}`,
      formats: {
        thumbnail: { name: `thumbnail_GMF2026_아티개별_토_${artist}.jpg` },
      },
    };
    return {
      image: {
        __ref: `UploadFile:${options.duplicate && index === 1 ? 0 : index}`,
      },
      link:
        options.missingHandle && index === 0
          ? null
          : `https://www.instagram.com/gmf_artist_${index + 1}/`,
    };
  });
  data['Festival:172'] = { lineup: [{ banners }] };
  const notice = Array.from(
    { length: count },
    (_, index) =>
      `<span>Artist ${index + 1}</span><a href="https://www.instagram.com/gmf_artist_${index + 1}/">@gmf_artist_${index + 1}</a>`,
  ).join('<br>');
  const wrap = (apollo: Record<string, unknown>) =>
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { apolloState: { data: apollo } } })}</script>`;
  return [wrap(data), wrap({ 'Post:4802': { content: notice } })] as const;
}

describe('GMF official lineup images', () => {
  it('matches all 48 official cards to notice names by Instagram account', () => {
    const [lineup, notice] = pages();
    const entries = parseGmfLineup(lineup, notice);
    expect(entries).toHaveLength(48);
    expect(entries[0]).toEqual({
      artistName: 'Artist 1',
      imageUrl: new URL(`${GMF_IMAGE_ORIGIN}/GMF_2026_1_aabbccdd00.jpg`),
    });
  });

  it('uses the official thumbnail and exact notice name when the card has no profile link', () => {
    const [lineup, notice] = pages({ missingHandle: true });
    expect(parseGmfLineup(lineup, notice)[0].artistName).toBe('Artist 1');
  });

  it.each([
    ['incomplete lineup', { cards: 47 }],
    ['duplicate image', { duplicate: true }],
    ['foreign image host', { badOrigin: true }],
  ])('rejects %s before persistence', (_label, options) => {
    const [lineup, notice] = pages(options);
    expect(() => parseGmfLineup(lineup, notice)).toThrow();
  });

  it('rejects a card whose profile account cannot be verified in the notice', () => {
    const [lineup, notice] = pages();
    expect(() =>
      parseGmfLineup(lineup.replace('gmf_artist_1/', 'other_account/'), notice),
    ).toThrow('유일하게 연결하지 못했습니다');
  });
});
