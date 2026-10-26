import { CDF_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/cdf-profile';
import { DRDR_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/drdr-profile';
import { WONDERLIVET_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/wonderlivet-profile';
import { FESTIVAL_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/festival-profile';
import { ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/additional-festival-profile';
import { PRUGIO_PUBLIC_IMAGE_SQL } from '../admin/crawl/service/prugio-profile';

// Both the image lookup and the download endpoint must apply this condition.

export const PUBLIC_CRAWL_IMAGE_SQL = `(
  (source.kind = 'discovery'
    AND source.url LIKE 'https://mintpaper.co.kr/festivals%')
  OR (source.url IN (
      'https://ticket.melon.com/search/index.htm?q=WONDERLIVET',
      'https://ticket.melon.com/search/index.htm?q=festival',
      'https://ticket.melon.com/search/index.htm?q=페스티벌',
      'https://ticket.melon.com/search/index.htm?q=%ED%8E%98%EC%8A%A4%ED%8B%B0%EB%B2%8C'
    )
    AND image."originUrl" LIKE 'https://cdnticket.melon.co.kr/resource/image/upload/product/%')
  OR (source.url ~ '^https://ticket[.]melon[.]com/performance/index[.]htm[?]prodId=[0-9]+$'
    AND (image."originUrl" LIKE 'https://cdnticket.melon.co.kr/resource/image/upload/product/%'
      OR image."originUrl" LIKE 'https://cdnimg.melon.co.kr/%'))
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source."parserConfig"->>'seed' IS DISTINCT FROM 'official-wonderlivet-lineup'
    AND source."parserConfig"->>'seed' IS DISTINCT FROM 'official-gmf-lineup'
    AND source."parserConfig"->>'seed' IS DISTINCT FROM 'cdf-official-profile'
    AND source."parserConfig"->>'seed' IS DISTINCT FROM 'drdr-official-profile'
    AND source."parserConfig"->>'seed' IS DISTINCT FROM 'wonderlivet-official-profile'
    AND source."parserConfig"->>'seed' IS DISTINCT FROM 'festival-official-profile'
    AND source."parserConfig"->>'seed' IS DISTINCT FROM 'additional-festival-official-profile'
    AND source."parserConfig"->>'seed' IS DISTINCT FROM 'prugio-official-profile'
    AND source."parserConfig"->>'festivalSourceUrl' ~ '^https://(ticket[.]melon[.]com|ticket[.]yes24[.]com|nol[.]yanolja[.]com|mintpaper[.]co[.]kr)/'
    AND (source."parserConfig"->>'seed' IS DISTINCT FROM 'official-artist-gallery'
      OR (split_part(image."originUrl", '?', 1) =
            'https://cdn.imweb.me/thumbnail/' || (source."parserConfig"->>'imageHint')
        AND EXISTS (
          SELECT 1 FROM crawl_sources gallery
          WHERE gallery.kind = 'artist-gallery' AND gallery.enabled = true
            AND gallery.url = source.url
            AND gallery."parserConfig"->>'seed' = 'xmf-official-gallery'
            AND gallery."parserConfig"->>'festivalSourceUrl' =
              source."parserConfig"->>'festivalSourceUrl')))
    AND image."originUrl" LIKE 'https://%')
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source.url = 'https://www.mintpaper.co.kr/festivals/172/lineup'
    AND source."parserConfig"->>'seed' = 'official-gmf-lineup'
    AND source."parserConfig"->>'festivalSourceUrl' = 'https://mintpaper.co.kr/festivals/172'
    AND EXISTS (
      SELECT 1 FROM crawl_sources gallery
      WHERE gallery.kind = 'artist-gallery'
        AND gallery.enabled = true
        AND gallery.url = source.url
        AND gallery."parserConfig"->>'seed' = 'gmf-official-lineup'
        AND gallery."parserConfig"->>'festivalSourceUrl' =
          source."parserConfig"->>'festivalSourceUrl'
    )
    AND source."parserConfig"->>'imageHint' ~ '^/GMF_2026_[A-Za-z0-9_]+[.]jpe?g$'
    AND (image."originUrl" = 'https://mintpaper.s3.ap-northeast-2.amazonaws.com' ||
        (source."parserConfig"->>'imageHint')
      OR (source."parserConfig"->>'previousImageHint' ~ '^/GMF_2026_[A-Za-z0-9_]+[.]jpe?g$'
        AND image."originUrl" = 'https://mintpaper.s3.ap-northeast-2.amazonaws.com' ||
          (source."parserConfig"->>'previousImageHint'))))
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source."parserConfig"->>'seed' = 'cdf-official-profile'
    AND source."parserConfig"->>'festivalSourceUrl' = 'https://mintpaper.co.kr/festivals/178'
    AND (
      ${CDF_PUBLIC_IMAGE_SQL}
    ))
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source."parserConfig"->>'seed' = 'drdr-official-profile'
    AND (
      ${DRDR_PUBLIC_IMAGE_SQL}
    ))
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source."parserConfig"->>'seed' = 'wonderlivet-official-profile'
    AND source."parserConfig"->>'festivalSourceUrl' = 'https://www.wonderli.vet/lineup'
    AND (
      ${WONDERLIVET_PUBLIC_IMAGE_SQL}
    ))
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source."parserConfig"->>'seed' = 'festival-official-profile'
    AND (
      ${FESTIVAL_PUBLIC_IMAGE_SQL}
    ))
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source."parserConfig"->>'seed' = 'additional-festival-official-profile'
    AND (
      ${ADDITIONAL_FESTIVAL_PUBLIC_IMAGE_SQL}
    ))
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source."parserConfig"->>'seed' = 'prugio-official-profile'
    AND (
      ${PRUGIO_PUBLIC_IMAGE_SQL}
    ))
  OR (source.kind = 'artist-image'
    AND source.enabled = true
    AND source.url = 'https://www.wonderli.vet/api/trpc/lineup.list'
    AND source."parserConfig"->>'seed' = 'official-wonderlivet-lineup'
    AND source."parserConfig"->>'festivalSourceUrl' = 'https://www.wonderli.vet/lineup'
    AND EXISTS (
      SELECT 1 FROM crawl_sources gallery
      WHERE gallery.kind = 'artist-gallery'
        AND gallery.enabled = true
        AND gallery.url = source.url
        AND gallery."parserConfig"->>'seed' = 'wonderlivet-official-lineup'
        AND gallery."parserConfig"->>'festivalSourceUrl' =
          source."parserConfig"->>'festivalSourceUrl'
    )
    AND source."parserConfig"->>'imageHint' ~
      '^/lineup/artists/production/live/day[123]/[a-z0-9-]{1,110}[.]webp$'
    AND (image."originUrl" =
        'https://mcnqglozya2x8j6x.public.blob.vercel-storage.com' ||
        (source."parserConfig"->>'imageHint')
      OR (source."parserConfig"->>'previousImageHint' ~
          '^/lineup/artists/production/live/day[123]/[a-z0-9-]{1,110}[.]webp$'
        AND image."originUrl" =
          'https://mcnqglozya2x8j6x.public.blob.vercel-storage.com' ||
          (source."parserConfig"->>'previousImageHint'))))
  OR (source.kind = 'timetable'
    AND source."parserConfig"->>'publicSourceImage' IS DISTINCT FROM 'false'
    AND image."originUrl" LIKE 'https://%'
    AND EXISTS (
      SELECT 1 FROM crawl_timetable_revisions revision
      WHERE revision."sourceId" = source.id
        AND revision."imageId" = image.id
        AND revision.status = 'verified'
    ))
  OR (source.url ~ '^https://ticket[.]yes24[.]com/(English/)?Perf/[0-9]+$'
    AND (image."originUrl" LIKE 'https://tkfile.yes24.com/%'
      OR image."originUrl" LIKE 'https://stkfile.yes24.com/%'))
  OR (source.url = 'https://ticket.yes24.com/English/Genre/Concert'
    AND image."originUrl" LIKE 'https://stkfile.yes24.com/upload2/PerfBlog/%')
  OR (source.url = 'https://nol.yanolja.com/ticket'
    AND image."originUrl" ~* '^https://ticketimage[.]interpark[.]com/Play/image/large/[0-9]+/[0-9]+_p[.](gif|jpe?g|png|webp)$')
  OR (source.url ~ '^https://nol[.]yanolja[.]com/ticket/(products/[0-9]+|meta/performance/[A-Za-z0-9_.%-]+)$'
    AND image."originUrl" LIKE 'https://ticketimage.interpark.com/%'
    AND (source.url !~ '^https://nol[.]yanolja[.]com/ticket/products/[0-9]+$'
      OR coalesce(
        substring(lower(split_part(split_part(image."originUrl", '?', 1), '#', 1))
          from '/([0-9]+)_p[.](gif|jpe?g|png|webp)$'),
        substring(source.url from '^https://nol[.]yanolja[.]com/ticket/products/([0-9]+)$')) =
        substring(source.url from '^https://nol[.]yanolja[.]com/ticket/products/([0-9]+)$')))
  OR (source.url ~ '^https://world[.]nol[.]com/en/ticket/products/[0-9]+$'
    AND image."originUrl" ~* '^https://ticketimage[.]interpark[.]com/Play/image/large/[0-9]+/[0-9]+_p[.](gif|jpe?g|png|webp)$'
    AND substring(lower(image."originUrl") from '/([0-9]+)_p[.](gif|jpe?g|png|webp)$') =
      substring(source.url from '^https://world[.]nol[.]com/en/ticket/products/([0-9]+)$'))
)`;
