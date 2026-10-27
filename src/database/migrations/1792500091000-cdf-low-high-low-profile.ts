import { MigrationInterface, QueryRunner } from 'typeorm';
import { CDF_FESTIVAL_URL } from '../../modules/admin/crawl/service/cdf-profile';
import {
  CDF_LOW_HIGH_LOW_PROFILE_SEED,
  CDF_LOW_HIGH_LOW_PROFILE_URL,
} from '../../modules/admin/crawl/service/cdf-low-high-low-profile';

const ARTIST = '로우하이로우';
const FESTIVAL_ARTIST = 'LOW HIGH LOW';

export class CdfLowHighLowProfile1792500091000 implements MigrationInterface {
  name = 'CdfLowHighLowProfile1792500091000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      CDF_LOW_HIGH_LOW_PROFILE_URL,
      CDF_FESTIVAL_URL,
      ARTIST,
      FESTIVAL_ARTIST,
      CDF_LOW_HIGH_LOW_PROFILE_SEED,
    ];
    const conflicts = (await queryRunner.query(
      `SELECT id FROM crawl_sources
       WHERE kind = 'artist-image'
         AND "parserConfig"->>'festivalSourceUrl' = $2::text
         AND ("parserConfig"->>'artistName' IN ($3::text, $4::text)
           OR "parserConfig"->>'artistAlias' IN ($3::text, $4::text))
         AND (enabled = false OR url IS DISTINCT FROM $1::text
           OR "parserConfig"->>'seed' IS DISTINCT FROM $5::text
           OR "parserConfig"->>'artistName' IS DISTINCT FROM $3::text
           OR "parserConfig"->>'artistAlias' IS DISTINCT FROM $4::text)
       LIMIT 1`,
      values,
    )) as { id: string }[];
    if (conflicts.length)
      throw new Error(
        'CDF 로우하이로우 사진과 충돌하거나 비활성화된 기존 소스',
      );

    await queryRunner.query(
      `INSERT INTO crawl_sources
         (kind, url, parser, "parserConfig", "intervalMinutes", "createdAt")
       SELECT 'artist-image', $1::text, 'html-text',
         jsonb_build_object('seed', $5::text,
           'festivalSourceUrl', $2::text, 'artistName', $3::text,
           'artistAlias', $4::text),
         1440, now() - interval '1 day'
       WHERE NOT EXISTS (
         SELECT 1 FROM crawl_sources
         WHERE kind = 'artist-image' AND url = $1::text
           AND "parserConfig"->>'festivalSourceUrl' = $2::text
           AND "parserConfig"->>'artistName' = $3::text
           AND "parserConfig"->>'artistAlias' = $4::text
           AND "parserConfig"->>'seed' = $5::text
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
         AND source."parserConfig"->>'artistAlias' = $4::text
         AND source."parserConfig"->>'seed' = $5::text
         AND NOT EXISTS (
           SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id
         )`,
      [
        CDF_LOW_HIGH_LOW_PROFILE_URL,
        CDF_FESTIVAL_URL,
        ARTIST,
        FESTIVAL_ARTIST,
        CDF_LOW_HIGH_LOW_PROFILE_SEED,
      ],
    );
  }
}
