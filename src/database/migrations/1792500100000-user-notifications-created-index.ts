import { MigrationInterface, QueryRunner } from 'typeorm';

/** 30일 보존 정리 작업이 사용자와 무관하게 오래된 행을 찾도록 한다. */
export class UserNotificationsCreatedIndex1792500100000 implements MigrationInterface {
  name = 'UserNotificationsCreatedIndex1792500100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_user_notifications_created"
      ON "user_notifications" ("createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_user_notifications_created"');
  }
}
