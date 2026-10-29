import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ADDITIONAL_FESTIVAL_PROFILE_SEED,
  ADDITIONAL_FESTIVAL_PROFILES,
} from '../../modules/admin/crawl/service/additional-festival-profile';

const newProfiles = Object.entries(ADDITIONAL_FESTIVAL_PROFILES).filter(
  ([url]) =>
    url === 'https://paulkim.co.kr/' ||
    url === 'https://www.yoursummer.net/artist/nerd-connection',
);

export class SeoulOfficialProfiles1792500083000 implements MigrationInterface {
  name = 'SeoulOfficialProfiles1792500083000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [url, profile] of newProfiles) {
      const conflicts = (await queryRunner.query(
        `SELECT id FROM crawl_sources
         WHERE kind = 'artist-image' AND enabled = true
           AND "parserConfig"->>'festivalSourceUrl' = $1
           AND "parserConfig"->>'artistName' = $2
           AND (url IS DISTINCT FROM $3 OR
             "parserConfig"->>'seed' IS DISTINCT FROM $4)
         LIMIT 1`,
        [
          profile.festivalSourceUrl,
          profile.artistName,
          url,
          ADDITIONAL_FESTIVAL_PROFILE_SEED,
        ],
      )) as { id: string }[];
      if (conflicts.length)
        throw new Error(
          `공식 프로필과 충돌하는 기존 소스: ${profile.artistName}`,
        );
      const disabled = (await queryRunner.query(
        `SELECT id FROM crawl_sources
         WHERE kind = 'artist-image' AND enabled = false AND url = $1
           AND "parserConfig"->>'festivalSourceUrl' = $2
           AND "parserConfig"->>'artistName' = $3
         LIMIT 1`,
        [url, profile.festivalSourceUrl, profile.artistName],
      )) as { id: string }[];
      if (disabled.length)
        throw new Error(
          `비활성 공식 프로필 소스를 먼저 검토해야 합니다: ${profile.artistName}`,
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
          profile.festivalSourceUrl,
          profile.artistName,
          ADDITIONAL_FESTIVAL_PROFILE_SEED,
        ],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [url, profile] of newProfiles) {
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
          url,
          profile.festivalSourceUrl,
          profile.artistName,
          ADDITIONAL_FESTIVAL_PROFILE_SEED,
        ],
      );
    }
  }
}
