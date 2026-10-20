import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminCrawlImages1792500015000 implements MigrationInterface {
  name = 'AdminCrawlImages1792500015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS crawl_images (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "sourceId" uuid NOT NULL REFERENCES crawl_sources("id"),
      "runId" uuid NOT NULL REFERENCES crawl_runs("id"),
      "originUrl" varchar(2048) NOT NULL,
      "urlHash" varchar(64) NOT NULL,
      "contentHash" varchar(64) NOT NULL,
      "objectKey" varchar(75) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "lastSeenAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_crawl_images_source_url_content"
      ON crawl_images ("sourceId", "urlHash", "contentHash")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crawl_images_run" ON crawl_images ("runId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS crawl_images`);
  }
}
