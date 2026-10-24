import { MigrationInterface, QueryRunner } from 'typeorm';

const XMF_NOTICE = 'https://xmfestival.com/notice';

export class XmfNoticeExpectedYear1792500061000 implements MigrationInterface {
  name = 'XmfNoticeExpectedYear1792500061000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources
       SET "parserConfig" = "parserConfig" || '{"expectedYear":"2026"}'::jsonb
       WHERE kind = 'discovery' AND url = $1
         AND "parserConfig"->>'seed' = 'official-lineup'`,
      [XMF_NOTICE],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources
       SET "parserConfig" = "parserConfig" - 'expectedYear'
       WHERE kind = 'discovery' AND url = $1
         AND "parserConfig"->>'seed' = 'official-lineup'
         AND "parserConfig"->>'expectedYear' = '2026'`,
      [XMF_NOTICE],
    );
  }
}
