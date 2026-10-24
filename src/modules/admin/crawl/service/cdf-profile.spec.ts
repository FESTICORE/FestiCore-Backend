import {
  CDF_FESTIVAL_URL,
  CDF_PROFILES,
  CDF_PROFILE_SEED,
  cdfProfileFor,
  cdfProfileImageUrl,
} from './cdf-profile';

const photo =
  'https://poclanos.com/drmvsn/wp-content/uploads/2026/05/profile.jpg';
const cases: [string, string, string][] = [
  [
    'https://www.bandkardi.com/profile',
    '<section aria-label="KARDI members"><img src="/_next/static/media/home_hero_pc.e0cb8389.webp" alt="KARDI members"></section><h1 id="profile-title">KARDI</h1>',
    'https://www.bandkardi.com/_next/static/media/home_hero_pc.e0cb8389.webp',
  ],
  [
    'https://rbwjapan.jp/artist/onewe.php',
    '<h2 class="jpn">ONEWE</h2><div class="column02 detail-text"><img src="/img/artist/ARTIST_ONEWE_202608.jpg?1" alt="ONEWE"></div>',
    'https://rbwjapan.jp/img/artist/ARTIST_ONEWE_202608.jpg?1',
  ],
  [
    'https://www.fncent.com/c/2/9',
    '<ul><li><div class="pic"><a href="/Other"><img src="/other.jpg"></a></div><div class="add_tit">Other</div></li><li><div class="pic"><a href="/AxMxP"><img src="https://fncent.com/files/2026/08/06/545bf42330a6231f01ee7792812cc855214523.jpg"></a></div><div class="add_tit">AxMxP</div></li></ul>',
    'https://fncent.com/files/2026/08/06/545bf42330a6231f01ee7792812cc855214523.jpg',
  ],
  [
    'https://m.fncent.com/FTISLAND/b/introduce/1281',
    '<div id="mini_visu"><img src="https://www.fncent.com/files/2024/07/03/5938ae11bd9f75e5dc168276af4d845c181238.jpg"></div><div id="mini_cont"><h3 class="mini_title">FTISLAND</h3></div>',
    'https://www.fncent.com/files/2024/07/03/5938ae11bd9f75e5dc168276af4d845c181238.jpg',
  ],
  [
    'https://mpmgmusic.com/thesolutions',
    '<title>THE SOLUTIONS | MPMG MUSIC(엠피엠지뮤직)</title><div class="heroWrapper desktop navigation"><div class="heroContent"><div class="heroImgDiv" style="background-image:url(https://contents.sixshop.com/thumbnails/uploadedFiles/157578/default/image_1723198061524_2500.jpg)"></div></div></div>',
    'https://contents.sixshop.com/thumbnails/uploadedFiles/157578/default/image_1723198061524_2500.jpg',
  ],
  [
    'https://ebbmusic.eu/artists/idiotape/',
    '<meta property="og:title" content="Idiotape - EBB Music"><meta property="og:image" content="https://ebbmusic.eu/wp-content/uploads/2022/07/profile.jpg"><img class="wp-post-image" src="https://ebbmusic.eu/wp-content/uploads/2022/07/profile.jpg"><a href="https://www.instagram.com/idiotapeofficial/" class="social-link">Instagram</a>',
    'https://ebbmusic.eu/wp-content/uploads/2022/07/profile.jpg',
  ],
  ...[
    ['포져군단', 'poseridiott'],
    ['극동아시아타이거즈', 'far_east_asian_tigers'],
    ['실리카겔', 'silica___gel'],
  ].map(([name, handle]): [string, string, string] => [
    'https://poclanos.com/artist/' + name + '/',
    '<main class="site-main artist-single"><div class="content-detail"><span class="artist-img-wrap"><img src="' +
      photo +
      '" / ></span><div class="album-icons"><a href="https://www.instagram.com/' +
      handle +
      '/">Instagram</a></div></div><h1 class="page-title">' +
      name +
      '</h1></main>',
    photo,
  ]),
];

function config(page: string) {
  const profile = CDF_PROFILES[new URL(page).toString()];
  return {
    seed: CDF_PROFILE_SEED,
    festivalSourceUrl: CDF_FESTIVAL_URL,
    artistName: profile.artistName,
    officialHandle: profile.officialHandle,
  };
}

describe('CDF official profile photos', () => {
  it.each(cases)(
    'extracts one scoped portrait from %s',
    (page, html, expected) => {
      expect(cdfProfileImageUrl(html, page, config(page))?.toString()).toBe(
        expected,
      );
    },
  );

  it('binds exact page, artist, handle and festival', () => {
    const [page, html] = cases[0];
    expect(cdfProfileFor(page, config(page))).not.toBeNull();
    for (const wrong of [
      { artistName: 'OTHER' },
      { officialHandle: 'other' },
      { festivalSourceUrl: 'https://mintpaper.co.kr/festivals/177' },
      { seed: 'other' },
    ]) {
      expect(
        cdfProfileImageUrl(html, page, { ...config(page), ...wrong }),
      ).toBeNull();
    }
    expect(
      cdfProfileImageUrl(html, 'https://www.bandkardi.com/other', config(page)),
    ).toBeNull();
    expect(
      cdfProfileImageUrl(html, 'https://www.bandkardi.com/other', {
        seed: CDF_PROFILE_SEED,
        festivalSourceUrl: CDF_FESTIVAL_URL,
      }),
    ).toBeNull();
  });

  it('rejects a roster card with a different identity', () => {
    const [page, html] = cases[2];
    expect(
      cdfProfileImageUrl(
        html.replace('>AxMxP</div>', '>Other</div>'),
        page,
        config(page),
      ),
    ).toBeNull();
  });

  it('rejects ambiguous portraits and a changed page title', () => {
    const [page, html] = cases[0];
    const duplicate =
      '<img src="/_next/static/media/home_hero_pc.e0cb8389.webp" alt="KARDI members">';
    expect(
      cdfProfileImageUrl(
        html.replace('</section>', duplicate + '</section>'),
        page,
        config(page),
      ),
    ).toBeNull();
    expect(
      cdfProfileImageUrl(
        html.replace('>KARDI</h1>', '>OTHER</h1>'),
        page,
        config(page),
      ),
    ).toBeNull();
  });

  it('rejects off-host, volatile query, HTTP and oversized documents', () => {
    const [page, html, image] = cases[0];
    for (const invalid of [
      'https://evil.example/_next/static/media/home_hero_pc.e0cb8389.webp',
      image + '?v=20261025',
      image.replace('https:', 'http:'),
    ]) {
      expect(
        cdfProfileImageUrl(
          html.replace(
            '/_next/static/media/home_hero_pc.e0cb8389.webp',
            invalid,
          ),
          page,
          config(page),
        ),
      ).toBeNull();
    }
    expect(
      cdfProfileImageUrl(html + 'x'.repeat(2_000_001), page, config(page)),
    ).toBeNull();
  });

  it('does not select a Poclanos album cover', () => {
    const [page, html] = cases[8];
    expect(
      cdfProfileImageUrl(
        html.replace('artist-img-wrap', 'album-cover'),
        page,
        config(page),
      ),
    ).toBeNull();
  });
});
