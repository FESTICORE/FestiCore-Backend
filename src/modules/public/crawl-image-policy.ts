// Both the image lookup and the download endpoint must apply this condition.
export const PUBLIC_CRAWL_IMAGE_SQL = `(
  source.url LIKE 'https://mintpaper.co.kr/festivals%'
  OR (source.url = 'https://ticket.melon.com/search/index.htm?q=WONDERLIVET'
    AND image."originUrl" LIKE 'https://cdnticket.melon.co.kr/resource/image/upload/product/%')
  OR (source.url ~ '^https://ticket[.]melon[.]com/performance/index[.]htm[?]prodId=[0-9]+$'
    AND (image."originUrl" LIKE 'https://cdnticket.melon.co.kr/resource/image/upload/product/%'
      OR image."originUrl" LIKE 'https://cdnimg.melon.co.kr/%'))
  OR (source.url ~ '^https://ticket[.]yes24[.]com/Perf/[0-9]+$'
    AND image."originUrl" LIKE 'https://tkfile.yes24.com/upload2/PerfBlog/%')
)`;
