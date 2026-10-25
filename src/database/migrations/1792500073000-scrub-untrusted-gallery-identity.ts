import { MigrationInterface, QueryRunner } from 'typeorm';

// Admin-created sources have an audit record; crawler-created sources do not.
// Preserve existing crawler-verified names if the official site is unavailable.
export class ScrubUntrustedGalleryIdentity1792500073000 implements MigrationInterface {
  name = 'ScrubUntrustedGalleryIdentity1792500073000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE crawl_sources source SET
        enabled = CASE WHEN source."parserConfig"->>'seed' =
          'official-artist-gallery' THEN false ELSE source.enabled END,
        status = CASE WHEN source."parserConfig"->>'seed' =
          'official-artist-gallery' THEN 'disabled' ELSE source.status END,
         "parserConfig" = source."parserConfig" -
           (ARRAY['officialSiteKeys', 'artistOfficialName',
             'artistOfficialNameSource']::text[] ||
           CASE WHEN source."parserConfig"->>'seed' = 'official-artist-gallery'
             THEN ARRAY['seed']::text[] ELSE ARRAY[]::text[] END),
         "updatedAt" = now()
       WHERE source.kind = 'artist-image'
         AND (source."parserConfig" ?| ARRAY[
           'officialSiteKeys', 'artistOfficialName', 'artistOfficialNameSource'
         ]::text[] OR source."parserConfig"->>'seed' = 'official-artist-gallery')
         AND EXISTS (
           SELECT 1 FROM admin_audit audit
           WHERE audit.action = 'crawl.source.created'
             AND audit.target = 'crawl-source:' || source.id::text
         )`,
    );
  }

  // Removed identity claims cannot be reconstructed from the database alone.
  async down(): Promise<void> {}
}
