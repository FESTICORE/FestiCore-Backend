import { MigrationInterface, QueryRunner } from 'typeorm';

const profiles = [
  [
    'https://drdr.ac/wordpress/wp-json/wp/v2/posts/50',
    '혁오',
    'https://mintpaper.co.kr/festivals/178',
  ],
  [
    'https://drdr.ac/wordpress/wp-json/wp/v2/posts/1475',
    'OYSTERS',
    'https://mintpaper.co.kr/festivals/178',
  ],
  [
    'https://drdr.ac/wordpress/wp-json/wp/v2/posts/1539',
    'The Shepherd Bois',
    'https://www.wonderli.vet/lineup',
  ],
] as const;

export class DrdrOfficialProfiles1792500069000 implements MigrationInterface {
  name = 'DrdrOfficialProfiles1792500069000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [url, artistName, festivalSourceUrl] of profiles) {
      await queryRunner.query(
        `INSERT INTO crawl_sources
           (kind, url, parser, "parserConfig", "intervalMinutes", "createdAt")
         SELECT 'artist-image', $1::text, 'html-text',
           jsonb_build_object('seed', 'drdr-official-profile',
             'festivalSourceUrl', $2::text, 'artistName', $3::text),
           1440, now() - interval '1 day'
         WHERE NOT EXISTS (
           SELECT 1 FROM crawl_sources
           WHERE kind = 'artist-image' AND url = $1::text
             AND "parserConfig"->>'festivalSourceUrl' = $2::text
             AND "parserConfig"->>'artistName' = $3::text
         )`,
        [url, festivalSourceUrl, artistName],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [url, artistName, festivalSourceUrl] of profiles) {
      await queryRunner.query(
        `DELETE FROM crawl_sources source
         WHERE source.kind = 'artist-image' AND source.url = $1
           AND source."parserConfig"->>'seed' = 'drdr-official-profile'
           AND source."parserConfig"->>'festivalSourceUrl' = $2
           AND source."parserConfig"->>'artistName' = $3
           AND NOT EXISTS (
             SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id
           )`,
        [url, festivalSourceUrl, artistName],
      );
    }
  }
}
