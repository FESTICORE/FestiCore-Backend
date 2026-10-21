import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrewStatusIdempotency1792500029000 implements MigrationInterface {
  name = 'CrewStatusIdempotency1792500029000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "crew_status_idempotency" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "key" varchar(128) NOT NULL,
      "requestHash" varchar(64) NOT NULL,
      "response" jsonb NOT NULL,
      "expiresAt" timestamptz NOT NULL
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_crew_status_idempotency_user_key"
      ON "crew_status_idempotency"("userId", "key")`);
    await queryRunner.query(`CREATE INDEX "IDX_crew_status_idempotency_expires"
      ON "crew_status_idempotency"("expiresAt")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "crew_status_idempotency"');
  }
}
