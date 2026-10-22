import { MigrationInterface, QueryRunner } from 'typeorm';

const URL =
  'https://ticket.melon.com/search/index.htm?q=%ED%8E%98%EC%8A%A4%ED%8B%B0%EB%B2%8C';
const KOREAN_URL = 'https://ticket.melon.com/search/index.htm?q=페스티벌';
const SEED = 'melon-festival-search';

export class MelonFestivalSearch1792500031000 implements MigrationInterface {
  name = 'MelonFestivalSearch1792500031000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'discovery', $1::varchar, 'ticket-list', jsonb_build_object('seed', $3::text), now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" IN ($1, $2))`,
      [URL, KOREAN_URL, SEED],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET "enabled" = false, "status" = 'disabled', "updatedAt" = now()
       WHERE "url" IN ($1, $2) AND "kind" = 'discovery'
         AND "parserConfig"->>'seed' = $3`,
      [URL, KOREAN_URL, SEED],
    );
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" IN ($1, $2) AND "kind" = 'discovery'
       AND "parserConfig"->>'seed' = $3
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [URL, KOREAN_URL, SEED],
    );
  }
}
