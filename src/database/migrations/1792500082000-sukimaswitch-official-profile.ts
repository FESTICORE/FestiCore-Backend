import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  SUKIMASWITCH_PROFILE,
  SUKIMASWITCH_PROFILE_URL,
  WONDERLIVET_PROFILE_FESTIVAL_URL,
  WONDERLIVET_PROFILE_SEED,
} from '../../modules/admin/crawl/service/wonderlivet-profile';

export class SukimaswitchOfficialProfile1792500082000 implements MigrationInterface {
  name = 'SukimaswitchOfficialProfile1792500082000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      SUKIMASWITCH_PROFILE_URL,
      WONDERLIVET_PROFILE_FESTIVAL_URL,
      SUKIMASWITCH_PROFILE.artistName,
      WONDERLIVET_PROFILE_SEED,
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
      throw new Error('SUKIMASWITCH 공식 프로필과 충돌하는 기존 소스');

    const disabled = (await queryRunner.query(
      `SELECT id FROM crawl_sources
       WHERE kind = 'artist-image' AND enabled = false AND url = $1
         AND "parserConfig"->>'festivalSourceUrl' = $2
         AND "parserConfig"->>'artistName' = $3
       LIMIT 1`,
      values.slice(0, 3),
    )) as { id: string }[];
    if (disabled.length)
      throw new Error(
        '비활성 SUKIMASWITCH 프로필 소스를 먼저 검토해야 합니다.',
      );

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
        SUKIMASWITCH_PROFILE_URL,
        WONDERLIVET_PROFILE_FESTIVAL_URL,
        SUKIMASWITCH_PROFILE.artistName,
        WONDERLIVET_PROFILE_SEED,
      ],
    );
  }
}
