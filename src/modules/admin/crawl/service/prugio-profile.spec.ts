import {
  PRUGIO_PROFILE_ARTIST,
  PRUGIO_PROFILE_SEED,
  PRUGIO_PROFILE_URL,
  PRUGIO_PUBLIC_IMAGE_SQL,
  prugioProfileImageUrl,
} from './prugio-profile';
import { PRUGIO_LINEUP_URL } from './prugio-lineup';

const photo = 'https://www.kiffa.or.kr/images/sub/sub0504_img20.jpg';
const config = {
  seed: PRUGIO_PROFILE_SEED,
  festivalSourceUrl: PRUGIO_LINEUP_URL,
  artistName: PRUGIO_PROFILE_ARTIST,
};

const row = (name: string, occupation: string, src: string) =>
  `<li><div class="img_wrap"><img src="${src}" alt=""></div>` +
  `<div class="txt_wrap"><p>${occupation}</p><strong>${name}</strong></div></li>`;
const page = (rows: string) =>
  `<title>한국국제물류주선업협회</title><div class="con3"><h6 class="sub_tit02">홍보대사</h6><ul>${rows}</ul></div>`;

describe('KIFFA official profile for the Prugio soprano', () => {
  const body = page(
    row('배동성', '개그맨', '/images/sub/sub0504_img5.jpg') +
      row('서운정', '소프라노', '/images/sub/sub0504_img20.jpg') +
      row('신수아', '가수', '/images/sub/sub0504_img21.jpg'),
  );

  it('reads the photo beside the exact name and occupation from current HTML', () => {
    expect(
      prugioProfileImageUrl(body, PRUGIO_PROFILE_URL, config)?.toString(),
    ).toBe(photo);
    const changed = body.replace('sub0504_img20.jpg', 'sub0504_img42.jpg');
    expect(
      prugioProfileImageUrl(changed, PRUGIO_PROFILE_URL, config)?.toString(),
    ).toBe('https://www.kiffa.or.kr/images/sub/sub0504_img42.jpg');
  });

  it('rejects a different source, festival, seed or artist', () => {
    for (const [url, settings] of [
      [PRUGIO_PROFILE_URL + '/other', config],
      [PRUGIO_PROFILE_URL, { ...config, seed: 'other' }],
      [
        PRUGIO_PROFILE_URL,
        { ...config, festivalSourceUrl: 'https://other.example' },
      ],
      [PRUGIO_PROFILE_URL, { ...config, artistName: '신수아' }],
    ] as const)
      expect(prugioProfileImageUrl(body, url, settings)).toBeNull();
  });

  it('rejects identity ambiguity or a photo outside the matching row', () => {
    for (const altered of [
      body.replace('<p>소프라노</p>', '<p>가수</p>'),
      body.replace('<strong>서운정</strong>', '<strong>신수아</strong>'),
      body.replace(
        '</ul>',
        row('서운정', '소프라노', '/images/sub/sub0504_img30.jpg') + '</ul>',
      ),
      body.replace(
        '<div class="img_wrap"><img src="/images/sub/sub0504_img20.jpg" alt=""></div>',
        '<div class="other"><img src="/images/sub/sub0504_img20.jpg" alt=""></div>',
      ),
      body.replace(
        '<img src="/images/sub/sub0504_img20.jpg" alt="">',
        '<img src="/images/sub/sub0504_img20.jpg" alt=""><img src="/images/sub/sub0504_img30.jpg">',
      ),
      body.replace('<div class="con3">', '<div class="other">'),
      body.replace('홍보대사', '다른 단체'),
      body.replace('<title>한국국제물류주선업협회</title>', ''),
    ])
      expect(
        prugioProfileImageUrl(altered, PRUGIO_PROFILE_URL, config),
      ).toBeNull();
  });

  it('rejects untrusted or mutable image locations and oversized HTML', () => {
    for (const src of [
      'https://other.example/images/sub/sub0504_img20.jpg',
      'http://www.kiffa.or.kr/images/sub/sub0504_img20.jpg',
      '/images/sub/sub0504_img20.jpg?x=1',
      '/images/sub/other20.jpg',
      '//evil.example/images/sub/sub0504_img20.jpg',
    ])
      expect(
        prugioProfileImageUrl(
          page(row('서운정', '소프라노', src)),
          PRUGIO_PROFILE_URL,
          config,
        ),
      ).toBeNull();
    expect(
      prugioProfileImageUrl('x'.repeat(2_000_001), PRUGIO_PROFILE_URL, config),
    ).toBeNull();
  });

  it('limits public image provenance to the official page and saved identity', () => {
    expect(PRUGIO_PUBLIC_IMAGE_SQL).toContain(
      `source.url = '${PRUGIO_PROFILE_URL}'`,
    );
    expect(PRUGIO_PUBLIC_IMAGE_SQL).toContain(
      `source."parserConfig"->>'festivalSourceUrl' = '${PRUGIO_LINEUP_URL}'`,
    );
    expect(PRUGIO_PUBLIC_IMAGE_SQL).toContain(
      `source."parserConfig"->>'artistName' = '${PRUGIO_PROFILE_ARTIST}'`,
    );
    const origin = /image\."originUrl" ~\* '([^']+)'/.exec(
      PRUGIO_PUBLIC_IMAGE_SQL,
    )?.[1];
    expect(origin).toBeDefined();
    expect(new RegExp(origin!, 'i').test(photo)).toBe(true);
    expect(new RegExp(origin!, 'i').test(photo + '?x=1')).toBe(false);
  });
});
