import { MigrationInterface, QueryRunner } from 'typeorm';

export class LiveActivityRefreshIntents1792500068000 implements MigrationInterface {
  name = 'LiveActivityRefreshIntents1792500068000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "live_activity_refresh_intents" (
      "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      "deviceId" uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
      "activityId" varchar(128) NOT NULL,
      "festivalId" varchar(32) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_live_activity_refresh_intents_device"
      ON "live_activity_refresh_intents"("deviceId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "live_activity_refresh_intents"');
  }
}
