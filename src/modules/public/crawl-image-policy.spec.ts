import { PUBLIC_CRAWL_IMAGE_SQL } from './crawl-image-policy';

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
});
