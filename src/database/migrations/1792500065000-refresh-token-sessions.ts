import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefreshTokenSessions1792500065000 implements MigrationInterface {
  name = 'RefreshTokenSessions1792500065000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_token_sessions" (
        "id" uuid PRIMARY KEY,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" ADD COLUMN "sessionId" uuid`);
    // 기존 토큰은 서로 독립적인 세션으로 시작한다.
    await queryRunner.query(`
      UPDATE "refresh_tokens" SET "sessionId" = gen_random_uuid()`);
    await queryRunner.query(`
      INSERT INTO "refresh_token_sessions" ("id", "createdAt")
      SELECT "sessionId", "createdAt" FROM "refresh_tokens"`);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ALTER COLUMN "sessionId" SET NOT NULL,
      ADD CONSTRAINT "FK_refresh_tokens_session_id"
      FOREIGN KEY ("sessionId") REFERENCES "refresh_token_sessions"("id")`);
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_session_id"
      ON "refresh_tokens" ("sessionId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_refresh_tokens_session_id"`);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      DROP CONSTRAINT "FK_refresh_tokens_session_id",
      DROP COLUMN "sessionId"`);
    await queryRunner.query(`DROP TABLE "refresh_token_sessions"`);
  }
}
