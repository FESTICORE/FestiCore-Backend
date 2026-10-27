import { MigrationInterface, QueryRunner } from 'typeorm';

const lineupUrl = 'https://www.wonderli.vet/lineup';

export class WonderlivetPublicBundleLineup1792500090000 implements MigrationInterface {
  name = 'WonderlivetPublicBundleLineup1792500090000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources
         (kind, url, parser, "parserConfig", enabled, status, "createdAt")
       SELECT 'artist-gallery', $1::text, 'html-text',
         jsonb_build_object('seed', 'wonderlivet-official-lineup',
           'festivalSourceUrl', $1::text), true, 'ok', now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources WHERE kind = 'artist-gallery' AND url = $1::text
           AND "parserConfig"->>'seed' = 'wonderlivet-official-lineup'
           AND "parserConfig"->>'festivalSourceUrl' = $1::text
       )`,
      [lineupUrl],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source WHERE source.kind = 'artist-gallery'
         AND source.url = $1::text
         AND "parserConfig"->>'seed' = 'wonderlivet-official-lineup'
         AND "parserConfig"->>'festivalSourceUrl' = $1::text
         AND NOT EXISTS (SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id)`,
      [lineupUrl],
    );
  }
}
