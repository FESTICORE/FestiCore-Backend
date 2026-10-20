import { MigrationInterface, QueryRunner } from 'typeorm';

export class OauthClientId1792500004100 implements MigrationInterface {
  name = 'OauthClientId1792500004100';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oauthClientId" varchar',
    );
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oauthWebRefreshToken" varchar',
    );
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oauthWebClientId" varchar',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "oauthClientId"',
    );
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "oauthWebRefreshToken"',
    );
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "oauthWebClientId"',
    );
  }
}
