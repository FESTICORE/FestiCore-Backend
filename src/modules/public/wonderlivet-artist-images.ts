// Curated from the artists' own sites and their official label profiles.
// Keep names aligned with the Melon detail lineup. These URLs are copied to
// crawl_images by the existing image pipeline; the public API serves WebP only.
export const WONDERLIVET_ARTIST_IMAGES: Readonly<Record<string, string>> = {
  'CHiCO with HoneyWorks':
    'https://www.chicoxxx.com/assets/img/kv/img_kv_cwhw_1.jpg',
  'Suisei Hoshimachi':
    'https://hololive.hololivepro.com/wp-content/uploads/2020/06/Hoshimachi-Suisei_megane_01.png',
  Humbreaders:
    'https://humbreaders.com/wp/wp-content/uploads/2016/04/DSC0626-266.jpg',
  Chevon: 'https://img.imageimg.net/artist/Chevon/img/profile.jpg',
  'Brandy Senki':
    'https://brandysenki.com/common/images/artist_image004_r0qfkaf9zvuqt1wzijefbv5sl5vbg0yb.jpg',
  'Conton Candy':
    'https://d1rjcmiyngzjnh.cloudfront.net/prod/public/fcopen/contents/information/1558/ff2f9fea8257084cc4dae13791a53c0f.jpeg',
  'CLAN QUEEN': 'https://www.clanqueen.jp/assets/img/img_kv_sp_2603.jpg',
};

export const WONDERLIVET_MELON_DETAIL_URL =
  'https://ticket.melon.com/performance/index.htm?prodId=213793';

export function officialWonderlivetArtistImage(
  festivalSourceUrl: string,
  artist: string,
): string | undefined {
  return festivalSourceUrl === WONDERLIVET_MELON_DETAIL_URL
    ? WONDERLIVET_ARTIST_IMAGES[artist]
    : undefined;
}
