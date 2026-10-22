import { MigrationInterface, QueryRunner } from 'typeorm';

const URL = 'https://ticket.melon.com/search/index.htm?q=festival';

export class MelonEnglishFestivalSearch1792500034000 implements MigrationInterface {
  name = 'MelonEnglishFestivalSearch1792500034000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', '{}', now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [URL],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [URL],
    );
  }
}
