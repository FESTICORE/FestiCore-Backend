import sharp from 'sharp';
import {
  discoverImageUrls,
  prepareCrawlImage,
  selectRunImages,
} from './crawl-image';

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

  it('uses the Melon festival candidates for poster downloads and rotates them across days', () => {
    const page = 'https://ticket.melon.com/search/index.htm?q=페스티벌';
    const rows = Array.from(
      { length: 9 },
      (_, index) =>
        `<tr><td><img src="https://cdnticket.melon.co.kr/resource/image/upload/product/${index}.jpg"></td><td><a href="/performance/index.htm?prodId=${1000 + index}" class="show_title">2026 지역 페스티벌 ${index}</a></td><td class="show_date">2026.12.25 - 2026.12.26</td></tr>`,
    ).join('');
    const nonFestival = `<tr><td><img src="https://cdnticket.melon.co.kr/resource/image/upload/product/concert.jpg"></td><td><a href="/performance/index.htm?prodId=2000" class="show_title">클로버 뮤직 스테이션</a></td><td class="show_date">2026.12.25</td></tr>`;
    const noDate = `<tr><td><img src="https://cdnticket.melon.co.kr/resource/image/upload/product/undated.jpg"></td><td><a href="/performance/index.htm?prodId=2001" class="show_title">날짜 없는 페스티벌</a></td></tr>`;
    const unsafeImage = `<tr><td><img src="https://evil.example/poster.jpg"></td><td><a href="/performance/index.htm?prodId=2002" class="show_title">포스터 없는 페스티벌</a></td><td class="show_date">2026.12.25</td></tr>`;
    const html = `<img src="https://cdnticket.melon.co.kr/resource/image/web/common/logo.png">${rows}${nonFestival}${noDate}${unsafeImage}`;
    const urls = discoverImageUrls(html, page);
    expect(urls).toHaveLength(9);
    expect(urls.every((url) => url.pathname.includes('/upload/product/'))).toBe(
      true,
    );
    expect(urls.map(String)).not.toContain(
      'https://cdnticket.melon.co.kr/resource/image/upload/product/concert.jpg',
    );
    const first = selectRunImages(urls, page, '2026-10-21').map(String);
    const second = selectRunImages(urls, page, '2026-10-22').map(String);
    expect(first).toHaveLength(8);
    expect(second).toHaveLength(8);
    expect(second).not.toEqual(first);
    expect(new Set([...first, ...second]).size).toBe(9);
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

  it('selects only YES24 detail poster from structured data', () => {
    const html = `<script type="application/ld+json">{"@type":"Organization"}</script><script type="application/ld+json">{"@type":"Event","image":"https://tkfile.yes24.com/upload2/PerfBlog/cdf.jpg"}</script><img src="https://evil.example/a.jpg">`;
    expect(
      discoverImageUrls(html, 'https://ticket.yes24.com/Perf/60590').map(
        String,
      ),
    ).toEqual(['https://tkfile.yes24.com/upload2/PerfBlog/cdf.jpg']);
  });

  it('limits each Melon detail run and rotates artist images across days', () => {
    const urls = Array.from(
      { length: 22 },
      (_, index) => new URL(`https://cdnimg.melon.co.kr/${index}.jpg`),
    );
    const page = 'https://ticket.melon.com/performance/index.htm?prodId=213793';
    const first = selectRunImages(urls, page, '2026-10-21');
    const second = selectRunImages(urls, page, '2026-10-22');
    expect(first).toHaveLength(8);
    expect(second).toHaveLength(8);
    expect(first[0]).toBe(urls[0]);
    expect(second[0]).toBe(urls[0]);
    expect(second.slice(1).map(String)).not.toEqual(first.slice(1).map(String));
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
