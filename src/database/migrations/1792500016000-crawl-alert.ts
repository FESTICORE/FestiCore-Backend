import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrawlAlert1792500016000 implements MigrationInterface {
  name = 'CrawlAlert1792500016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE crawl_alerts (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "sourceId" uuid NOT NULL REFERENCES crawl_sources("id") ON DELETE CASCADE,
      "runId" uuid NOT NULL UNIQUE REFERENCES crawl_runs("id") ON DELETE CASCADE,
      "reason" varchar(1000) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "acknowledgedAt" timestamptz,
      "acknowledgedBy" uuid REFERENCES admin_accounts("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_crawl_alerts_created" ON crawl_alerts ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_crawl_alerts_open" ON crawl_alerts ("createdAt" DESC) WHERE "acknowledgedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE crawl_alerts');
  }
}
