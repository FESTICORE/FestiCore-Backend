import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrawlTimetableRevisions1792500039000 implements MigrationInterface {
  name = 'CrawlTimetableRevisions1792500039000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE crawl_timetable_revisions (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "sourceId" uuid NOT NULL REFERENCES crawl_sources("id"),
      "runId" uuid NOT NULL REFERENCES crawl_runs("id"),
      "festivalSourceUrl" varchar(2048) NOT NULL,
      "sourceUrl" varchar(2048) NOT NULL,
      "imageId" uuid REFERENCES crawl_images("id"),
      "contentHash" varchar(64) NOT NULL,
      "parserHash" varchar(64) NOT NULL,
      "sets" jsonb NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'pending'
        CHECK ("status" IN ('pending', 'verified', 'rejected')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "verifiedAt" timestamptz,
      "verifiedBy" uuid REFERENCES admin_accounts("id"),
      CONSTRAINT "CHK_crawl_timetable_verified" CHECK
        ("status" <> 'verified' OR "verifiedAt" IS NOT NULL)
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_crawl_timetable_source_content"
      ON crawl_timetable_revisions ("sourceId", "contentHash", "parserHash")`);
    await queryRunner.query(`CREATE INDEX "IDX_crawl_timetable_public"
      ON crawl_timetable_revisions ("festivalSourceUrl", "verifiedAt" DESC, "createdAt" DESC)
      WHERE "status" = 'verified'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE crawl_timetable_revisions');
  }
}
