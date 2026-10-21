import { MigrationInterface, QueryRunner } from 'typeorm';

export class FestivalNotifications1792500018000 implements MigrationInterface {
  name = 'FestivalNotifications1792500018000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "devices" ADD "apnsEnvironment" varchar(10)`,
    );
    await queryRunner.query(`ALTER TABLE "devices" ADD CONSTRAINT "CHK_devices_apnsEnvironment"
      CHECK ("apnsEnvironment" IS NULL OR "apnsEnvironment" IN ('sandbox', 'production'))`);
    await queryRunner.query(`ALTER TABLE "device_subscriptions"
      ADD "festivalStarts" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`CREATE INDEX "IDX_device_subscriptions_festival_starts"
      ON "device_subscriptions"("festivalId") WHERE "festivalStarts" = true`);
    await queryRunner.query(`CREATE TABLE "notification_deliveries" (
      "id" uuid PRIMARY KEY,
      "deviceId" uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
      "festivalId" varchar(32) NOT NULL REFERENCES "admin_festivals"("id") ON DELETE CASCADE,
      "eventKey" varchar(96) NOT NULL,
      "scheduledAt" timestamptz NOT NULL,
      "status" varchar(12) NOT NULL DEFAULT 'pending',
      "attempts" integer NOT NULL DEFAULT 0,
      "nextAttemptAt" timestamptz NOT NULL,
      "leaseUntil" timestamptz,
      "sentAt" timestamptz,
      "lastErrorCode" varchar(128),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_notification_deliveries_status"
        CHECK ("status" IN ('pending', 'leased', 'sent', 'cancelled', 'failed')),
      CONSTRAINT "UQ_notification_deliveries_device_event"
        UNIQUE ("deviceId", "eventKey")
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_notification_deliveries_due"
      ON "notification_deliveries"("nextAttemptAt", "leaseUntil")
      WHERE "status" IN ('pending', 'leased')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "notification_deliveries"');
    await queryRunner.query(
      'DROP INDEX "IDX_device_subscriptions_festival_starts"',
    );
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" DROP COLUMN "festivalStarts"',
    );
    await queryRunner.query(
      'ALTER TABLE "devices" DROP CONSTRAINT "CHK_devices_apnsEnvironment"',
    );
    await queryRunner.query(
      'ALTER TABLE "devices" DROP COLUMN "apnsEnvironment"',
    );
  }
}
