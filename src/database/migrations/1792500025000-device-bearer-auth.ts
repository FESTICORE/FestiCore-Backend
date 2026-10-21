import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeviceBearerAuth1792500025000 implements MigrationInterface {
  name = 'DeviceBearerAuth1792500025000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "devices" DROP COLUMN "deviceSecretHash"',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "devices" ADD COLUMN "deviceSecretHash" varchar(64)',
    );
  }
}
