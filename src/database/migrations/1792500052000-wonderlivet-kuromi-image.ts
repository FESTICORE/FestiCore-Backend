import { MigrationInterface, QueryRunner } from 'typeorm';

const SOURCE_URL = 'https://www.toysfactory.co.jp/artist/kuromi';
const CONFIG = JSON.stringify({
  festivalSourceUrl:
    'https://ticket.melon.com/performance/index.htm?prodId=213793',
  artistName: 'KUROMI',
  imageHint: '010326_Sc40BIT2jLziOe_WezkSThB82xeXRQ.jpg',
});

export class WonderlivetKuromiImage1792500052000 implements MigrationInterface {
  name = 'WonderlivetKuromiImage1792500052000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources ("kind", "url", "parser", "parserConfig", "createdAt")
       SELECT 'artist-image', $1::varchar, 'html-text', $2::jsonb, now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM crawl_sources WHERE "url" = $1)`,
      [SOURCE_URL, CONFIG],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources WHERE "url" = $1 AND "kind" = 'artist-image'
       AND NOT EXISTS (SELECT 1 FROM crawl_runs WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_images WHERE "sourceId" = crawl_sources."id")
       AND NOT EXISTS (SELECT 1 FROM crawl_alerts WHERE "sourceId" = crawl_sources."id")`,
      [SOURCE_URL],
    );
  }
}
