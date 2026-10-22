import { MigrationInterface, QueryRunner } from 'typeorm';

export class Metrics1792500019000 implements MigrationInterface {
  name = 'Metrics1792500019000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "metric_events" (
      "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      "deviceId" uuid NOT NULL,
      "festivalId" varchar(32),
      "name" varchar(32) NOT NULL,
      "at" timestamptz NOT NULL,
      "value" double precision,
      "props" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "receivedAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_metric_events_festival_at"
      ON "metric_events"("festivalId", "at")`);
    await queryRunner.query(`CREATE INDEX "IDX_metric_events_received_at"
      ON "metric_events"("receivedAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_flag_follows_festival_followed"
      ON "flag_follows"("festivalId", "followedAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_crew_members_festival_joined"
      ON "crew_members"("festivalId", "joinedAt")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_crew_members_festival_joined"');
    await queryRunner.query('DROP INDEX "IDX_flag_follows_festival_followed"');
    await queryRunner.query('DROP TABLE "metric_events"');
  }
}
