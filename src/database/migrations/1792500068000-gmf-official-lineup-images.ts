import { MigrationInterface, QueryRunner } from 'typeorm';

// The official pages supply names and image URLs at crawl time.
export class GmfOfficialLineupImages1792500068000 implements MigrationInterface {
  name = 'GmfOfficialLineupImages1792500068000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources SET
         "parserConfig" = "parserConfig" || jsonb_build_object('seed', 'gmf-official-lineup'),
         enabled = true, status = 'ok',
         "createdAt" = LEAST("createdAt", now() - interval '1 day'),
         "updatedAt" = now()
       WHERE kind = 'artist-gallery' AND url = $1::text
         AND "parserConfig"->>'festivalSourceUrl' = $2::text`,
      [
        'https://www.mintpaper.co.kr/festivals/172/lineup',
        'https://mintpaper.co.kr/festivals/172',
      ],
    );
    await queryRunner.query(
      `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", enabled, status, "createdAt")
       SELECT 'artist-gallery', $1::text, 'html-text',
         jsonb_build_object('seed', 'gmf-official-lineup',
           'festivalSourceUrl', $2::text, 'migrationSeed', '1792500068000'),
         true, 'ok', now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources WHERE kind = 'artist-gallery' AND url = $1::text
           AND "parserConfig"->>'festivalSourceUrl' = $2::text
       )`,
      [
        'https://www.mintpaper.co.kr/festivals/172/lineup',
        'https://mintpaper.co.kr/festivals/172',
      ],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source
       WHERE source.kind = 'artist-gallery'
         AND source.url = $1::text
         AND source."parserConfig"->>'seed' = 'gmf-official-lineup'
         AND source."parserConfig"->>'migrationSeed' = '1792500068000'
         AND NOT EXISTS (SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id)`,
      ['https://www.mintpaper.co.kr/festivals/172/lineup'],
    );
  }
}
