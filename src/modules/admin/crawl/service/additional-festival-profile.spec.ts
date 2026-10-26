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
