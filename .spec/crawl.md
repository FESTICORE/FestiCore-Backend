# 서버 크롤링과 관리자 제안 API

## 목적과 실행 시각

축제 공식 페이지를 서버에서 수집해 변경 제안을 만든다. 앱에 공개되는 축제 목록과 타임테이블은 관리자가 초안을 검토하고 별도 발행 API를 호출한 뒤 갱신된다. 크롤 결과만으로 발행본을 바꾸지 않는다.

- 기준 시간대는 `Asia/Seoul`이다. 서버는 부팅 직후와 이후 매분, 각 활성 소스의 해당 KST 날짜 예약 실행 여부를 확인한다. 정상 가동 중에는 **매일 00:00 KST 이후 첫 점검**에서 실행된다. 서버가 자정에 중단됐다면 재기동 후 미실행분을 확인한다.
- 예약 실행은 `(sourceId, scheduledDate)`의 DB 유니크 키로 중복 등록을 막는다. 당일 새로 등록한 소스는 다음 KST 날짜부터 예약된다. 수동 실행은 즉시 가능하다.
- 한 소스는 `intervalMinutes=1440`으로 고정된다. `enabled=false` 또는 `status=broken` 소스는 예약 실행 대상에서 제외된다. 연속 실패 3회부터 broken으로 표시한다.
- 실행 요청은 비동기로 처리한다. `POST .../run`의 202 응답은 접수만 뜻하며 성공 여부는 실행 이력에서 조회한다. 같은 소스의 실행이 이미 진행 중이면 그 `runId`를 반환한다. 15분 이상 남은 실행 상태는 다음 점검에서 회수하거나 실패 처리한다.

기본 발견 소스는 다음 공개 목록이다. 초기 배포 때 한 번 수집한 뒤 매일 갱신한다. 수집 페이지에서 확정할 수 없는 개최 시각은 추측하지 않고 관리자 검토 입력으로 남긴다.

- [NOL 티켓](https://nol.yanolja.com/ticket): 식별 가능한 크롤러 요청에 403이 반환되어 운영 수집 성공은 확인되지 않았다. 실행 이력에 실패로 기록하고 연속 3회 실패 시 관리자 알림을 만든다.
- [멜론티켓 페스티벌 목록](https://ticket.melon.com/concert/index.htm): 페이지가 사용하는 공개 `prodList.json` 목록 응답을 수집한다.
- [YES24 티켓 콘서트 목록](https://ticket.yes24.com/English/Genre/Concert): 장르가 Festival인 상품을 후보로 추린다.

## 관리자 인증과 문서

모든 API는 `/api/v1` 접두사를 사용한다. 관리자 세션 쿠키 `festicore_admin_session`과 허용된 `ADMIN_WEB_URL` 출처가 필요하다. 조회는 `viewer`, 실행·제안 결정은 `editor`, 소스 생성·변경은 `owner` 이상이다. Swagger는 일반 사용자 문서와 분리된 관리자 문서에서 제공한다.

## 크롤 소스와 실행 API

| 메서드 | 경로 | 역할 | 본문·쿼리 | 결과 |
| --- | --- | --- | --- | --- |
| GET | `/admin/crawl/sources` | viewer | `festivalId?`, `status?` | `{items: CrawlSource[]}` |
| POST | `/admin/crawl/sources` | owner | `{festivalId?, kind, url, parser, parserConfig}` | 생성된 소스 |
| PATCH | `/admin/crawl/sources/:id` | owner | `{enabled?, parserConfig?, intervalMinutes?: 1440, url?}` | 변경된 소스 |
| POST | `/admin/crawl/sources/:id/run` | editor | 없음 | 202 `{runId}` |
| POST | `/admin/crawl/sources/:id/test` | editor | 없음 | `{parsed, excerpt}` |
| GET | `/admin/crawl/runs` | viewer | `sourceId?`, `result?`, `limit?` | `{items: CrawlRun[]}`; 기본 50, 최대 100 |
| GET | `/admin/crawl/snapshots/:id` | viewer | 없음 | `{id, runId, body, createdAt}`; 30일 보관 |
| GET | `/admin/crawl/images` | viewer | `runId?`, `sourceId?` | `{items: CrawlImage[]}`; 최근 100개 |
| GET | `/admin/crawl/images/:id` | viewer | 없음 | `image/webp` 바이너리 |
| GET | `/admin/crawl/alerts` | viewer | `status?`, `limit?` | `{items: CrawlAlert[]}` |
| PATCH | `/admin/crawl/alerts/:id/acknowledge` | editor | 없음 | 확인된 알림 |

소스 등록 예시:

```json
{
  "festivalId": "fst_demo2026",
  "kind": "timetable",
  "url": "https://festival.example.com/timetable",
  "parser": "html-table",
  "parserConfig": { "sourceName": "축제 공식 사이트" }
}
```

`kind`는 `timetable`, `notice`, `directions`, `days`, `discovery` 중 하나다. `discovery`만 `festivalId`를 생략할 수 있다. 현재 등록 가능한 `parser`는 `html-table`, `html-text`, `regex-days`, `ticket-list`다. OCR 연동 전에는 `image-ocr` 소스 등록을 거절한다. 소스 종류와 파서 조합이 맞지 않으면 422를 반환한다.

## 제안 검토와 초안 반영

| 메서드 | 경로 | 역할 | 본문·쿼리 | 결과 |
| --- | --- | --- | --- | --- |
| GET | `/admin/proposals` | viewer | `festivalId?`, `status?` (`open` 기본) | `{items: Proposal[]}` |
| GET | `/admin/proposals/:id` | viewer | 없음 | 제안과 `currentDraftValues` |
| POST | `/admin/proposals/:id/decide` | editor | `{decisions:[{itemId,decision,after?}]}` | `{proposal,conflicts,draftVersion}` |
| POST | `/admin/proposals/:id/dismiss` | editor | `{reason}` (1~500자) | 거절된 제안 |

`decision`은 `accepted` 또는 `rejected`다. `decide`는 항목별 판단을 받으며 중복 itemId는 거절한다. 기존 축제 변경을 수락하면 초안의 이전 값이 제안 생성 당시 값과 같은지 검사한다. 달라졌거나 초안 검증에 실패한 항목은 `conflicts`에 이유가 반환되고 `pending`으로 남는다.

`festival.new` 수락은 발견 후보를 관리자가 검토한 `after` 값으로 비공개 축제 초안을 만든다. `after`에서 `name`, `venue`, `days[{date,startsAt,endsAt}]`를 보완할 수 있으며 발견 원본 URL은 바꿀 수 없다. 필수 정보가 부족하면 `conflicts`로 반환하고 항목을 보류한다. 생성 또는 수정한 초안도 **관리자 축제 발행 API로 별도 발행해야** 공개 목록과 타임테이블에 반영된다.

새 축제 후보 검토 예시:

```json
{
  "decisions": [{
    "itemId": "0",
    "decision": "accepted",
    "after": {
      "name": "샘플 뮤직 페스티벌",
      "venue": "서울 올림픽공원",
      "days": [{
        "date": "2026-10-25",
        "startsAt": "2026-10-25T10:00:00+09:00",
        "endsAt": "2026-10-25T22:00:00+09:00"
      }]
    }
  }]
}
```

## 이미지, 실패와 보안

수집된 이미지는 형식·크기 검사를 거쳐 WebP로 다시 인코딩하고 메타데이터를 제거해 서버의 이미지 저장소에 보관한다. 원본 HTML/JSON 스냅샷도 같은 비공개 오브젝트 저장소에 30일 보관한다. 관리자 이미지·스냅샷 URL은 세션을 검사하며 외부 원본 URL로 리디렉션하지 않는다. 이미지 목록은 원본 URL, 수집 실행 ID, 보관 URL을 보여준다.

- HTTPS 공개 주소만 수집하고 DNS·연결 대상, 응답 크기, 시간 제한 및 `robots.txt`를 검사한다. 거부되면 소스 등록·시험은 422, 예약 실행은 `failed` 이력으로 기록한다.
- 소스·제안·이미지·스냅샷이 없으면 404다. 관리자 세션이 없으면 401, 역할 또는 출처가 허용되지 않으면 403이다.
- 크롤 결과의 텍스트와 URL은 비신뢰 데이터로 취급한다. 관리자 검토 없이 공개 초안에 적용하지 않는다.

## 검증 기준

- KST 자정 실행, 중복 방지, 재기동 후 미실행분 확인, 비활성·broken 소스 제외.
- 공개 URL/robots 정책과 파서별 fixture, 원본 변경 여부, 이미지 형식·크기·메타데이터 제거 및 저장소 조회.
- 제안의 항목별 수락·거절, 동시 수정 충돌, 발견 축제의 비공개 초안 생성, 별도 발행 전 공개 목록 불변.
- 관리자 역할·세션·Origin 거부와 Swagger 요청 본문/응답 예시 노출.
