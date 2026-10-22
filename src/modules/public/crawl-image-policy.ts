// Both the image lookup and the download endpoint must apply this condition.
export const PUBLIC_CRAWL_IMAGE_SQL = `(
  source.url LIKE 'https://mintpaper.co.kr/festivals%'
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
  OR (source.url ~ '^https://ticket[.]yes24[.]com/Perf/[0-9]+$'
    AND image."originUrl" LIKE 'https://tkfile.yes24.com/upload2/PerfBlog/%')
  OR (source.url = 'https://ticket.yes24.com/English/Genre/Concert'
    AND image."originUrl" LIKE 'https://stkfile.yes24.com/upload2/PerfBlog/%')
  OR ((source.url = 'https://nol.yanolja.com/ticket'
      OR source.url ~ '^https://nol[.]yanolja[.]com/ticket/products/[0-9]+$')
    AND image."originUrl" ~* '^https://ticketimage[.]interpark[.]com/Play/image/large/[0-9]+/[0-9]+_p[.](gif|jpe?g|png|webp)$')
)`;
