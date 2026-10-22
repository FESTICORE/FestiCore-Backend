# 멜론 검색 포스터 수집 한도 수정

## 목표와 수용 기준

멜론 검색 결과의 이미지 수집 한도(하루 8장)를 축제 후보의 포스터에만 사용한다. 일반 공연, 날짜가 없는 결과, 허용되지 않은 이미지 URL은 다운로드 대상에서 제외한다. 축제 후보가 8건을 넘으면 기존의 날짜별 순환 선택으로 여러 날에 걸쳐 수집한다.

## 근거와 구현

- `crawl-parser.ts`의 `melonSearchCandidates`는 검색 행의 상품 ID, 축제 제목, 날짜와 허용된 포스터 URL을 이미 판정한다.
- `crawl-image.ts`의 `melonSearchImages`는 현재 이미지 경로만 검사해 일반 공연 포스터도 수집한다.
- 검색 후보 파서를 이미지 추출 함수에서 재사용해 축제 후보의 `posterUrl`만 반환한다. 기존 `checkedUrl` 검사와 URL 중복 제거는 유지한다. 다른 출처의 이미지 추출과 하루 8장 순환 정책은 유지한다.
- 멜론 검색 HTML을 닮은 테스트 행에 축제 9건, 일반 공연 1건, 허용되지 않은 이미지 1건을 넣어 축제 포스터만 추출하고 이틀의 선택 결과로 9건 모두를 수집할 수 있는지 검증한다.

## 검증과 범위

- `npx jest --runInBand src/modules/admin/crawl/service/crawl-image.spec.ts src/modules/admin/crawl/service/crawl-parser.spec.ts`
- `npm run build`
- 이 변경은 이미 승인된 검색 결과에서 포스터를 고르는 로직만 다룬다. 검색 결과 페이지 확대나 Railway 데이터 갱신은 배포 상태 확인 뒤 별도로 검증한다.
