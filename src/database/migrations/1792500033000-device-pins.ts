import { MigrationInterface, QueryRunner } from 'typeorm';

export class DevicePins1792500033000 implements MigrationInterface {
  name = 'DevicePins1792500033000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "devices" ADD COLUMN "deviceTokenId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" ADD COLUMN "pinned" boolean NOT NULL DEFAULT false',
    );
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" ADD COLUMN "reminders" boolean NOT NULL DEFAULT true',
    );
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" ADD COLUMN "pinnedAt" timestamptz',
    );
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" ADD COLUMN "packDownloadedVersion" integer',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_device_subscriptions_reminder" ON "device_subscriptions"("festivalId") WHERE "pinned" = true AND "reminders" = true',
    );
    await queryRunner.query(
      'CREATE TABLE "device_subscription_rate_limits" ("deviceId" uuid NOT NULL, "minute" bigint NOT NULL, "count" integer NOT NULL, CONSTRAINT "PK_device_subscription_rate_limits" PRIMARY KEY ("deviceId", "minute"))',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "device_subscription_rate_limits"');
    await queryRunner.query('DROP INDEX "IDX_device_subscriptions_reminder"');
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" DROP COLUMN "packDownloadedVersion"',
    );
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" DROP COLUMN "pinnedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" DROP COLUMN "reminders"',
    );
    await queryRunner.query(
      'ALTER TABLE "device_subscriptions" DROP COLUMN "pinned"',
    );
    await queryRunner.query(
      'ALTER TABLE "devices" DROP COLUMN "deviceTokenId"',
    );
  }
}
