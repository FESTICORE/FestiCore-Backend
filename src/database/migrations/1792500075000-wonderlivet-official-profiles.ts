import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  WONDERLIVET_PROFILE_FESTIVAL_URL,
  WONDERLIVET_PROFILE_SEED,
  WONDERLIVET_PROFILES,
} from '../../modules/admin/crawl/service/wonderlivet-profile';

export class WonderlivetOfficialProfiles1792500075000 implements MigrationInterface {
  name = 'WonderlivetOfficialProfiles1792500075000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [url, profile] of Object.entries(WONDERLIVET_PROFILES)) {
      const conflicts = (await queryRunner.query(
        `SELECT id FROM crawl_sources
         WHERE kind = 'artist-image' AND enabled = true
           AND "parserConfig"->>'festivalSourceUrl' = $1
           AND "parserConfig"->>'artistName' = $2
           AND "parserConfig"->>'seed' IS DISTINCT FROM $3
         LIMIT 1`,
        [
          WONDERLIVET_PROFILE_FESTIVAL_URL,
          profile.artistName,
          WONDERLIVET_PROFILE_SEED,
        ],
      )) as { id: string }[];
      if (conflicts.length)
        throw new Error(
          `원더리벳 공식 프로필과 충돌하는 기존 소스: ${profile.artistName}`,
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
        [
          url,
          WONDERLIVET_PROFILE_FESTIVAL_URL,
          profile.artistName,
          WONDERLIVET_PROFILE_SEED,
        ],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [url, profile] of Object.entries(WONDERLIVET_PROFILES)) {
      await queryRunner.query(
        `DELETE FROM crawl_sources source
         WHERE source.kind = 'artist-image' AND source.url = $1
           AND source."parserConfig"->>'seed' = $4
           AND source."parserConfig"->>'festivalSourceUrl' = $2
           AND source."parserConfig"->>'artistName' = $3
           AND NOT EXISTS (
             SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id
           )`,
        [
          url,
          WONDERLIVET_PROFILE_FESTIVAL_URL,
          profile.artistName,
          WONDERLIVET_PROFILE_SEED,
        ],
      );
    }
  }
}
