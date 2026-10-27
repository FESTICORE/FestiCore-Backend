import {
  ONEWAY_CHANNELS,
  ONEWAY_CHANNEL_SEED,
  ONEWAY_FESTIVAL_URL,
  onewayChannelFor,
  onewayChannelImageUrl,
} from './oneway-official-channel';

const SOHYANG_PAGE = 'https://www.youtube.com/@sohyang.official';
const IMAGE =
  'https://yt3.googleusercontent.com/iRoDSnY6DV40Lo2Rwb4vY8K1v6GOQkVIGRicC8Zf4T0cRUORlsKUJ0LxzLY-J2bRIFcQts9toA8=s900-c-k-c0x00ffffff-no-rj';
const config = {
  seed: ONEWAY_CHANNEL_SEED,
  festivalSourceUrl: ONEWAY_FESTIVAL_URL,
  artistName: '소향',
};
const html = `<meta property="og:title" content="Sohyang">
  <meta property="og:url" content="https://www.youtube.com/channel/UCHEz2Bsd3REidWKYOxA8XrQ">
  <link rel="canonical" href="https://www.youtube.com/channel/UCHEz2Bsd3REidWKYOxA8XrQ">
  <meta property="og:image" content="${IMAGE}">`;

describe('OneWay official artist channel photos', () => {
  it('accepts the identified artist page and its current public channel portrait', () => {
    expect(ONEWAY_CHANNELS[SOHYANG_PAGE].artistName).toBe('소향');
    expect(onewayChannelImageUrl(html, SOHYANG_PAGE, config)?.toString()).toBe(
      IMAGE,
    );
  });

  it('binds every source to the exact festival, artist and channel', () => {
    expect(onewayChannelFor(SOHYANG_PAGE, config)).not.toBeNull();
    expect(
      onewayChannelFor(SOHYANG_PAGE, { ...config, artistName: '달빛마을' }),
    ).toBeNull();
    expect(
      onewayChannelFor(SOHYANG_PAGE, {
        ...config,
        festivalSourceUrl:
          'https://ticket.melon.com/performance/index.htm?prodId=1',
      }),
    ).toBeNull();
    expect(
      onewayChannelFor('https://www.youtube.com/@other', config),
    ).toBeNull();
  });

  it('rejects changed identities, multiple image claims and unsafe image origins', () => {
    for (const changed of [
      html.replace('content="Sohyang"', 'content="Other"'),
      html.replace('UCHEz2Bsd3REidWKYOxA8XrQ', 'UCOTHER'),
      html.replace('yt3.googleusercontent.com', 'evil.example'),
      html.replace('=s900-c-k-c0x00ffffff-no-rj', '=s900?redirect=1'),
      `${html}<meta property="og:image" content="${IMAGE}">`,
    ]) {
      expect(onewayChannelImageUrl(changed, SOHYANG_PAGE, config)).toBeNull();
    }
  });

  it('accepts the official Moonlight Village duo photo for that artist only', () => {
    const page = 'https://www.youtube.com/@moonlightv';
    const photo =
      'https://yt3.googleusercontent.com/FXXxuUzycS5PPMS8pyh9j0GFoShGJ097myAqjw0mGShwwKvNAcfgb_XVxjVqP9uQGjNIa3yv=s900-c-k-c0x00ffffff-no-rj';
    const pageHtml = `<meta content="달빛마을 (Moonlight Village)" property="og:title">
      <meta content="https://www.youtube.com/channel/UCjWYW0HlOAV3U1sjPPsT7dA" property="og:url">
      <link href="https://www.youtube.com/channel/UCjWYW0HlOAV3U1sjPPsT7dA" rel="canonical">
      <meta content="${photo}" property="og:image">`;
    expect(
      onewayChannelImageUrl(pageHtml, page, {
        ...config,
        artistName: '달빛마을',
      })?.toString(),
    ).toBe(photo);
  });
});
