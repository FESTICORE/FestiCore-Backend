import { MigrationInterface, QueryRunner } from 'typeorm';

export class NolWorldLineupEvidence1792500088000 implements MigrationInterface {
  name = 'NolWorldLineupEvidence1792500088000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE crawl_runs ADD COLUMN "lineupEvidence" jsonb',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE crawl_runs DROP COLUMN "lineupEvidence"',
    );
  }
}
