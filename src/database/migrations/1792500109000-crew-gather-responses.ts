import { MigrationInterface, QueryRunner } from 'typeorm';

/** 모여! 요청별 크루원 응답(going·ack)을 저장한다. 모여 기록이 지워지면 함께 지운다. */
export class CrewGatherResponses1792500109000 implements MigrationInterface {
  name = 'CrewGatherResponses1792500109000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crew_gather_responses" (
        "gatherId" uuid NOT NULL REFERENCES "crew_gathers"("id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "response" varchar(8) NOT NULL CHECK ("response" IN ('going', 'ack')),
        "respondedAt" timestamptz NOT NULL,
        CONSTRAINT "PK_crew_gather_responses" PRIMARY KEY ("gatherId", "userId")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "crew_gather_responses"`);
  }
}
