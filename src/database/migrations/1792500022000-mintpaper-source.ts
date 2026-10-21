import { MigrationInterface, QueryRunner } from 'typeorm';

const SOURCES = [
  'https://mintpaper.co.kr/festivals',
  'https://mintpaper.co.kr/festivals/178',
  'https://mintpaper.co.kr/festivals/172',
  'https://mintpaper.co.kr/festivals/171',
  'https://mintpaper.co.kr/festivals/170',
];

export class MintPaperSource1792500022000 implements MigrationInterface {
  name = 'MintPaperSource1792500022000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const url of SOURCES) {
      await queryRunner.query(
        `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
         SELECT 'discovery', $1::varchar, 'ticket-list', '{"seed":"mintpaper-1792500022000"}', now() - interval '1 day'
         WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
        [url],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const url of SOURCES) {
      await queryRunner.query(
        `UPDATE crawl_sources SET "enabled" = false, "status" = 'disabled', "updatedAt" = now()
         WHERE "url" = $1 AND "kind" = 'discovery'
           AND "parserConfig"->>'seed' = 'mintpaper-1792500022000'`,
        [url],
      );
      await queryRunner.query(
        `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'discovery'
         AND "parserConfig"->>'seed' = 'mintpaper-1792500022000'
         AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_proposals WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
         AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
        [url],
      );
    }
  }
}
