import { MigrationInterface, QueryRunner } from 'typeorm';

const POST_URL = 'https://www.mintpaper.co.kr/posts/4821';
const FESTIVAL_URL = 'https://mintpaper.co.kr/festivals/178';

export class OfficialNolTicketLink1792500063000 implements MigrationInterface {
  name = 'OfficialNolTicketLink1792500063000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', $2::jsonb, now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [
        POST_URL,
        JSON.stringify({
          seed: 'official-ticket-links',
          festivalSourceUrl: FESTIVAL_URL,
        }),
      ],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
         AND "parserConfig"->>'seed' = 'official-ticket-links'
         AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [POST_URL],
    );
  }
}
