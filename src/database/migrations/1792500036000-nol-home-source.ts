import { MigrationInterface, QueryRunner } from 'typeorm';

const NOL_HOME = 'https://nol.yanolja.com/ticket';

export class NolHomeSource1792500036000 implements MigrationInterface {
  name = 'NolHomeSource1792500036000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = true, "status" = 'ok', "consecutiveFailures" = 0, "updatedAt" = now()
       WHERE "kind" = 'discovery' AND "url" = $1`,
      [NOL_HOME],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = false, "status" = 'disabled', "updatedAt" = now()
       WHERE "kind" = 'discovery' AND "url" = $1`,
      [NOL_HOME],
    );
  }
}
