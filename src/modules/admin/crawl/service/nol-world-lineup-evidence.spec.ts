import sharp from 'sharp';
import {
  collectNolWorldLineupEvidence,
  nolWorldDetailImageUrls,
  NOL_LINEUP_PARSER_VERSION,
} from './nol-world-lineup-evidence';

const page = 'https://world.nol.com/en/ticket/products/26013510';
const image =
  'https://ticketimage.interpark.com/Play/image/etc/26/26013510-e01.jpg';
const image2 =
  'https://ticketimage.interpark.com/Play/image/etc/26/26013510-e03.jpg';
const tsv = (word: string) =>
  `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t20\t40\t15\t95\t${word}`;

describe('NOL World private lineup evidence', () => {
  it('selects at most three official images tied to the same product', () => {
    const html = `<img src="${image}"><img src="${image}">
      <img src="https://ticketimage.interpark.com/Play/image/etc/26/26013511-e01.jpg">
      <img src="https://evil.example/Play/image/etc/26/26013510-e01.jpg">
      <script>"${image2.replaceAll('/', '\\/')}"</script>
      <img src="https://ticketimage.interpark.com/Play/image/etc/26/26013510-e04.png">
      <img src="https://ticketimage.interpark.com/Play/image/etc/26/26013510-e05.png">`;
    expect(nolWorldDetailImageUrls(html, page).map(String)).toEqual([
      image,
      image2,
      'https://ticketimage.interpark.com/Play/image/etc/26/26013510-e04.png',
    ]);
    expect(
      nolWorldDetailImageUrls(html, 'https://world.nol.com/en/ticket'),
    ).toEqual([]);
    expect(
      nolWorldDetailImageUrls(
        html,
        'https://world.nol.com/en/ticket/products/26013511',
      ),
    ).toEqual([
      new URL(
        'https://ticketimage.interpark.com/Play/image/etc/26/26013511-e01.jpg',
      ),
    ]);
  });

  it('upgrades the official http data-original-src to HTTPS without accepting another product', () => {
    const html = `<img data-original-src="http://ticketimage.interpark.com/Play/image/etc/26/26013510-e01.jpg">
      <img data-original-src="http://ticketimage.interpark.com/Play/image/etc/26/26013511-e01.jpg">
      <img data-original-src="http://evil.example/Play/image/etc/26/26013510-e01.jpg">`;
    expect(nolWorldDetailImageUrls(html, page).map(String)).toEqual([image]);
  });

  it('keeps raw OCR lines in run evidence, reuses only matching bytes and version', async () => {
    const firstBytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const secondBytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();
    let bytes = firstBytes;
    const ocr = jest.fn().mockResolvedValue(tsv('LEE YOUNGJI'));
    const checkRobots = jest.fn().mockResolvedValue(undefined);
    const getImage = jest.fn(() =>
      Promise.resolve({
        status: 200,
        body: bytes,
        contentType: 'image/jpeg',
      }),
    );
    const collect = (
      prior: Awaited<ReturnType<typeof collectNolWorldLineupEvidence>> | null,
    ) =>
      collectNolWorldLineupEvidence(`<img src="${image}">`, page, prior, {
        checkRobots,
        getImage,
        ocr,
      });
    const first = await collect(null);
    expect(first).toEqual([
      {
        sourceUrl: page,
        imageUrl: image,
        imageHash: first[0].imageHash,
        parserVersion: NOL_LINEUP_PARSER_VERSION,
        status: 'ok',
        failureReason: null,
        rawLines: ['LEE YOUNGJI'],
      },
    ]);
    expect(first[0].imageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ocr).toHaveBeenCalledTimes(1);
    expect(await collect(first)).toEqual(first);
    expect(ocr).toHaveBeenCalledTimes(1);
    bytes = secondBytes;
    ocr.mockResolvedValue(tsv('ROY KIM'));
    const changed = await collect(first);
    expect(changed[0].rawLines).toEqual(['ROY KIM']);
    expect(changed[0].imageHash).not.toBe(first[0].imageHash);
    expect(ocr).toHaveBeenCalledTimes(2);
    await collect([{ ...changed[0], parserVersion: 'old-version' }]);
    expect(ocr).toHaveBeenCalledTimes(3);
    expect(checkRobots).toHaveBeenCalledTimes(4);
    expect(getImage).toHaveBeenCalledTimes(4);
  });

  it('records fetch, decode and OCR failures without carrying prior lines', async () => {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const html = `<img src="${image}"><img src="${image2}">`;
    const prior = [
      {
        sourceUrl: page,
        imageUrl: image,
        imageHash: 'old',
        parserVersion: NOL_LINEUP_PARSER_VERSION,
        status: 'ok' as const,
        failureReason: null,
        rawLines: ['stale'],
      },
    ];
    const results = await collectNolWorldLineupEvidence(html, page, prior, {
      checkRobots: (url) =>
        url === image2
          ? Promise.reject(new Error('disallowed'))
          : Promise.resolve(),
      getImage: () =>
        Promise.resolve({
          status: 200,
          body: bytes,
          contentType: 'image/jpeg',
        }),
      ocr: () => Promise.reject(new Error('unavailable')),
    });
    expect(results.map((item) => item.status)).toEqual(['failed', 'failed']);
    expect(results.map((item) => item.failureReason)).toEqual([
      'ocr',
      'robots',
    ]);
    expect(results.map((item) => item.rawLines)).toEqual([[], []]);
    expect(results[0].imageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(results[1].imageHash).toBeNull();
    const missing = await collectNolWorldLineupEvidence('', page, prior, {
      checkRobots: jest.fn(),
      getImage: jest.fn(),
    });
    expect(missing).toEqual([
      {
        ...prior[0],
        imageHash: null,
        status: 'failed',
        failureReason: 'missing-image',
        rawLines: [],
      },
    ]);
    expect(
      await collectNolWorldLineupEvidence('', page, null, {
        checkRobots: jest.fn(),
        getImage: jest.fn(),
      }),
    ).toEqual([]);
  });

  it('classifies network, HTTP and invalid image failures without raw errors', async () => {
    const html = `<img src="${image}">`;
    const checkRobots = () => Promise.resolve();
    const cases = [
      {
        expected: 'network',
        getImage: () => Promise.reject(new Error('private network detail')),
      },
      {
        expected: 'http',
        getImage: () =>
          Promise.resolve({
            status: 403,
            body: Buffer.alloc(0),
            contentType: 'image/jpeg',
          }),
      },
      {
        expected: 'invalid-image',
        getImage: () =>
          Promise.resolve({
            status: 200,
            body: Buffer.from('not an image'),
            contentType: 'image/jpeg',
          }),
      },
    ];
    for (const testCase of cases) {
      const result = await collectNolWorldLineupEvidence(html, page, null, {
        checkRobots,
        getImage: testCase.getImage,
      });
      expect(result[0]).toMatchObject({
        status: 'failed',
        failureReason: testCase.expected,
        rawLines: [],
      });
      expect(JSON.stringify(result)).not.toContain('private network detail');
    }
  });
});
