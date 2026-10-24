import { MigrationInterface, QueryRunner } from 'typeorm';

// Only the official endpoint and festival are seeded. Artist names and images
// come from a validated live response at crawl time. The source stays disabled
// while the official robots.txt disallows /api and the endpoint returns 500.
export class WonderlivetOfficialLineup1792500067000 implements MigrationInterface {
  name = 'WonderlivetOfficialLineup1792500067000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", enabled, status, "createdAt")
       SELECT 'artist-gallery', $1::text, 'html-text',
         jsonb_build_object('seed', 'wonderlivet-official-lineup',
           'festivalSourceUrl', $2::text), false, 'disabled', now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources WHERE kind = 'artist-gallery' AND url = $1::text
           AND "parserConfig"->>'festivalSourceUrl' = $2::text
       )`,
      [
        'https://www.wonderli.vet/api/trpc/lineup.list',
        'https://www.wonderli.vet/lineup',
      ],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source
       WHERE source.kind = 'artist-gallery'
         AND source.url = $1::text
         AND source."parserConfig"->>'seed' = 'wonderlivet-official-lineup'
         AND NOT EXISTS (SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id)`,
      ['https://www.wonderli.vet/api/trpc/lineup.list'],
    );
  }
}
