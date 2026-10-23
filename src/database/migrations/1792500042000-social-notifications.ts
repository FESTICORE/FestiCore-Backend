import { MigrationInterface, QueryRunner } from 'typeorm';

export class SocialNotifications1792500042000 implements MigrationInterface {
  name = 'SocialNotifications1792500042000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "social_notification_deliveries" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "deviceId" uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
      "recipientUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "type" varchar(20) NOT NULL,
      "subjectId" varchar(32) NOT NULL,
      "actorUserId" uuid NOT NULL,
      "eventKey" varchar(128) NOT NULL,
      "payload" jsonb NOT NULL,
      "status" varchar(12) NOT NULL DEFAULT 'pending',
      "attempts" integer NOT NULL DEFAULT 0,
      "nextAttemptAt" timestamptz NOT NULL,
      "leaseUntil" timestamptz,
      "sentAt" timestamptz,
      "lastErrorCode" varchar(128),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_social_notification_type" CHECK ("type" IN ('flag.status', 'crew.status', 'crew.gather')),
      CONSTRAINT "CHK_social_notification_status" CHECK ("status" IN ('pending', 'leased', 'sent', 'cancelled', 'failed')),
      CONSTRAINT "UQ_social_notification_device_event" UNIQUE ("deviceId", "eventKey")
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_social_notification_due"
      ON "social_notification_deliveries"("nextAttemptAt", "leaseUntil")
      WHERE "status" IN ('pending', 'leased')`);
    await queryRunner.query(`CREATE INDEX "IDX_social_notification_merge"
      ON "social_notification_deliveries"("type", "subjectId", "deviceId", "createdAt" DESC)
      WHERE "status" = 'pending'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "social_notification_deliveries"');
  }
}
