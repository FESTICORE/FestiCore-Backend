import { MigrationInterface, QueryRunner } from 'typeorm';

export class LiveActivityDeliveries1792500064000 implements MigrationInterface {
  name = 'LiveActivityDeliveries1792500064000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "live_activity_deliveries" (
      "deviceId" uuid PRIMARY KEY REFERENCES "devices"("id") ON DELETE CASCADE,
      "revision" bigint NOT NULL DEFAULT 1,
      "active" boolean NOT NULL DEFAULT true,
      "status" varchar(10) NOT NULL DEFAULT 'pending',
      "leaseId" uuid,
      "leaseUntil" timestamptz,
      "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
      "lastAttemptAt" timestamptz,
      "attempts" integer NOT NULL DEFAULT 0,
      "lastErrorCode" varchar(128),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_live_activity_status" CHECK ("status" IN ('pending', 'leased', 'idle', 'failed'))
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_live_activity_due"
      ON "live_activity_deliveries"("nextAttemptAt", "deviceId")
      WHERE "active" = true AND "status" IN ('pending', 'leased')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "live_activity_deliveries"');
  }
}
