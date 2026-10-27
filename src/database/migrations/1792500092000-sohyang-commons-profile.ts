import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  SOHYANG_COMMONS_ARTIST,
  SOHYANG_COMMONS_PAGE,
  SOHYANG_COMMONS_SEED,
  SOHYANG_FESTIVAL_URL,
} from '../../modules/admin/crawl/service/sohyang-commons-profile';

export class SohyangCommonsProfile1792500092000 implements MigrationInterface {
  name = 'SohyangCommonsProfile1792500092000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      SOHYANG_COMMONS_PAGE,
      SOHYANG_FESTIVAL_URL,
      SOHYANG_COMMONS_ARTIST,
      SOHYANG_COMMONS_SEED,
    ];
    const conflicts = (await queryRunner.query(
      `SELECT id FROM crawl_sources
       WHERE kind = 'artist-image'
         AND "parserConfig"->>'festivalSourceUrl' = $2::text
         AND "parserConfig"->>'artistName' = $3::text
         AND (enabled = false OR url IS DISTINCT FROM $1::text
           OR "parserConfig"->>'seed' IS DISTINCT FROM $4::text)
       LIMIT 1`,
      values,
    )) as { id: string }[];
    if (conflicts.length)
      throw new Error('소향 Commons 사진과 충돌하거나 비활성화된 기존 소스');

    await queryRunner.query(
      `INSERT INTO crawl_sources
         (kind, url, parser, "parserConfig", "intervalMinutes", "createdAt")
       SELECT 'artist-image', $1::text, 'html-text',
         jsonb_build_object('seed', $4::text,
           'festivalSourceUrl', $2::text, 'artistName', $3::text),
         1440, now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources
         WHERE kind = 'artist-image' AND url = $1::text
           AND "parserConfig"->>'festivalSourceUrl' = $2::text
           AND "parserConfig"->>'artistName' = $3::text
           AND "parserConfig"->>'seed' = $4::text
       )`,
      values,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source
       WHERE source.kind = 'artist-image' AND source.url = $1::text
         AND source."parserConfig"->>'festivalSourceUrl' = $2::text
         AND source."parserConfig"->>'artistName' = $3::text
         AND source."parserConfig"->>'seed' = $4::text
         AND NOT EXISTS (
           SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id
         )`,
      [
        SOHYANG_COMMONS_PAGE,
        SOHYANG_FESTIVAL_URL,
        SOHYANG_COMMONS_ARTIST,
        SOHYANG_COMMONS_SEED,
      ],
    );
  }
}
