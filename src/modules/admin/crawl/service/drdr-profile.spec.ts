import {
  DRDR_PROFILE_SEED,
  DRDR_PROFILES,
  drdrProfileFor,
  drdrProfileImageUrl,
} from './drdr-profile';

const image =
  'https://drdr.ac/wordpress/wp-content/uploads/2025/05/portrait-819x1024.jpg';

function config(page: string) {
  const profile = DRDR_PROFILES[page];
  return {
    seed: DRDR_PROFILE_SEED,
    festivalSourceUrl: profile.festivalSourceUrl,
    artistName: profile.artistName,
  };
}

function post(page: string, portrait = image) {
  return JSON.stringify({
    id: Number(page.split('/').at(-1)),
    status: 'publish',
    categories: [11],
    title: { rendered: DRDR_PROFILES[page].title },
    content: {
      rendered: `<p><strong>MUSICIAN</strong></p><p><img class="alignnone size-large" src="${portrait}" alt=""></p><p>Biography</p><p><strong>ALBUMS</strong></p><p><img src="https://drdr.ac/wordpress/wp-content/uploads/2026/08/album.jpg"></p>`,
    },
  });
}

describe('DRDR official profile photos', () => {
  it.each(Object.keys(DRDR_PROFILES))(
    'reads only the MUSICIAN portrait from %s',
    (page) => {
      expect(
        drdrProfileImageUrl(post(page), page, config(page))?.toString(),
      ).toBe(image);
    },
  );

  it('requires the exact official page and festival artist identity', () => {
    const page = Object.keys(DRDR_PROFILES)[0];
    expect(drdrProfileFor(page, config(page))).not.toBeNull();
    for (const wrong of [
      { seed: 'other' },
      { artistName: 'other' },
      { festivalSourceUrl: 'https://mintpaper.co.kr/festivals/172' },
    ]) {
      expect(
        drdrProfileImageUrl(post(page), page, { ...config(page), ...wrong }),
      ).toBeNull();
    }
    expect(
      drdrProfileImageUrl(post(page), page + '0', config(page)),
    ).toBeNull();
  });

  it('rejects draft, wrong category, changed title and a different post ID', () => {
    const page = Object.keys(DRDR_PROFILES)[1];
    for (const change of [
      { status: 'draft' },
      { categories: [12] },
      { title: { rendered: 'OTHER///다른 아티스트' } },
      { id: 50 },
    ]) {
      expect(
        drdrProfileImageUrl(
          JSON.stringify({ ...JSON.parse(post(page)), ...change }),
          page,
          config(page),
        ),
      ).toBeNull();
    }
  });

  it('rejects album art, off-domain images, queries and invalid payloads', () => {
    const page = Object.keys(DRDR_PROFILES)[2];
    for (const invalid of [
      'https://evil.example/wordpress/wp-content/uploads/2025/05/portrait.jpg',
      image + '?size=large',
      image.replace('https:', 'http:'),
      'https://drdr.ac/wordpress/wp-content/uploads/2025/05/cover.png',
    ])
      expect(
        drdrProfileImageUrl(post(page, invalid), page, config(page)),
      ).toBeNull();
    expect(drdrProfileImageUrl('{}', page, config(page))).toBeNull();
    expect(
      drdrProfileImageUrl('x'.repeat(2_000_001), page, config(page)),
    ).toBeNull();
    expect(
      drdrProfileImageUrl(
        post(page).replace(
          '<strong>MUSICIAN</strong>',
          '<strong>ALBUMS</strong>',
        ),
        page,
        config(page),
      ),
    ).toBeNull();
  });
});
