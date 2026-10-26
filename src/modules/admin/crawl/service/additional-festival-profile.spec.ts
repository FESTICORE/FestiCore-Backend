import {
  ADDITIONAL_FESTIVAL_PROFILE_SEED,
  ADDITIONAL_FESTIVAL_PROFILES,
  ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL,
  additionalFestivalProfileFor,
  additionalFestivalProfileImageUrl,
} from './additional-festival-profile';

const antenna = 'https://antenna.co.kr/KwonJinAh';
const poclanos = Object.keys(ADDITIONAL_FESTIVAL_PROFILES).find((page) =>
  page.startsWith('https://poclanos.com/'),
)!;
const images = {
  [antenna]: 'https://cdn.imweb.me/thumbnail/20261026/abc123def456.jpg',
  [poclanos]:
    'https://poclanos.com/drmvsn/wp-content/uploads/2026/10/okdal-portrait.jpg',
  'https://paulkim.co.kr/':
    'https://image.static.bstage.in/cdn-cgi/image/metadata=none/paulkim/f14d75b4-f328-4832-8fee-9f12fd8bdd7e/d40f80c8-63b1-403b-933a-e898b853778e/ori.jpg',
  'https://www.yoursummer.net/artist/nerd-connection':
    'https://cdn.prod.website-files.com/6649fa6f24368d5b7f0e9bc1/6aa3bcf26a0d432320d3492d_nerd-connection.jpg',
};

function config(page: string) {
  const profile = ADDITIONAL_FESTIVAL_PROFILES[page];
  return {
    seed: ADDITIONAL_FESTIVAL_PROFILE_SEED,
    festivalSourceUrl: profile.festivalSourceUrl,
    artistName: profile.artistName,
  };
}

function html(page: string, image: string): string {
  if (page === antenna)
    return `<meta property="og:url" content="${page}"><h3>권진아<img src="https://cdn.imweb.me/upload/logo.png"></h3><h6>Kwon Jin Ah</h6><div data-widget-name="이미지"><img class="org_image" src="${image}"></div>`;
  if (page === poclanos)
    return `<title>옥상달빛 | POCLANOS</title><main class="artist-single"><span class="artist-img-wrap"><img src="${image}"></span></main><h1 class="page-title">옥상달빛</h1>`;
  if (page === 'https://paulkim.co.kr/')
    return `<title>폴킴 공식 홈페이지ㅣPaul Kim Official Homepage</title><meta property="og:image" content="${image}">`;
  if (page === 'https://www.yoursummer.net/artist/nerd-connection')
    return `<title>너드커넥션 Nerd Connection</title><span class="artist-name-bold">너드커넥션</span><img class="image-43" src="${image}">`;
  throw new Error(`Unsupported official profile: ${page}`);
}

describe('additional official festival performer photos', () => {
  it.each(Object.keys(ADDITIONAL_FESTIVAL_PROFILES))(
    'reads a new URL from the official %s page',
    (page) => {
      expect(
        additionalFestivalProfileImageUrl(
          html(page, images[page]),
          page,
          config(page),
        )?.toString(),
      ).toBe(images[page]);
    },
  );

  it.each(Object.keys(ADDITIONAL_FESTIVAL_PROFILES))(
    'requires the exact source, festival and performer for %s',
    (page) => {
      const body = html(page, images[page]);
      expect(additionalFestivalProfileFor(page, config(page))).not.toBeNull();
      for (const wrong of [
        { seed: 'other' },
        { festivalSourceUrl: 'https://ticket.yes24.com/Perf/other' },
        { artistName: 'other' },
      ])
        expect(
          additionalFestivalProfileImageUrl(body, page, {
            ...config(page),
            ...wrong,
          }),
        ).toBeNull();
      expect(
        additionalFestivalProfileImageUrl(body, page + 'other', config(page)),
      ).toBeNull();
    },
  );

  it.each(Object.keys(ADDITIONAL_FESTIVAL_PROFILES))(
    'rejects unverified image origins for %s',
    (page) => {
      for (const image of [
        images[page].replace(new URL(images[page]).hostname, 'evil.example'),
        images[page] + '?version=2',
        images[page].replace('https:', 'http:'),
      ])
        expect(
          additionalFestivalProfileImageUrl(
            html(page, image),
            page,
            config(page),
          ),
        ).toBeNull();
    },
  );

  it('rejects logo substitution and missing artist identity on Antenna', () => {
    const body = html(antenna, images[antenna]);
    expect(
      additionalFestivalProfileImageUrl(
        body.replace('권진아', '다른 아티스트'),
        antenna,
        config(antenna),
      ),
    ).toBeNull();
    expect(
      additionalFestivalProfileImageUrl(
        body.replace('class="org_image"', 'class="logo"'),
        antenna,
        config(antenna),
      ),
    ).toBeNull();
  });

  it('requires the official artist title and a single portrait candidate', () => {
    for (const page of [
      'https://paulkim.co.kr/',
      'https://www.yoursummer.net/artist/nerd-connection',
    ]) {
      const body = html(page, images[page]);
      expect(
        additionalFestivalProfileImageUrl(
          body.replace(/<title>[^<]+<\/title>/, '<title>다른 가수</title>'),
          page,
          config(page),
        ),
      ).toBeNull();
      expect(
        additionalFestivalProfileImageUrl(body + body, page, config(page)),
      ).toBeNull();
    }
    const page = 'https://www.yoursummer.net/artist/nerd-connection';
    expect(
      additionalFestivalProfileImageUrl(
        html(page, images[page]).replace('artist-name-bold', 'other'),
        page,
        config(page),
      ),
    ).toBeNull();
  });

  it('publishes only registered source, festival, artist and origin pairs', () => {
    for (const [page, profile] of Object.entries(
      ADDITIONAL_FESTIVAL_PROFILES,
    )) {
      expect(ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL).toContain(
        `source.url = '${page}'`,
      );
      expect(ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL).toContain(
        `source."parserConfig"->>'festivalSourceUrl' = '${profile.festivalSourceUrl}'`,
      );
      expect(ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL).toContain(
        `source."parserConfig"->>'artistName' = '${profile.artistName}'`,
      );
    }
  });
});
