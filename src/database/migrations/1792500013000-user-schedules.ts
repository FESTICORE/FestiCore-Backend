import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserSchedules1792500013000 implements MigrationInterface {
  name = 'UserSchedules1792500013000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_schedules" (
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "festivalId" varchar(32) NOT NULL REFERENCES "admin_festivals"("id") ON DELETE CASCADE,
        "setIds" jsonb NOT NULL,
        "clientAt" timestamptz NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_schedules" PRIMARY KEY ("userId", "festivalId")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "user_schedules"');
  }
}
