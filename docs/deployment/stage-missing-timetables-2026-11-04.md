# Stage 발견 축제 시간표 감사 (2026-11-04)

`node scripts/publish-stage-festivals.cjs --audit-file <path>`를 stage 공개 API에 실행했다. 발견 축제 5개, 승인된 시간표가 있는 축제 0개, 발행 가능 0개, 조회 실패 0개였다. 아래 항목은 **현재 공개 목록에서 발견 가능한 범위**이며, 판매처의 모든 과거·미등록 공연 목록을 뜻하지 않는다.

| 축제 ID | 축제 | 발견 출처 | 추가 확인한 공식 출처 | 누락 사유 |
| --- | --- | --- | --- | --- |
| `fst_1f4d52004988a8b4` | 썸띵 뉴 뮤직 페스티벌 2026 | [YES24](https://ticket.yes24.com/Perf/60785) | [공식 예매 상세](https://ticket.yes24.com/Perf/60785) | 공개 상세에 승인된 시간표 없음. 예스24 상세는 접근 제한으로 공연별 시각·무대를 직접 검증하지 못함. |
| `fst_546789e480f1630f` | COUNTDOWN FANTASY 2026-2027 | [YES24 Global](https://ticket.yes24.com/English/Perf/60590) | [주최사 축제 페이지](https://mintpaper.co.kr/festivals/178), [관람 안내](https://www.mintpaper.co.kr/posts/4821) | 공개 상세에 승인된 시간표 없음. 주최사는 상세 타임테이블을 추후 공지한다고 명시함. |
| `fst_c39663182b10a105` | COUNTDOWN FANTASY 2026-2027 | [주최사 축제 페이지](https://mintpaper.co.kr/festivals/178) | [관람 안내](https://www.mintpaper.co.kr/posts/4821), [공식 인스타그램](https://www.instagram.com/countdownfantasy/) | 동일 행사 별도 발견 ID. 공연별 시각·무대가 게시되지 않음. 인스타그램은 요청 제한으로 확인 불가. |
| `fst_c6dacea8997cd72b` | COUNTDOWN FANTASY 2026-2027 | [YES24](https://ticket.yes24.com/Perf/60590) | [주최사 축제 페이지](https://mintpaper.co.kr/festivals/178), [관람 안내](https://www.mintpaper.co.kr/posts/4821) | 동일 행사 별도 발견 ID. 상세 타임테이블 추후 공지 상태. |
| `fst_1411d33669e8acd5` | FISM BUSAN 2028 | [YES24 Global](https://ticket.yes24.com/English/Perf/54606) | [조직위 개최 개요](https://fismbusan2028.com/20) | 개최일과 프로그램 종류만 공개. 날짜별 공연·무대·시작·종료 시각 없음. |

라인업, 행사 시작 시각, 예정 프로그램은 공연별 검증된 시간표가 아니다. 해당 정보를 공연 세트로 추정하지 않는다. 공식 시간표 원본이 게시되면 출처 이미지와 각 날짜의 공연 수·무대 영역을 `crawl_sources`의 기존 시간표 OCR 경로에 등록하고, 검토 결과가 `verified`인 전체 기간만 자동 발행 대상으로 삼는다. 별도 원본 없이 새 시간표 소스를 등록하지 않았다.
