import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PRUGIO_PROFILE_ARTIST,
  PRUGIO_PROFILE_SEED,
  PRUGIO_PROFILE_URL,
} from '../../modules/admin/crawl/service/prugio-profile';
import { PRUGIO_LINEUP_URL } from '../../modules/admin/crawl/service/prugio-lineup';

export class PrugioOfficialProfile1792500084000 implements MigrationInterface {
  name = 'PrugioOfficialProfile1792500084000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      PRUGIO_PROFILE_URL,
      PRUGIO_LINEUP_URL,
      PRUGIO_PROFILE_ARTIST,
      PRUGIO_PROFILE_SEED,
    ];
    const conflicts = (await queryRunner.query(
      `SELECT id FROM crawl_sources
       WHERE kind = 'artist-image' AND enabled = true
         AND "parserConfig"->>'festivalSourceUrl' = $2
         AND "parserConfig"->>'artistName' = $3
         AND (url IS DISTINCT FROM $1 OR
           "parserConfig"->>'seed' IS DISTINCT FROM $4)
       LIMIT 1`,
      values,
    )) as { id: string }[];
    if (conflicts.length)
      throw new Error('푸르지오 서운정 프로필과 충돌하는 기존 소스');

    const disabled = (await queryRunner.query(
      `SELECT id FROM crawl_sources
       WHERE kind = 'artist-image' AND enabled = false
         AND "parserConfig"->>'festivalSourceUrl' = $1
         AND "parserConfig"->>'artistName' = $2
       LIMIT 1`,
      [PRUGIO_LINEUP_URL, PRUGIO_PROFILE_ARTIST],
    )) as { id: string }[];
    if (disabled.length)
      throw new Error('비활성 서운정 프로필 소스를 먼저 검토해야 합니다.');

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
       )`,
      values,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM crawl_sources source
       WHERE source.kind = 'artist-image' AND source.url = $1
         AND source."parserConfig"->>'festivalSourceUrl' = $2
         AND source."parserConfig"->>'artistName' = $3
         AND source."parserConfig"->>'seed' = $4
         AND NOT EXISTS (
           SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id
         )`,
      [
        PRUGIO_PROFILE_URL,
        PRUGIO_LINEUP_URL,
        PRUGIO_PROFILE_ARTIST,
        PRUGIO_PROFILE_SEED,
      ],
    );
  }
}
