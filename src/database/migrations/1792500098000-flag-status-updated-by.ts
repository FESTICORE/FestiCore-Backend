import { MigrationInterface, QueryRunner } from 'typeorm';

export class FlagStatusUpdatedBy1792500098000 implements MigrationInterface {
  name = 'FlagStatusUpdatedBy1792500098000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE flags ADD COLUMN "statusUpdatedBy" uuid',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE flags DROP COLUMN "statusUpdatedBy"');
  }
}
