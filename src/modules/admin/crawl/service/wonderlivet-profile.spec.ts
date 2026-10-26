import {
  WONDERLIVET_PROFILE_FESTIVAL_URL,
  WONDERLIVET_PROFILE_SEED,
  WONDERLIVET_PROFILES,
  WONDERLIVET_PUBLIC_IMAGE_SQL,
  wonderlivetProfileFor,
  wonderlivetProfileImageUrl,
} from './wonderlivet-profile';

const hololive = 'https://hololive.hololivepro.com/talents/hoshimachi-suisei/';
const avex = 'https://www.avex.jp/ai/profile/';
const poclanos = Object.keys(WONDERLIVET_PROFILES).filter((page) =>
  page.startsWith('https://poclanos.com/'),
);

function config(page: string) {
  return {
    seed: WONDERLIVET_PROFILE_SEED,
    festivalSourceUrl: WONDERLIVET_PROFILE_FESTIVAL_URL,
    artistName: WONDERLIVET_PROFILES[page].artistName,
  };
}

function html(page: string, image: string) {
  const profile = WONDERLIVET_PROFILES[page];
  if (page === hololive)
    return `<title>${profile.pageName} | 所属タレント一覧 | hololive（ホロライブ）公式サイト</title><meta property="og:url" content="${page}"><meta property="og:image" content="${image}"><meta property="og:image" content="${image}">`;
  if (page === avex)
    return `<title>PROFILE | ${profile.pageName} - Avex</title><div class="profGroup"><div class="profGroup__mainImg"><img data-src="${image}" src="/ai/assets/img/common/lazyload.png"></div><div class="profGroup__dataWrap"><h2 class="profGroup__name">${profile.pageName}</h2></div></div>`;
  return `<title>${profile.pageName} | POCLANOS</title><main class="site-main artist-single"><div class="content-detail"><span class="artist-img-wrap"><img src="${image}" /></span><div class="album-icons"><img src="https://poclanos.com/icon.png"></div></div><h1 class="page-title">${profile.pageName}</h1></main>`;
}

const images: Record<string, string> = {
  [hololive]:
    'https://hololive.hololivepro.com/wp-content/uploads/2026/10/new-photo.png',
  [avex]: 'https://img.imageimg.net/artist/ai/img/new-profile.jpg',
  ...Object.fromEntries(
    poclanos.map((page) => [
      page,
      'https://poclanos.com/drmvsn/wp-content/uploads/2026/10/new-photo.jpeg',
    ]),
  ),
};

describe('Wonderlivet official profile photos', () => {
  it.each(Object.keys(WONDERLIVET_PROFILES))(
    'extracts only the fresh official portrait from %s',
    (page) => {
      expect(
        wonderlivetProfileImageUrl(
          html(page, images[page]),
          page,
          config(page),
        )?.toString(),
      ).toBe(images[page]);
    },
  );

  it.each(Object.keys(WONDERLIVET_PROFILES))(
    'requires the exact festival, source URL, and performer for %s',
    (page) => {
      const body = html(page, images[page]);
      expect(wonderlivetProfileFor(page, config(page))).not.toBeNull();
      for (const wrong of [
        { seed: 'other' },
        { festivalSourceUrl: 'https://www.wonderli.vet/home' },
        { artistName: 'other' },
      ])
        expect(
          wonderlivetProfileImageUrl(body, page, {
            ...config(page),
            ...wrong,
          }),
        ).toBeNull();
      expect(
        wonderlivetProfileImageUrl(body, page + 'other', config(page)),
      ).toBeNull();
    },
  );

  it('rejects swapped identities, duplicate portraits, off-host URLs, and query URLs', () => {
    for (const page of Object.keys(WONDERLIVET_PROFILES)) {
      const body = html(page, images[page]);
      expect(
        wonderlivetProfileImageUrl(
          body.replace(WONDERLIVET_PROFILES[page].pageName, 'other'),
          page,
          config(page),
        ),
      ).toBeNull();
      for (const image of [
        images[page].replace(new URL(images[page]).hostname, 'evil.example'),
        images[page] + '?version=2',
        images[page].replace('https:', 'http:'),
      ])
        expect(
          wonderlivetProfileImageUrl(html(page, image), page, config(page)),
        ).toBeNull();
      expect(
        wonderlivetProfileImageUrl(
          body + html(page, images[page]),
          page,
          config(page),
        ),
      ).toBeNull();
    }
  });

  it('rejects unscoped gallery images and oversized pages', () => {
    const page = poclanos[0];
    expect(
      wonderlivetProfileImageUrl(
        html(page, images[page]).replace('artist-img-wrap', 'album-cover'),
        page,
        config(page),
      ),
    ).toBeNull();
    expect(
      wonderlivetProfileImageUrl('x'.repeat(2_000_001), page, config(page)),
    ).toBeNull();
  });

  it('publishes only registered page, artist and image-origin pairs', () => {
    for (const [page, profile] of Object.entries(WONDERLIVET_PROFILES)) {
      expect(WONDERLIVET_PUBLIC_IMAGE_SQL).toContain(`source.url = '${page}'`);
      expect(WONDERLIVET_PUBLIC_IMAGE_SQL).toContain(
        `source."parserConfig"->>'artistName' = '${profile.artistName}'`,
      );
      const allowed = new RegExp(
        WONDERLIVET_PUBLIC_IMAGE_SQL.match(
          new RegExp(
            `source\\.url = '${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]*?image\\."originUrl" ~\\* '([^']+)'`,
          ),
        )?.[1] ?? '',
        'i',
      );
      expect(allowed.test(images[page])).toBe(true);
      expect(allowed.test(images[page] + '?v=2')).toBe(false);
    }
  });
});
