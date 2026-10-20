import { MigrationInterface, QueryRunner } from 'typeorm';

export class FlagPhotoStorage1792500010000 implements MigrationInterface {
  name = 'FlagPhotoStorage1792500010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "flags" ADD "photoKey" varchar`);
    await queryRunner.query(`ALTER TABLE "flags" ADD "thumbKey" varchar`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "flags" DROP COLUMN "thumbKey"`);
    await queryRunner.query(`ALTER TABLE "flags" DROP COLUMN "photoKey"`);
  }
}
