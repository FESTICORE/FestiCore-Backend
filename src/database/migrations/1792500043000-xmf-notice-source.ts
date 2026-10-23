import { MigrationInterface, QueryRunner } from 'typeorm';

const XMF_NOTICE = 'https://xmfestival.com/notice';

export class XmfNoticeSource1792500043000 implements MigrationInterface {
  name = 'XmfNoticeSource1792500043000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list',
         '{"seed":"official-lineup","festivalSourceUrl":"https://ticket.melon.com/performance/index.htm?prodId=213766"}',
         now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [XMF_NOTICE],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [XMF_NOTICE],
    );
  }
}
