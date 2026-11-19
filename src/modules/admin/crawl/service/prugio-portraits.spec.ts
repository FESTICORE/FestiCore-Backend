import sharp from 'sharp';
import {
  extractPrugioPortraits,
  PRUGIO_PORTRAIT_PAGE_URL,
  PRUGIO_PORTRAIT_SEED,
  prugioPortraitConfig,
  prugioPortraitPosterUrl,
} from './prugio-portraits';
import { PRUGIO_LINEUP_URL } from './prugio-lineup';

const poster =
  'https://cdnticket.melon.co.kr/resource/image/upload/product/2026/09/202609151527360f625a0a-b2d5-498d-8057-caaaf49f3fed.jpg';
const config = {
  seed: PRUGIO_PORTRAIT_SEED,
  festivalSourceUrl: PRUGIO_LINEUP_URL,
};

async function image() {
  const overlays = [
    { top: 6383, color: { r: 110, g: 40, b: 40, alpha: 1 } },
    { top: 6552, color: { r: 40, g: 40, b: 110, alpha: 1 } },
  ];
  return sharp({
    create: {
      width: 700,
      height: 10324,
      channels: 3,
      background: 'white',
    },
  })
    .composite(
      overlays.map((entry) => ({
        input: {
          create: {
            width: 150,
            height: 150,
            channels: 4,
            background: entry.color,
          },
        },
        left: 94,
        top: entry.top,
      })),
    )
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('Prugio official portrait source', () => {
  it('accepts only the bound Melon page and roster source', () => {
    expect(prugioPortraitConfig(PRUGIO_PORTRAIT_PAGE_URL, config, false)).toBe(
      true,
    );
    expect(
      prugioPortraitConfig(
        PRUGIO_PORTRAIT_PAGE_URL,
        { ...config, artistName: '권혁우' },
        true,
      ),
    ).toBe(true);
    expect(
      prugioPortraitConfig(
        PRUGIO_PORTRAIT_PAGE_URL,
        { ...config, imageHint: '/other.jpg' },
        false,
      ),
    ).toBe(false);
    expect(
      prugioPortraitConfig(
        'https://evil.test/performance/index.htm?prodId=213868',
        config,
        false,
      ),
    ).toBe(false);
  });

  it('extracts one official portrait poster URL from the current detail page', () => {
    const page = `<title>제 4회 푸르지오아트홀 뮤직페스티벌</title><div class="box_img_content">
      <img src="https://cdnticket.melon.co.kr/resource/image/upload/product/2024/06/old.png/melon/quality/90/optimize">
      <img src="${poster}/melon/quality/90/optimize"></div>`;
    expect(prugioPortraitPosterUrl(page)?.href).toBe(poster);
    expect(
      prugioPortraitPosterUrl(
        page.replace(
          poster,
          poster.replace('cdnticket.melon.co.kr', 'evil.test'),
        ),
      ),
    ).toBeNull();
    expect(
      prugioPortraitPosterUrl(
        page.replace(
          '</div>',
          `<img src="${poster}/melon/quality/90/optimize"></div>`,
        ),
      ),
    ).toBeNull();
  });

  it('uses OCR names and nearby pixel photo boxes, independent of artist order', async () => {
    const bytes = await image();
    const results = ['권 혁우 | 베 이 스 바 리 톤', '김 인 영 | 소 프 라 노'];
    const portraits = await extractPrugioPortraits(
      bytes,
      ['김인영', '권혁우'],
      () => Promise.resolve(results.shift() ?? ''),
    );
    expect(portraits.map((item) => item.artistName)).toEqual([
      '김인영',
      '권혁우',
    ]);
    const colors = await Promise.all(
      portraits.map(async (item) => {
        const { data } = await sharp(item.body)
          .extract({ left: 75, top: 75, width: 1, height: 1 })
          .raw()
          .toBuffer({ resolveWithObject: true });
        return [...data];
      }),
    );
    expect(colors[0][2]).toBeGreaterThan(colors[0][0]);
    expect(colors[1][0]).toBeGreaterThan(colors[1][2]);
  });

  it('refuses a missing name, duplicate OCR name, or missing adjacent photo', async () => {
    const bytes = await image();
    await expect(
      extractPrugioPortraits(bytes, ['권혁우'], () => Promise.resolve('')),
    ).rejects.toThrow('0/1');
    await expect(
      extractPrugioPortraits(bytes, ['권혁우'], () =>
        Promise.resolve('권 혁우 | 베이스바리톤'),
      ),
    ).rejects.toThrow('중복');
    await expect(
      extractPrugioPortraits(bytes, ['김인영', '권혁우'], () =>
        Promise.resolve('다른 이름 | 소프라노'),
      ),
    ).rejects.toThrow('0/2');
  });

  it('tries a second adjacent crop only when the first OCR result is not an exact roster name', async () => {
    const results = [
      '글 언선 | 소프라노',
      '권 혁우 | 베이스바리톤',
      '김 인 영 | 소프라노',
    ];
    const portraits = await extractPrugioPortraits(
      await image(),
      ['권혁우', '김인영'],
      () => Promise.resolve(results.shift() ?? ''),
    );
    expect(portraits).toHaveLength(2);
    expect(results).toHaveLength(0);
  });
});
