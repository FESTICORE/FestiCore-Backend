import sharp from 'sharp';
import { discoverImageUrls, prepareCrawlImage } from './crawl-image';

describe('crawl image safety', () => {
  it('discovers only bounded public HTTPS image candidates', () => {
    const html = `<img src="/poster.png"><img src="http://bad.example.com/x.jpg">
      <img data-src="https://cdn.example.com/photo.jpg?x=1&amp;y=2">
      <img src="https://127.0.0.1/internal"><img src="data:image/png;base64,AAAA">
      <img src="/poster.png">`;
    expect(
      discoverImageUrls(html, 'https://festival.example.com/page').map(String),
    ).toEqual([
      'https://festival.example.com/poster.png',
      'https://cdn.example.com/photo.jpg?x=1&y=2',
    ]);
  });

  it('uses only festival posters from Melon listing JSON', () => {
    const json = JSON.stringify({
      data: [
        { title: '단독 콘서트', posterImg: '/resource/image/upload/other.jpg' },
        {
          title: '서울 재즈 페스티벌',
          posterImg: '/resource/image/upload/festival.jpg',
        },
        { title: '부산 축제', posterImg: 'http://bad.example.com/poster' },
      ],
    });
    expect(
      discoverImageUrls(
        json,
        'https://ticket.melon.com/performance/ajax/prodList.json',
      ).map(String),
    ).toEqual([
      'https://cdnticket.melon.co.kr/resource/image/upload/festival.jpg',
    ]);
  });

  it('stores only referenced official Mint Paper festival covers', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          apolloState: {
            data: {
              'Festival:172': { coverImage: { __ref: 'UploadFile:cover' } },
              'UploadFile:cover': {
                url: 'https://mintpaper.s3.ap-northeast-2.amazonaws.com/gmf.jpg',
              },
              'UploadFile:other': { url: 'https://evil.example/other.jpg' },
            },
          },
        },
      },
    )}</script><img src="/images/logo.png">`;
    expect(
      discoverImageUrls(html, 'https://mintpaper.co.kr/festivals').map(String),
    ).toEqual(['https://mintpaper.s3.ap-northeast-2.amazonaws.com/gmf.jpg']);
  });

  it('normalizes a valid image to content-addressed WebP without trusting its extension', async () => {
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    const prepared = await prepareCrawlImage(png, 'image/png');
    expect(prepared.key).toMatch(/^crawl\/[0-9a-f]{64}\.webp$/);
    expect((await sharp(prepared.body).metadata()).format).toBe('webp');
    expect((await prepareCrawlImage(png, 'image/png')).key).toBe(prepared.key);
    await expect(prepareCrawlImage(png, 'image/jpeg')).rejects.toThrow(
      '디코딩',
    );
    await expect(
      prepareCrawlImage(Buffer.from('<script>x</script>'), 'image/png'),
    ).rejects.toThrow('디코딩');
  });
});
