// This expression is evaluated with `image` and `source` bound by the caller.
// The newest completed run must independently attest the exact approved bytes.
export const COMMONS_APPROVED_PUBLIC_IMAGE_SQL = `EXISTS (
  SELECT 1 FROM crawl_artist_image_reviews review
  JOIN LATERAL (
    SELECT rights.id, rights.result, rights."finishedAt",
      rights."artistImageRightsEvidence"
    FROM crawl_runs rights
    WHERE rights."sourceId" = source.id
      AND rights."finishedAt" IS NOT NULL
    ORDER BY rights."startedAt" DESC, rights.id DESC
    LIMIT 1
  ) rights_run ON true
  WHERE review."sourceId" = source.id
    AND review."imageId" = image.id
    AND review.id::text = source."parserConfig"->>'reviewId'
    AND review.status = 'approved'
    AND review."festivalSourceUrl" = source."parserConfig"->>'festivalSourceUrl'
    AND review."artistName" = source."parserConfig"->>'artistName'
    AND review."originalSha256" ~ '^[0-9a-f]{64}$'
    AND image."originalSha256" = review."originalSha256"
    AND source.enabled = true
    AND rights_run.result IN ('unchanged', 'nochange-parsed')
    AND rights_run."finishedAt" > now() - interval '36 hours'
    AND rights_run."artistImageRightsEvidence"->>'status' = 'ok'
    AND rights_run."artistImageRightsEvidence"->>'imageId' = image.id::text
    AND rights_run."artistImageRightsEvidence"->>'originalSha256' =
      review."originalSha256"
)`;
