import { MigrationInterface, QueryRunner } from 'typeorm';

export class FlagStatusClientAt1792500102000 implements MigrationInterface {
  name = 'FlagStatusClientAt1792500102000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 이전 clientAt은 저장된 적이 없어 백필할 값이 없다. null이면 첫 변경을 오래됨 검사 없이 받는다.
    await queryRunner.query(
      'ALTER TABLE flags ADD COLUMN "statusClientAt" timestamptz',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE flags DROP COLUMN "statusClientAt"');
  }
}
