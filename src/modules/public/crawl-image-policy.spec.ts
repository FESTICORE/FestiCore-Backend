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
});
