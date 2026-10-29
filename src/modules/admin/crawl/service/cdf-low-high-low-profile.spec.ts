import {
  CDF_LOW_HIGH_LOW_PROFILE_SEED,
  CDF_LOW_HIGH_LOW_PROFILE_URL,
  CDF_LOW_HIGH_LOW_PUBLIC_IMAGE_SQL,
  cdfLowHighLowProfileFor,
  cdfLowHighLowProfileImageUrl,
} from './cdf-low-high-low-profile';
import { CDF_FESTIVAL_URL } from './cdf-profile';

const image =
  'https://cdnimg.melon.co.kr/cm2/artistcrop/images/027/54/370/2754370_20250307154851.jpg';
const config = {
  seed: CDF_LOW_HIGH_LOW_PROFILE_SEED,
  festivalSourceUrl: CDF_FESTIVAL_URL,
  artistName: '로우하이로우',
  artistAlias: 'LOW HIGH LOW',
};
const html = `<div class="wrap_artist_profile"><div class="box_artist_profile">
  <div class="box_artist_thumb"><img src="${image}" alt="로우하이로우"></div>
  <div class="box_artist_txt"><p class="tit_artist">로우하이로우</p></div>
  </div></div><!--//wrap_artist_profile -->`;

describe('CDF LOW HIGH LOW official Melon Ticket profile', () => {
  it('reads the current photo only from the exact artist profile block', () => {
    expect(
      cdfLowHighLowProfileImageUrl(html, CDF_LOW_HIGH_LOW_PROFILE_URL, config),
    ).toEqual(new URL(image));
    expect(cdfLowHighLowProfileFor(CDF_LOW_HIGH_LOW_PROFILE_URL, config)).toBe(
      true,
    );
  });

  it('does not accept a different artist, festival, image, or page', () => {
    expect(
      cdfLowHighLowProfileImageUrl(html, CDF_LOW_HIGH_LOW_PROFILE_URL, {
        ...config,
        artistAlias: 'Other',
      }),
    ).toBeNull();
    expect(
      cdfLowHighLowProfileImageUrl(html, CDF_LOW_HIGH_LOW_PROFILE_URL, {
        ...config,
        festivalSourceUrl: 'https://mintpaper.co.kr/festivals/172',
      }),
    ).toBeNull();
    expect(
      cdfLowHighLowProfileImageUrl(
        html,
        'https://ticket.melon.com/artist/index.htm?artistId=9999999',
        config,
      ),
    ).toBeNull();
    expect(
      cdfLowHighLowProfileImageUrl(
        html.replace('alt="로우하이로우"', 'alt="다른 가수"'),
        CDF_LOW_HIGH_LOW_PROFILE_URL,
        config,
      ),
    ).toBeNull();
    expect(
      cdfLowHighLowProfileImageUrl(
        html.replace('2754370_20250307154851', '9999999_20250307154851'),
        CDF_LOW_HIGH_LOW_PROFILE_URL,
        config,
      ),
    ).toBeNull();
  });

  it('does not expose a forged public image origin', () => {
    expect(CDF_LOW_HIGH_LOW_PUBLIC_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'artistAlias' = 'LOW HIGH LOW'",
    );
    expect(CDF_LOW_HIGH_LOW_PUBLIC_IMAGE_SQL).toContain(
      'cdnimg[.]melon[.]co[.]kr/cm2/artistcrop/images/027/54/370/2754370_',
    );
  });
});
