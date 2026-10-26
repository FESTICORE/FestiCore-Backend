# NOL World 공개 축제 수집

## 목적

국내 NOL 티켓의 403 차단을 우회하지 않는다. NOL의 공개 영문 공연 목록·홈·검색과 상세 HTML을 기존 서버 크롤링에 연결한다. 출처는 `/en/ticket/genre/CONCERT/products`, `/en/ticket`, `/en/search?q=festival`의 세 공개 URL이다.

## 계약

- 목록에서는 `world.nol.com`의 `/en/ticket/products/{숫자}` 링크와 그 카드의 공연 제목만 읽는다. 축제 제목 또는 이미 검증된 축제 브랜드만 상세 소스로 등록한다. 일반 콘서트, 얼리버드·블라인드·숙박 묶음, 외부 호스트, 쿼리·프래그먼트가 붙은 링크는 제외한다. URL 중복을 제거하고 목록당 최대 100개만 등록한다. 목록에 축제 후보가 없으면 기존 수집 실패 기록 규칙을 유지한다.
- 상세 `Event`의 날짜는 검증하고 World 축제 상품에 한해 최대 32일 기간을 허용한다. 출연진 이름은 구조화 데이터에서 수집하지만 출연진 사진은 공개 이미지 정책에 맞는 근거가 없어 저장하지 않는다. 같은 상품 ID의 공식 포스터만 저장·공개한다.
- 상세에서는 같은 공식 페이지의 `Event` JSON-LD에서 제목, 시작·종료 날짜, 장소와 포스터를 읽는다. 날짜와 장소가 유효하지 않으면 발견 후보를 만들지 않는다. 예매 오픈 시각인 `offers.validFrom`은 공연 날짜로 사용하지 않는다.
- 포스터는 `ticketimage.interpark.com/Play/image/large/.../{상품ID}_p.{gif,jpg,png,webp}` 중 상세 URL의 상품 ID와 일치할 때만 다운로드하고 공개한다. 이미지 다운로드에도 기존 HTTPS, robots, 응답 크기, MIME 및 WebP 변환 검사를 적용한다. 구조화된 출연진과 개별 이미지가 없으면 아티스트 정보나 사진을 생성하지 않는다.
- 상세 HTML에 같은 상품 ID의 `ticketimage.interpark.com/Play/image/etc/...` 이미지가 있으면 최대 3개를 robots·HTTPS·응답 크기·MIME·디코딩 검증 후 OCR한다. 원본 URL, 이미지 SHA-256, 파서 버전, OCR 원문 줄과 상태를 `crawl_runs.lineupEvidence`에 실행별 비공개 기록으로 남긴다. 같은 HTML이라도 이미지를 다시 확인하며 이미지 해시와 파서 버전이 모두 같을 때만 이전 OCR을 재사용한다. 실패 원인은 robots·network·http·invalid-image·ocr·missing-image 중 하나로 기록하고 이전 원문을 복사하지 않는다. 부분 실패 실행은 `error=LINEUP_EVIDENCE_PARTIAL`로 표시하되 공개 후보 파싱은 계속한다.
- `lineupEvidence`는 관리자 `GET /api/v1/admin/crawl/runs`에서 검토한다. OCR 텍스트만으로 `festival.new.artists`, 공개 축제 API, 공연 시간표 또는 출연진 사진을 자동 생성하지 않는다. 공식 원본과 사람의 검토가 필요한 자료다.
- 새 목록 소스는 중복 등록하지 않고 KST 예약 크롤러에서 매일 실행한다. 발견 상세 소스도 기존 소스 중복 방지 규칙을 따른다. 제안은 관리자 검토 전 초안·공개 팩을 변경하지 않는다.

## 검증

- NOL World의 실제 공개 HTML에서 `STILL ROLLING FEST 2026` 목록 링크와 상세 `Event` JSON-LD, `COUNTDOWN FANTASY 2026-2027` 상세 JSON-LD가 확인됐다. 최신 콘서트 첫 20개에 축제가 없는 시점에도 홈에서는 SKY FESTIVAL·MINT FESTA, 공개 검색에서는 여러 축제 상품이 확인됐다. 목록 내용은 갱신되므로 특정 축제가 매일 목록에 보장되지는 않는다.
- 파서 단위 테스트에서 일반 콘서트·외부 링크·잘못된 날짜·다른 상품 포스터를 거부한다. 소스 등록과 이미지 정책 테스트를 실행한다. 개발 배포 후 실제 `crawl_runs`, 상세 소스 및 발견 후보를 별도로 확인한다.
