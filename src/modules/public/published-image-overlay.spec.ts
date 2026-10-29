import {
  overlayPublishedImages,
  PublicImageRow,
  storedImageId,
} from './published-image-overlay';

const festivalId = 'fst_12345678';
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const image = (id: string) => `/api/v1/festivals/images/${id}.webp`;

describe('stored public image ID', () => {
  it('accepts only lowercase canonical UUID paths', () => {
    expect(storedImageId(image(a))).toBe(a);
    expect(storedImageId(image('-'.repeat(36)))).toBeNull();
    expect(storedImageId(image('00000000000040008000000000000001'))).toBeNull();
    expect(
      storedImageId(
        image('abcdefab-cdef-4abc-8def-abcdefabcdef'.toUpperCase()),
      ),
    ).toBeNull();
  });
});

function row(id: string, name: string, run: string): PublicImageRow {
  return {
    id,
    seed: 'commons-approved-profile',
    artistName: name,
    reviewFestivalId: festivalId,
    festivalSourceUrl:
      'https://ticket.melon.com/performance/index.htm?prodId=213769',
    author: `${name} 사진가`,
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
    rightsRunId: run,
  };
}

describe('published image rights overlay', () => {
  const pack = {
    id: festivalId,
    packVersion: 4,
    artists: [
      { name: '가수 A', imageUrl: null },
      { name: '가수 B', imageUrl: null },
    ],
    sets: [{ artist: '가수 A', imageUrl: null }],
    timetable: [{ artist: '가수 B', imageUrl: null }],
  };

  it('attaches each reviewed image and its own credit throughout the published pack', () => {
    const result = overlayPublishedImages(pack, festivalId, [
      row(a, '가수 A', 'run-1'),
      row(b, '가수 B', 'run-2'),
    ]);
    const credit = (name: string) => ({
      author: `${name} 사진가`,
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
      changes: 'WebP 변환',
    });
    expect(result.document.artists).toEqual([
      { name: '가수 A', imageUrl: image(a), imageCredit: credit('가수 A') },
      { name: '가수 B', imageUrl: image(b), imageCredit: credit('가수 B') },
    ]);
    expect(result.document.sets).toEqual([
      { artist: '가수 A', imageUrl: image(a), imageCredit: credit('가수 A') },
    ]);
    expect(result.document.timetable).toEqual([
      { artist: '가수 B', imageUrl: image(b), imageCredit: credit('가수 B') },
    ]);
  });

  it('removes a cached photo and changes ETag after the latest rights run fails or expires', () => {
    const cached = {
      ...pack,
      sets: [{ artist: '가수 A', imageUrl: image(a) }],
    };
    const valid = overlayPublishedImages(cached, festivalId, [
      row(a, '가수 A', 'run-1'),
    ]);
    const invalid = overlayPublishedImages(cached, festivalId, []);
    expect(valid.document.sets).toEqual([
      expect.objectContaining({ imageUrl: image(a) }),
    ]);
    expect(invalid.document.sets).toEqual([
      expect.objectContaining({ imageUrl: null }),
    ]);
    expect(JSON.stringify(invalid.document)).not.toContain('imageCredit');
    expect(invalid.etag).not.toBe(valid.etag);
  });

  it('nulls malformed internal thumbnails and preserves external thumbnails', () => {
    const malformed = overlayPublishedImages(
      { ...pack, thumbUrl: image('-'.repeat(36)) },
      festivalId,
      [],
    );
    const externalUrl = 'https://festival.example.com/poster.webp';
    const external = overlayPublishedImages(
      { ...pack, thumbUrl: externalUrl },
      festivalId,
      [],
    );

    expect(malformed.document.thumbUrl).toBeNull();
    expect(external.document.thumbUrl).toBe(externalUrl);
  });

  it('does not attach ambiguous reviews or photos approved for another festival', () => {
    const other = {
      ...row(a, '가수 A', 'run-1'),
      reviewFestivalId: 'fst_other',
    };
    const result = overlayPublishedImages(pack, festivalId, [
      row(a, '가수 A', 'run-1'),
      row(b, '가수 A', 'run-2'),
      other,
    ]);
    expect(result.document.artists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '가수 A', imageUrl: null }),
      ]),
    );
  });
});
