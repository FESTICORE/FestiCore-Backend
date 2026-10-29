import { QueryRunner } from 'typeorm';
import { CrawlArtistImageReviews1792500094000 } from './1792500094000-crawl-artist-image-reviews';

describe('Commons artist image review schema', () => {
  it('pins review decisions to source, discovery, stored image, and original bytes', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new CrawlArtistImageReviews1792500094000().up({
      query,
    } as unknown as QueryRunner);
    const ddl = query.mock.calls.map(([sql]: [string]) => sql).join('\n');
    expect(ddl).toContain('crawl_images ADD COLUMN "originalSha256"');
    expect(ddl).toContain('crawl_runs ADD COLUMN "artistImageRightsEvidence"');
    expect(ddl).toContain(
      '"discoveryRunId" uuid NOT NULL REFERENCES crawl_runs(id)',
    );
    expect(ddl).toContain('"imageId" uuid REFERENCES crawl_images(id)');
    expect(ddl).toContain('"approvedRunId" uuid REFERENCES crawl_runs(id)');
    expect(ddl).toContain("WHERE status IN ('pending', 'approved')");
  });
});
