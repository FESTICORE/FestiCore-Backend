import { MigrationInterface, QueryRunner } from 'typeorm';

export class WithdrawalFlags1792500012000 implements MigrationInterface {
  name = 'WithdrawalFlags1792500012000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 과거에 남은 고아 소유자는 공개하지 않고 숨긴 뒤 FK를 적용한다.
    await queryRunner.query(`UPDATE "flags" AS flag
      SET "ownerId" = NULL, "hidden" = true
      WHERE flag."ownerId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id"::text = flag."ownerId"::text)`);
    await queryRunner.query(
      `ALTER TABLE "flags" ALTER COLUMN "ownerId" TYPE uuid USING "ownerId"::uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "flags" ADD CONSTRAINT "FK_flags_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "flag_status_events" DROP CONSTRAINT "FK_flag_status_events_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "flag_status_events" ALTER COLUMN "userId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "flag_status_events" ADD CONSTRAINT "FK_flag_status_events_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(`CREATE TABLE "admin_notifications" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" varchar(40) NOT NULL,
      "flagId" varchar(32),
      "festivalId" varchar(32),
      "message" varchar(200) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "readAt" timestamptz
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_notifications_unread" ON "admin_notifications" ("createdAt" DESC) WHERE "readAt" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "admin_notifications"`);
    await queryRunner.query(
      `ALTER TABLE "flags" DROP CONSTRAINT "FK_flags_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "flags" ALTER COLUMN "ownerId" TYPE varchar(36) USING "ownerId"::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "flag_status_events" DROP CONSTRAINT "FK_flag_status_events_user"`,
    );
    // 익명화된 이력은 사용자 복원이 불가능하므로 롤백 시에도 보존한다.
    // 이전 NOT NULL 제약을 다시 적용할 수 없어 nullable 컬럼을 유지한다.
    await queryRunner.query(
      `ALTER TABLE "flag_status_events" ADD CONSTRAINT "FK_flag_status_events_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }
}
