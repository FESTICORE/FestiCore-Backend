import { MigrationInterface, QueryRunner } from 'typeorm';

export class Crews1792500007000 implements MigrationInterface {
  name = 'Crews1792500007000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "crews" (
        "id" varchar(32) PRIMARY KEY,
        "festivalId" varchar(32) NOT NULL REFERENCES "admin_festivals"("id") ON DELETE CASCADE,
        "name" varchar(20) NOT NULL,
        "ownerId" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "inviteCode" varchar(6) NOT NULL,
        "inviteExpiresAt" timestamptz NOT NULL,
        "archivedAt" timestamptz,
        "lastGatherAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_crews_invite_code" UNIQUE ("inviteCode")
      )`);
    await queryRunner.query(`
      CREATE TABLE "crew_members" (
        "crewId" varchar(32) NOT NULL REFERENCES "crews"("id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "festivalId" varchar(32) NOT NULL REFERENCES "admin_festivals"("id") ON DELETE CASCADE,
        "nickname" varchar(12) NOT NULL,
        "zoneId" varchar(32),
        "state" varchar(10),
        "statusUpdatedAt" timestamptz,
        "joinedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crew_members" PRIMARY KEY ("crewId", "userId"),
        CONSTRAINT "UQ_crew_members_festival_user" UNIQUE ("festivalId", "userId")
      )`);
    await queryRunner.query(`
      CREATE TABLE "crew_gathers" (
        "id" uuid PRIMARY KEY,
        "crewId" varchar(32) NOT NULL REFERENCES "crews"("id") ON DELETE CASCADE,
        "byUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "zoneId" varchar(32) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_crew_members_crew" ON "crew_members" ("crewId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_crews_festival" ON "crews" ("festivalId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "crew_gathers"`);
    await queryRunner.query(`DROP TABLE "crew_members"`);
    await queryRunner.query(`DROP TABLE "crews"`);
  }
}
