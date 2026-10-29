import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrawlArtistImageReviews1792500094000 implements MigrationInterface {
  name = 'CrawlArtistImageReviews1792500094000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE crawl_images ADD COLUMN "originalSha256" varchar(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE crawl_runs ADD COLUMN "artistImageRightsEvidence" jsonb`,
    );
    await queryRunner.query(`CREATE TABLE crawl_artist_image_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "sourceId" uuid NOT NULL REFERENCES crawl_sources(id) ON DELETE CASCADE,
      "imageId" uuid REFERENCES crawl_images(id) ON DELETE SET NULL,
      "festivalId" varchar(32) NOT NULL,
      "festivalSourceUrl" varchar(2048) NOT NULL,
      "artistName" varchar(160) NOT NULL,
      "fileId" integer NOT NULL CHECK ("fileId" > 0),
      "filePageUrl" varchar(2048) NOT NULL,
      "officialEvidenceUrl" varchar(2048) NOT NULL,
      "discoveryRunId" uuid NOT NULL REFERENCES crawl_runs(id),
      "preparedRunId" uuid REFERENCES crawl_runs(id),
      "approvedRunId" uuid REFERENCES crawl_runs(id),
      author varchar(500) NOT NULL,
      license varchar(16) NOT NULL,
      "licenseUrl" varchar(100) NOT NULL,
      "originalSha256" varchar(64),
      status varchar(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'revoked')),
      "reviewedBy" uuid,
      "reviewedAt" timestamptz,
      "revokedBy" uuid,
      "revokedAt" timestamptz,
      "verifiedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_crawl_artist_image_review_source" ON crawl_artist_image_reviews ("sourceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_crawl_artist_image_review_target" ON crawl_artist_image_reviews ("festivalId", "festivalSourceUrl", "artistName", status)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_crawl_artist_image_review_image" ON crawl_artist_image_reviews ("imageId", status)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_crawl_artist_image_review_active_target" ON crawl_artist_image_reviews ("festivalId", "festivalSourceUrl", "artistName") WHERE status IN ('pending', 'approved')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE crawl_artist_image_reviews');
    await queryRunner.query(
      `ALTER TABLE crawl_runs DROP COLUMN "artistImageRightsEvidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE crawl_images DROP COLUMN "originalSha256"`,
    );
  }
}
