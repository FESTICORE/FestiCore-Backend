import {
  officialWonderlivetArtistImage,
  WONDERLIVET_ARTIST_IMAGES,
  WONDERLIVET_MELON_DETAIL_URL,
} from './wonderlivet-artist-images';

describe('WONDERLIVET official artist images', () => {
  it('covers the seven artists whose Melon detail images are placeholders', () => {
    expect(Object.keys(WONDERLIVET_ARTIST_IMAGES)).toEqual([
      'CHiCO with HoneyWorks',
      'Suisei Hoshimachi',
      'Humbreaders',
      'Chevon',
      'Brandy Senki',
      'Conton Candy',
      'CLAN QUEEN',
    ]);
    for (const name of Object.keys(WONDERLIVET_ARTIST_IMAGES)) {
      expect(
        officialWonderlivetArtistImage(WONDERLIVET_MELON_DETAIL_URL, name),
      ).toBe(WONDERLIVET_ARTIST_IMAGES[name]);
      expect(
        officialWonderlivetArtistImage(
          'https://ticket.melon.com/performance/index.htm?prodId=1',
          name,
        ),
      ).toBeUndefined();
    }
  });
});
