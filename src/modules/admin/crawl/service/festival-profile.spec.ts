import {
  FESTIVAL_PROFILES,
  FESTIVAL_PROFILE_SEED,
  FESTIVAL_PUBLIC_IMAGE_SQL,
  festivalProfileFor,
  festivalProfileImageUrl,
} from './festival-profile';

const seoul =
  'https://poclanos.com/artist/%EC%B6%94%EB%8B%A4%ED%98%9C%EC%B0%A8%EC%A7%80%EC%8A%A4/';
const oneway = 'https://www.levistance.com/about';
const hisplan = 'https://www.inhisplan.com/';
const poclanosImage =
  'https://poclanos.com/drmvsn/wp-content/uploads/2026/10/new-group-photo.jpeg';
const levistanceImage =
  'https://images.squarespace-cdn.com/content/v1/6752a80810127d336fce8328/2c2c201c-2ce0-49ee-84eb-db4fba1c8f4b/new-group-photo.jpeg';
const hisplanImage =
  'https://www.inhisplan.com/assets/photo/promo/new-team-photo.jpg';

function config(page: string) {
  const profile = FESTIVAL_PROFILES[page];
  return {
    seed: FESTIVAL_PROFILE_SEED,
    festivalSourceUrl: profile.festivalSourceUrl,
    artistName: profile.artistName,
  };
}

function html(page: string, image: string) {
  if (page === seoul)
    return `<title>추다혜차지스 | POCLANOS</title><main class="site-main artist-single"><span class="artist-img-wrap"><img src="${image}"></span><div class="album-icons"><img src="https://poclanos.com/album.jpg"></div><h1 class="page-title">추다혜차지스</h1></main>`;
  if (page === hisplan)
    return `<title>HISPLAN | 히스플랜</title><p>히스플랜은 노래로 하나님을 노래하는 사람들.</p><img alt="다른 사진" src="https://www.inhisplan.com/assets/photo/other.jpg"><div class="promo-photo-banner"><img src="${image}" alt="히스플랜 팀"><div class="promo-photo-fade"></div></div>`;
  const photo = `<img data-sqsp-image-block-image data-src="${image}" src="${image}">`;
  return `<title>About &mdash; LEVISTANCE</title><img src="https://images.squarespace-cdn.com/logo.png"><section data-test="page-section">${photo}${photo}<p><strong>WE ARE LEVISTANCE.</strong></p><p><strong>안녕하세요 레비스탕스입니다.</strong></p></section><section data-test="page-section"><img src="https://images.squarespace-cdn.com/other.jpg"></section>`;
}

describe('Seoul Music and Oneway official profile photos', () => {
  it.each([
    [seoul, poclanosImage],
    [oneway, levistanceImage],
    [hisplan, hisplanImage],
  ])('extracts a fresh official group photo for %s', (page, image) => {
    expect(
      festivalProfileImageUrl(
        html(page, image),
        page,
        config(page),
      )?.toString(),
    ).toBe(image);
  });

  it.each([seoul, oneway, hisplan])(
    'requires registered page, festival and saved artist identity for %s',
    (page) => {
      const image =
        page === seoul
          ? poclanosImage
          : page === oneway
            ? levistanceImage
            : hisplanImage;
      const body = html(page, image);
      expect(festivalProfileFor(page, config(page))).not.toBeNull();
      for (const wrong of [
        { seed: 'other' },
        { festivalSourceUrl: 'https://example.com/festival' },
        { artistName: 'other' },
      ])
        expect(
          festivalProfileImageUrl(body, page, { ...config(page), ...wrong }),
        ).toBeNull();
      expect(
        festivalProfileImageUrl(body, page + 'other', config(page)),
      ).toBeNull();
    },
  );

  it('retains the Seoul lineup spelling while checking the official H1 spelling', () => {
    expect(FESTIVAL_PROFILES[seoul].artistName).toBe('추다해차지스');
    expect(FESTIVAL_PROFILES[seoul].festivalSourceUrl).toBe(
      'https://ticket.yes24.com/Perf/60368',
    );
    expect(FESTIVAL_PROFILES[seoul].pageName).toBe('추다혜차지스');
    expect(
      festivalProfileImageUrl(
        html(seoul, poclanosImage).replace(
          '<h1 class="page-title">추다혜차지스</h1>',
          '<h1 class="page-title">추다해차지스</h1>',
        ),
        seoul,
        config(seoul),
      ),
    ).toBeNull();
  });

  it.each([seoul, oneway, hisplan])(
    'rejects off-host, non-HTTPS and query image URLs for %s',
    (page) => {
      const image =
        page === seoul
          ? poclanosImage
          : page === oneway
            ? levistanceImage
            : hisplanImage;
      for (const wrong of [
        image.replace(new URL(image).hostname, 'evil.example'),
        image.replace('https:', 'http:'),
        image + '?format=1000w',
        image.replace(/\/([^/]+)$/, '/other/path/$1'),
      ])
        expect(
          festivalProfileImageUrl(html(page, wrong), page, config(page)),
        ).toBeNull();
    },
  );

  it('rejects missing group identity, extra group images and unrelated pictures', () => {
    expect(
      festivalProfileImageUrl(
        html(oneway, levistanceImage).replace(
          '안녕하세요 레비스탕스입니다.',
          '다른 그룹입니다.',
        ),
        oneway,
        config(oneway),
      ),
    ).toBeNull();
    expect(
      festivalProfileImageUrl(
        html(oneway, levistanceImage).replace(
          '</section>',
          `<img data-sqsp-image-block-image src="${levistanceImage.replace('new-group-photo', 'other-photo')}"></section>`,
        ),
        oneway,
        config(oneway),
      ),
    ).toBeNull();
    expect(
      festivalProfileImageUrl(
        html(seoul, poclanosImage).replace('artist-img-wrap', 'album-cover'),
        seoul,
        config(seoul),
      ),
    ).toBeNull();
    expect(
      festivalProfileImageUrl(
        html(hisplan, hisplanImage).replace(
          'alt="히스플랜 팀"',
          'alt="다른 팀"',
        ),
        hisplan,
        config(hisplan),
      ),
    ).toBeNull();
    expect(
      festivalProfileImageUrl(
        html(hisplan, hisplanImage).replace(
          'HISPLAN | 히스플랜',
          'HISPLAN | 다른 팀',
        ),
        hisplan,
        config(hisplan),
      ),
    ).toBeNull();
    expect(
      festivalProfileImageUrl('x'.repeat(2_000_001), oneway, config(oneway)),
    ).toBeNull();
  });

  it('limits public photo origins to each page, festival, artist and image path', () => {
    for (const [page, image] of [
      [seoul, poclanosImage],
      [oneway, levistanceImage],
      [hisplan, hisplanImage],
    ]) {
      const profile = FESTIVAL_PROFILES[page];
      expect(FESTIVAL_PUBLIC_IMAGE_SQL).toContain(`source.url = '${page}'`);
      expect(FESTIVAL_PUBLIC_IMAGE_SQL).toContain(
        `source."parserConfig"->>'festivalSourceUrl' = '${profile.festivalSourceUrl}'`,
      );
      expect(FESTIVAL_PUBLIC_IMAGE_SQL).toContain(
        `source."parserConfig"->>'artistName' = '${profile.artistName}'`,
      );
      const origin = FESTIVAL_PUBLIC_IMAGE_SQL.match(
        new RegExp(
          `source\\.url = '${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]*?image\\."originUrl" ~\\* '([^']+)'`,
        ),
      )?.[1];
      expect(origin).toBeDefined();
      expect(new RegExp(origin!, 'i').test(image)).toBe(true);
      expect(new RegExp(origin!, 'i').test(image + '?format=1000w')).toBe(
        false,
      );
    }
  });
});
