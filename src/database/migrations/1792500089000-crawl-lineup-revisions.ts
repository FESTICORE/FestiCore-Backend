import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrawlLineupRevisions1792500089000 implements MigrationInterface {
  name = 'CrawlLineupRevisions1792500089000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE crawl_lineup_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "sourceId" uuid NOT NULL REFERENCES crawl_sources(id) ON DELETE CASCADE,
      "runId" uuid NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      "productUrl" varchar(2048) NOT NULL,
      "imageUrl" varchar(2048) NOT NULL,
      "imageHash" varchar(64) NOT NULL,
      "parserVersion" varchar(80) NOT NULL,
      "rawLines" jsonb NOT NULL,
      artists jsonb NOT NULL DEFAULT '[]'::jsonb,
      status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "reviewedAt" timestamptz,
      "reviewedBy" uuid
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_crawl_lineup_evidence" ON crawl_lineup_revisions ("sourceId", "imageUrl", "imageHash", "parserVersion")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_crawl_lineup_public" ON crawl_lineup_revisions ("productUrl", status, "reviewedAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE crawl_lineup_revisions');
  }
}
