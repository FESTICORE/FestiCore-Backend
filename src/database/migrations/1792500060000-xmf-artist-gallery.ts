import { MigrationInterface, QueryRunner } from 'typeorm';

// This seed identifies the official page and festival only. Artists and image
// locations are discovered from the page at run time.
export class XmfArtistGallery1792500060000 implements MigrationInterface {
  name = 'XmfArtistGallery1792500060000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO crawl_sources (kind, url, parser, "parserConfig", "createdAt")
       SELECT 'artist-gallery', $1, 'html-text',
         jsonb_build_object('seed', 'xmf-official-gallery', 'festivalSourceUrl', $2::text),
         now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources
         WHERE kind = 'artist-gallery' AND url = $1
           AND "parserConfig"->>'festivalSourceUrl' = $2
       )`,
      [
        'https://xmfestival.com/lineup',
        'https://ticket.melon.com/performance/index.htm?prodId=213766',
      ],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source
       WHERE source.kind = 'artist-gallery'
         AND source.url = $1
         AND source."parserConfig"->>'seed' = 'xmf-official-gallery'
         AND NOT EXISTS (
           SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id
         )`,
      ['https://xmfestival.com/lineup'],
    );
  }
}
