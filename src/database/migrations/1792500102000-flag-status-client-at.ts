import { MigrationInterface, QueryRunner } from 'typeorm';

export class FlagStatusClientAt1792500102000 implements MigrationInterface {
  name = 'FlagStatusClientAt1792500102000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE flags ADD COLUMN "statusClientAt" timestamptz',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE flags DROP COLUMN "statusClientAt"');
  }
}
