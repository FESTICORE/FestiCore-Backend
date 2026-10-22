import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserOnboarding1792500032000 implements MigrationInterface {
  name = 'UserOnboarding1792500032000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "nicknameConfirmed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "termsVersion" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "pushOptIn" boolean NOT NULL DEFAULT false`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "pushOptIn"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "termsVersion"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "termsAcceptedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "nicknameConfirmed"`,
    );
  }
}
