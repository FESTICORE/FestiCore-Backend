# 멜론 축제 검색 수집 확대

## 목표

매일 실행하는 크롤러가 멜론티켓의 일반 `페스티벌` 검색 결과도 수집해 장르 목록에 없는 축제를 발견한다.

## 근거

- 현재 등록된 멜론 검색 소스는 `q=WONDERLIVET` 하나다 (`1792500026000-melon-wonderlivet-search.ts`).
- 2026-10-22에 확인한 `https://ticket.melon.com/search/index.htm?q=페스티벌` 응답에는 축제 검색 결과 10건의 이름, 일정, 장소, 포스터 URL이 포함된다. `THE BRIDGE FESTIVAL`, `Anime X Game Festival`, `VINYL ON TRACK 음악 페스티벌` 등 장르 목록에 없는 이름도 있다.
- 기존 `melonSearchCandidates`는 해당 HTML의 `show_title`, `show_date`, `show_loc` 구조를 대상으로 한다. 검색어 강조 태그가 단어 중간에 들어가면 `plainText`가 불필요한 공백을 넣을 수 있다.

## 구현

1. Claude는 `1792500031000` 이상의 새 데이터베이스 마이그레이션으로 일반 `페스티벌` 검색 URL을 `discovery`/`ticket-list` 소스로 등록한다. 저장 URL은 퍼센트 인코딩 형식을 기준으로 하고, 기존 한글 URL도 중복으로 간주한다. 삽입한 행에는 `parserConfig.seed = melon-festival-search` 표식을 남긴다. 되돌릴 때 이 표식이 있는 소스만 `enabled=false`, `status=disabled`로 바꾸고 실행·제안·이미지·알림 기록이 없을 때만 삭제한다. 기존 관리자 등록 소스와 동적으로 만들어진 상품 상세 소스는 유지한다.
2. Codex는 실제 검색 결과 구조를 축약한 파서 테스트로 단어 중간 강조 태그, 날짜, 장소, 포스터와 비축제 제외를 검증한다. 제목 안의 인라인 강조 태그를 공백 없이 제거하고, `&#40;`/`&#41;`를 복원한다. 포스터는 실제 검색 응답의 `https://cdnticket.melon.co.kr/resource/image/upload/product/` 경로만 허용한다. 기존 원더리벳 테스트 포스터도 실제 경로로 바꾸고, 다른 호스트·경로를 거부하는 테스트를 추가한다.
3. Codex는 멜론 검색 파서의 콘텐츠 해시 버전을 올려 기존 원더리벳 검색 소스도 다시 파싱되게 한다. URL은 저장된 한글·퍼센트 인코딩 형식 모두를 처리한다. 새 검색 소스에서 저장한 포스터도 두 URL 형식에 대해 공개 이미지 정책에 추가한다.
4. Codex는 마이그레이션 테스트를 `src/database/melon-festival-search-source.spec.ts`에 두고, Claude가 작성한 SQL의 중복 방지와 되돌리기 조건을 검증한다. 기존 한글 URL 소스가 있을 때 삽입과 되돌리기가 그 행을 바꾸지 않는 경우를 포함한다.

## 범위와 검증

- 검색 결과 첫 페이지를 대상으로 한다. 추가 페이지, 외부 사이트의 접근 우회, 관리자 승인·배포는 이 변경에 포함하지 않는다.
- 발견 제안은 현재 공개 축제 목록에 바로 노출된다. 음악 외 행사도 제목에 `페스티벌`이 포함되면 노출될 수 있으므로 이는 목록 범위의 현재 정책이며, 이 변경에서 임의로 제외하지 않는다.
- `npx jest --runInBand crawl-parser.spec.ts melon-festival-search-source.spec.ts` 및 `npm run build`가 통과해야 한다.
- 수집 개수 증가와 운영 데이터 저장은 Railway 배포·실행 후 별도로 확인한다.
