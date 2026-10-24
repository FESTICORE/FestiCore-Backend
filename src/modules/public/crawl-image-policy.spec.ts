import { PUBLIC_CRAWL_IMAGE_SQL } from './crawl-image-policy';
import {
  CDF_PROFILES,
  CDF_PUBLIC_IMAGE_SQL,
} from '../admin/crawl/service/cdf-profile';

describe('public crawl image policy', () => {
  it('honors a timetable source image opt-out before the verified-image check', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      `source."parserConfig"->>'publicSourceImage' IS DISTINCT FROM 'false'`,
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toMatch(
      /source\.kind = 'timetable'[\s\S]*publicSourceImage[\s\S]*revision\.status = 'verified'/,
    );
  });

  it('limits Wonderlivet images to the official child source and its exact validated image path', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.url = 'https://www.wonderli.vet/api/trpc/lineup.list'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'festivalSourceUrl' = 'https://www.wonderli.vet/lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toMatch(
      /official-wonderlivet-lineup'[\s\S]*image\."originUrl" =\s*'https:\/\/mcnqglozya2x8j6x\.public\.blob\.vercel-storage\.com' \|\|/,
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toMatch(
      /gallery\.kind = 'artist-gallery'[\s\S]*gallery\.enabled = true[\s\S]*gallery\.url = source\.url/,
    );
  });

  it('limits GMF artist photos to its active official gallery and exact S3 image path', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'official-gmf-lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.url = 'https://www.mintpaper.co.kr/festivals/172/lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'festivalSourceUrl' = 'https://mintpaper.co.kr/festivals/172'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "gallery.\"parserConfig\"->>'seed' = 'gmf-official-lineup'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "'https://mintpaper.s3.ap-northeast-2.amazonaws.com' ||",
    );
  });

  it('publishes CDF photos only from their reviewed profile and image origin', () => {
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(
      "source.\"parserConfig\"->>'seed' IS DISTINCT FROM 'cdf-official-profile'",
    );
    expect(PUBLIC_CRAWL_IMAGE_SQL).toContain(CDF_PUBLIC_IMAGE_SQL);
    const clauses = [
      ...CDF_PUBLIC_IMAGE_SQL.matchAll(
        /\(source\.url = '([^']+)' AND source\."parserConfig"->>'artistName' = '([^']+)' AND source\."parserConfig"->>'officialHandle' = '([^']+)' AND image\."originUrl" ~\* '([^']+)'\)/g,
      ),
    ];
    expect(clauses).toHaveLength(Object.keys(CDF_PROFILES).length);
    for (const [
      ,
      pageUrl,
      artistName,
      officialHandle,
      originPattern,
    ] of clauses) {
      const profile = CDF_PROFILES[pageUrl];
      expect(artistName).toBe(profile.artistName);
      expect(officialHandle).toBe(profile.officialHandle);
      const allowed = new RegExp(originPattern, 'i');
      const example =
        'https://' +
        profile.imageHost +
        (profile.rule === 'kardi'
          ? '/_next/static/media/group.abc.webp'
          : profile.rule === 'onewe'
            ? '/img/artist/ARTIST_ONEWE_202608.jpg?1'
            : profile.rule === 'axmxp' || profile.rule === 'ftisland'
              ? '/files/2026/08/06/abcdef.jpg'
              : profile.rule === 'solutions'
                ? '/thumbnails/uploadedFiles/123/default/image_123_2500.jpg'
                : profile.rule === 'idiotape'
                  ? '/wp-content/uploads/2026/08/profile.jpg'
                  : '/drmvsn/wp-content/uploads/2026/08/profile.jpg');
      expect(allowed.test(example)).toBe(true);
      expect(
        allowed.test(example.replace(profile.imageHost, 'evil.example')),
      ).toBe(false);
      expect(allowed.test(example + '?volatile=1')).toBe(false);
    }
  });
});
