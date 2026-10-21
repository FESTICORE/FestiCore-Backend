import { MigrationInterface, QueryRunner } from 'typeorm';

export class Devices1792500017000 implements MigrationInterface {
  name = 'Devices1792500017000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "devices" (
      "id" uuid PRIMARY KEY,
      "userId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
      "deviceSecretHash" varchar(64) NOT NULL,
      "apnsToken" varchar(256),
      "liveActivityPushToStartToken" varchar(256),
      "appVersion" varchar(32) NOT NULL,
      "osVersion" varchar(64) NOT NULL,
      "locale" varchar(35) NOT NULL,
      "timezone" varchar(64) NOT NULL,
      "liveActivityFestivalId" varchar(32),
      "liveActivityId" varchar(128),
      "liveActivityPushToken" varchar(256),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE "device_subscriptions" (
      "deviceId" uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
      "festivalId" varchar(32) NOT NULL REFERENCES "admin_festivals"("id") ON DELETE CASCADE,
      "packUpdates" boolean NOT NULL,
      PRIMARY KEY ("deviceId", "festivalId")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_devices_userId" ON "devices"("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_devices_liveActivityFestivalId" ON "devices"("liveActivityFestivalId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "device_subscriptions"');
    await queryRunner.query('DROP TABLE "devices"');
  }
}
