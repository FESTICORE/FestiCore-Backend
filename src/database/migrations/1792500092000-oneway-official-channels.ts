import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ONEWAY_CHANNEL_SEED,
  ONEWAY_CHANNELS,
  ONEWAY_FESTIVAL_URL,
} from '../../modules/admin/crawl/service/oneway-official-channel';

export class OnewayOfficialChannels1792500092000 implements MigrationInterface {
  name = 'OnewayOfficialChannels1792500092000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [url, channel] of Object.entries(ONEWAY_CHANNELS)) {
      const values = [
        url,
        ONEWAY_FESTIVAL_URL,
        channel.artistName,
        ONEWAY_CHANNEL_SEED,
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
        throw new Error(
          `원웨이 공식 채널과 충돌하거나 비활성화된 기존 소스: ${channel.artistName}`,
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
             AND "parserConfig"->>'seed' = $4::text
         )`,
        values,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [url, channel] of Object.entries(ONEWAY_CHANNELS)) {
      await queryRunner.query(
        `DELETE FROM crawl_sources source
         WHERE source.kind = 'artist-image' AND source.url = $1::text
           AND source."parserConfig"->>'festivalSourceUrl' = $2::text
           AND source."parserConfig"->>'artistName' = $3::text
           AND source."parserConfig"->>'seed' = $4::text
           AND NOT EXISTS (
             SELECT 1 FROM crawl_runs run WHERE run."sourceId" = source.id
           )`,
        [url, ONEWAY_FESTIVAL_URL, channel.artistName, ONEWAY_CHANNEL_SEED],
      );
    }
  }
}
