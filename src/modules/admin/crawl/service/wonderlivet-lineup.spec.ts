import {
  parseWonderlivetBundleLineup,
  wonderlivetBundleUrl,
  WONDERLIVET_IMAGE_ORIGIN,
} from './wonderlivet-lineup';

const image = (day: string, id: string) =>
  `${WONDERLIVET_IMAGE_ORIGIN}/lineup/artists/production/live/${day}/${id}.webp`;

function bundle(artists: unknown[], state = 'ready') {
  const json = JSON.stringify({
    dataState: state,
    isComingSoon: false,
    artists,
  });
  return `const a=JSON.parse('${json.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'),b=JSON.parse('{"isPublished":true,"slots":[]}')`;
}

describe('Wonderlivet public lineup bundle', () => {
  const valid = {
    id: 60,
    name: 'Act A',
    performanceDay: 'DAY1',
    imageUrl: image('day1', 'artist-60'),
  };

  it('selects exactly one same-origin versioned module asset', () => {
    expect(
      wonderlivetBundleUrl(
        '<script type="module" src="/assets/index-8xy3D9hg.js"></script>',
      ).href,
    ).toBe('https://www.wonderli.vet/assets/index-8xy3D9hg.js');
    for (const src of [
      'https://evil.example/assets/index-8xy3D9hg.js',
      '/api/trpc/lineup.list',
      '/assets/index-8xy3D9hg.js?next=1',
    ]) {
      expect(() =>
        wonderlivetBundleUrl(`<script type="module" src="${src}"></script>`),
      ).toThrow();
    }
    expect(() =>
      wonderlivetBundleUrl(
        '<script type="module" src="/assets/index-123456.js"></script><script type="module" src="/assets/index-abcdef.js"></script>',
      ),
    ).toThrow();
    expect(() => wonderlivetBundleUrl('x'.repeat(2_000_001))).toThrow();
  });

  it('pairs each official name with its own day and image without executing JavaScript', () => {
    const body =
      `/* JSON.parse('${JSON.stringify({ dataState: 'ready', artists: [valid] })}') */` +
      bundle([
        valid,
        {
          id: 61,
          name: "O'Clock",
          performanceDay: 'DAY2',
          imageUrl: image('day2', 'artist-61'),
        },
      ]);
    expect(
      parseWonderlivetBundleLineup(body).map((entry) => [
        entry.artistName,
        entry.imageUrl.href,
      ]),
    ).toEqual([
      ['Act A', valid.imageUrl],
      ["O'Clock", image('day2', 'artist-61')],
    ]);
  });

  it('fails closed on stale, duplicate, malformed, or untrusted lineup data', () => {
    for (const body of [
      bundle([valid], 'unavailable'),
      bundle([]),
      bundle([valid, valid]),
      bundle([{ ...valid, id: 61, imageUrl: image('day2', 'artist-60') }]),
      bundle([
        { ...valid, id: 61, imageUrl: 'https://evil.example/artist.webp' },
      ]),
      bundle([{ ...valid, id: undefined }]),
      `${bundle([valid])};${bundle([{ ...valid, id: 61 }])}`,
      'x'.repeat(1_000_001),
    ]) {
      expect(() => parseWonderlivetBundleLineup(body)).toThrow();
    }
  });
});
