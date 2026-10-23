# 서버 크롤링과 관리자 제안 API

## 목적과 실행 시각

축제 공식 페이지를 서버에서 수집해 변경 제안을 만든다. 기본 판매처에서 발견한 축제의 제목·장소·공연 날짜·출처 URL은 공개 목록에 `discovered`로 표시한다. 축제 팩과 타임테이블은 관리자가 초안을 검토하고 별도 발행 API를 호출한 뒤 갱신된다. 크롤 결과만으로 발행본을 바꾸지 않는다.

- 기준 시간대는 `Asia/Seoul`이다. 서버는 부팅 직후와 이후 매분, 각 활성 소스의 해당 KST 날짜 예약 실행 여부를 확인한다. 정상 가동 중에는 **매일 00:00 KST 이후 첫 점검**에서 실행된다. 서버가 자정에 중단됐다면 재기동 후 미실행분을 확인한다.
- 예약 실행은 `(sourceId, scheduledDate)`의 DB 유니크 키로 중복 등록을 막는다. 당일 새로 등록한 소스는 다음 KST 날짜부터 예약된다. 수동 실행은 즉시 가능하다.
- 한 소스는 `intervalMinutes=1440`으로 고정된다. `enabled=false` 소스는 예약 실행 대상에서 제외된다. 연속 실패 3회부터 `broken`으로 표시하고 관리자 알림을 만들지만, 일시적 장애 복구를 위해 다음 한국 날짜의 00:00 이후 한 번 재시도한다. 같은 날 수동 실행한 `broken` 소스는 다시 예약하지 않는다.
- 실행 요청은 비동기로 처리한다. `POST .../run`의 202 응답은 접수만 뜻하며 성공 여부는 실행 이력에서 조회한다. 같은 소스의 실행이 이미 진행 중이면 그 `runId`를 반환한다. 15분 이상 남은 실행 상태는 다음 점검에서 회수하거나 실패 처리한다.

기본 발견 소스는 다음 공개 목록이다. 초기 배포 때 한 번 수집한 뒤 매일 갱신한다. 수집 페이지에서 확정할 수 없는 개최 시각은 추측하지 않고 관리자 검토 입력으로 남긴다.

- [NOL 티켓 콘서트 장르](https://nol.yanolja.com/ticket/genre/concert): 목록의 직렬화된 공연 URL 중 페스티벌 제목만 후보로 삼는다. 카드에 행사 날짜 전체와 장소가 있을 때만 저장 후보에 포함하고, 예매 오픈 시각을 행사 날짜로 쓰지 않는다. 파서 버전을 갱신해 기존 목록도 다시 처리한다. 식별 가능한 크롤러 요청에 403이 반환되고 격리된 일반 Chrome에도 차단 화면이 표시되어 운영 수집 성공은 확인되지 않았다. 실행 이력에 실패로 기록하고 연속 3회 실패 시 관리자 알림을 만든다.
- [멜론티켓 페스티벌 목록](https://ticket.melon.com/concert/index.htm): 페이지가 사용하는 공개 `prodList.json?perfGenreCode=GENRE_CON_FESTIVAL` 목록 응답을 수집한다. 이 장르에도 일반 공연이 섞여 있어 제목에 축제 표시가 필요하다. 공식 정보로 확인한 `WONDERLIVET`과 `COUNTDOWN FANTASY`는 예외로 삼고, 콘서트·오케스트라 제목은 제외한다.
- [멜론티켓 원더리벳 검색 결과](https://ticket.melon.com/search/index.htm?q=WONDERLIVET): 페스티벌 장르 목록에서 누락되는 원더리벳을 검색 결과의 공연 행에서 수집한다. 행의 공연 ID·날짜·장소·포스터를 함께 읽으며 날짜 없는 결과는 공개 목록에서 제외한다. 지난 행사는 일정 그대로 보존한다.
- [멜론티켓 영문 festival 검색 결과](https://ticket.melon.com/search/index.htm?q=festival): 한글 `페스티벌` 검색과 장르 목록에 잡히지 않는 영문 제목 공연을 같은 검증 파서로 수집한다. 결과에 지난 공연도 포함되므로 일정을 그대로 보존하며, 현재 또는 미래 공연 수 증가를 보장하지 않는다.
- [YES24 티켓 콘서트 목록](https://ticket.yes24.com/English/Genre/Concert): 장르가 Festival인 상품을 후보로 추린다.
- [YES24 국내 페스티벌 장르 AJAX 목록](https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx?genre=15464&sort=0&area=&genretype=2&pCurPage=1&pPageSize=30): 공개 목록의 `ListTotalCnt`를 읽어 필요할 때 최대 4페이지를 순차 수집한다(페이지당 최대 2 MB, 페이지당 robots.txt 재확인). 공연 ID로 상품 URL을 구성하고 카드의 날짜와 장소를 수집하며, 제목 검증과 중복 제거를 적용해 최대 100개 후보를 만든다. 카드의 `data-src` 포스터 URL은 기존 이미지 검증·보관 경로의 수집 후보가 된다. 네트워크, robots.txt, 이미지 형식 검증이 실패하면 해당 이미지 보관은 보장되지 않는다.

확인된 멜론·YES24 상품 URL은 별도 상세 소스로 등록해 다음 KST 예약 실행부터 수집한다. 멜론 상세에서 출연진 이름과 공식 사진 URL을, YES24 국내·영어 상세의 공개 구조화 데이터에서 일정·장소·포스터·사진과 이름이 짝지어진 출연진을 읽는다. 상세 이미지 수집 한도는 81개(포스터와 출연진 사진), 다른 소스 이미지는 최대 8개다. 사진은 WebP 보관에 성공한 경우에만 공개 경로를 제공하며, 구조화 데이터에 개별 사진이 없으면 생성하지 않는다. NOL 기본 소스는 지속된 403으로 이번 마이그레이션에서 비활성화한다. 공연 시작 시각과 무대별 타임테이블은 공식 정보가 확인되기 전에는 생성하지 않는다.

2026-10-23 확인한 [WONDERLIVET 2026 멜론 상세](https://ticket.melon.com/performance/index.htm?prodId=213793)에는 출연진 40명이 있다. 개발 API에는 현재 40명 중 33명의 개별 사진이 보관되어 있다. 나머지 7명(CHiCO with HoneyWorks, Suisei Hoshimachi, Humbreaders, Chevon, Brandy Senki, Conton Candy, CLAN QUEEN)의 멜론 이미지 주소는 모두 동일한 기본 이미지 경로이므로 실제 사진으로 취급하지 않는다. [공동 주최사 ぴあ의 공식 발표](https://corporate.pia.jp/news/detail_wonderlivet_20260826.html)는 42팀을 명시하며, 멜론 상세에 없는 A I W E O와 KUROMI를 포함한다. [축제 공식 사이트](https://www.wonderli.vet/home)는 42팀과 타임테이블 공개를 명시하지만 `robots.txt`가 `/api` 수집을 금지하므로 해당 경로를 예약 크롤러에 연결하지 않는다. 두 팀의 이미지와 42팀 전체 시간·무대의 허용되는 공식 원본을 확인하고 출처별 중복 제거를 구현하기 전까지 42팀 및 타임테이블 수집 완료로 표시하지 않는다.

아티스트 사진 대체는 소스별 `artist-image` 크롤로 처리한다. 관리자 소스 생성 API에 `kind: "artist-image"`, `parser: "html-text"`, 공식 프로필 페이지 `url`, `parserConfig: { "festivalSourceUrl": "예매 상세 URL", "artistName": "출연진 이름", "imageHint": "프로필 이미지 경로의 고유 부분" }`을 등록한다. 수집기는 매일 원본 HTML에서 힌트와 일치하는 HTTPS 이미지 주소를 다시 찾고 robots 정책·응답 MIME·디코딩·크기 제한을 통과한 파일만 WebP로 보관한다. 공개 상세 API는 축제 원본 URL과 출연진 이름이 모두 일치하는 저장 이미지를 선택한다. 코드에 특정 아티스트 사진 URL을 추가하지 않는다. 원더리벳 7팀의 후보 출처는 [CHiCO 공식 사이트](https://www.chicoxxx.com/), [hololive 프로필](https://hololive.hololivepro.com/talents/hoshimachi-suisei/), [Humbreaders 프로필](https://humbreaders.com/profile/), [Avex Chevon 프로필](https://avexnet.jp/contents/CHEVO-WORK-0001), [Brandy Senki 프로필](https://brandysenki.com/biography), [Conton Candy 공식 뉴스](https://contoncandy.fanpla.jp/news/2/), [CLAN QUEEN 공식 사이트](https://www.clanqueen.jp/)다. 소스 등록·배포·실제 이미지 보관은 별도 운영 검증이 필요하며, 외부 재배포 허락은 확인되지 않았다.

NOL의 공개 상품·공연정보 상세 HTML이 입력되면 공연명과 명시된 `기간`/`일시`, `장소`를 축제 발견 후보로 읽는다. 별도 티켓 오픈 날짜는 행사 날짜로 사용하지 않으며 유효하지 않은 날짜·장소는 거부한다. 2026-10-22 서버 직접 요청에서 콘서트 목록과 상품 상세가 각각 HTTP 403이었으므로 이 파서의 테스트 통과는 운영 수집 성공을 뜻하지 않는다. `robots.txt`의 `/discovery/` 제외 경로는 수집하지 않고, 비활성화된 NOL 예약 소스를 접근 가능성이 검증되기 전에 켜지 않는다.

새 소스 마이그레이션은 URL이 이미 있으면 중복 등록하지 않는다. 기존 NOL·YES24 소스와 멜론 대체 소스는 `createdAt`을 전날로 등록해 배포 후 첫 예약 점검에서 실행한다. 멜론의 기존 `v=1` 소스는 대체 소스가 존재할 때 비활성화해 같은 목록의 중복 실행을 막는다.

## 관리자 인증과 문서

모든 API는 `/api/v1` 접두사를 사용한다. 일반 로그인에서 발급한 Bearer access JWT와 활성 관리자 권한이 필요하다. 쓰기 요청은 허용된 `ADMIN_WEB_URL` 출처도 확인한다. 조회는 `viewer`, 실행·제안 결정은 `editor`, 소스 생성·변경은 `owner` 이상이다. Swagger는 일반 사용자 문서와 분리된 관리자 문서에서 제공한다.

## 크롤 소스와 실행 API

| 메서드 | 경로                                  | 역할   | 본문·쿼리                                                 | 결과                                      |
| ------ | ------------------------------------- | ------ | --------------------------------------------------------- | ----------------------------------------- |
| GET    | `/admin/crawl/sources`                | viewer | `festivalId?`, `status?`                                  | `{items: CrawlSource[]}`                  |
| POST   | `/admin/crawl/sources`                | owner  | `{festivalId?, kind, url, parser, parserConfig}`          | 생성된 소스                               |
| PATCH  | `/admin/crawl/sources/:id`            | owner  | `{enabled?, parserConfig?, intervalMinutes?: 1440, url?}` | 변경된 소스                               |
| POST   | `/admin/crawl/sources/:id/run`        | editor | 없음                                                      | 202 `{runId}`                             |
| POST   | `/admin/crawl/sources/:id/test`       | editor | 없음                                                      | `{parsed, excerpt}`                       |
| GET    | `/admin/crawl/runs`                   | viewer | `sourceId?`, `result?`, `limit?`                          | `{items: CrawlRun[]}`; 기본 50, 최대 100  |
| GET    | `/admin/crawl/snapshots/:id`          | viewer | 없음                                                      | `{id, runId, body, createdAt}`; 30일 보관 |
| GET    | `/admin/crawl/images`                 | viewer | `runId?`, `sourceId?`                                     | `{items: CrawlImage[]}`; 최근 100개       |
| GET    | `/admin/crawl/images/:id`             | viewer | 없음                                                      | `image/webp` 바이너리                     |
| GET    | `/admin/crawl/alerts`                 | viewer | `status?`, `limit?`                                       | `{items: CrawlAlert[]}`                   |
| PATCH  | `/admin/crawl/alerts/:id/acknowledge` | editor | 없음                                                      | 확인된 알림                               |

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

소스 생성·변경은 설정 전후값과 관리자 ID를 같은 DB 트랜잭션의 감사 기록에 남긴다. 수동 실행은 크롤 작업을 시작하기 전에 요청을 감사 기록하며, 기록에 실패하면 실행하지 않는다. 파싱 시험은 데이터를 변경하지 않는다.
크롤 장애 알림 확인도 상태 변경과 관리자 감사 기록을 같은 트랜잭션으로 저장한다. 이미 확인된 알림을 다시 확인하면 기존 확인자를 유지하고 새 감사 기록은 만들지 않는다.

## 제안 검토와 초안 반영

| 메서드 | 경로                           | 역할   | 본문·쿼리                                | 결과                                |
| ------ | ------------------------------ | ------ | ---------------------------------------- | ----------------------------------- |
| GET    | `/admin/proposals`             | viewer | `festivalId?`, `status?` (`open` 기본)   | `{items: Proposal[]}`               |
| GET    | `/admin/proposals/:id`         | viewer | 없음                                     | 제안과 `currentDraftValues`         |
| POST   | `/admin/proposals/:id/decide`  | editor | `{decisions:[{itemId,decision,after?}]}` | `{proposal,conflicts,draftVersion}` |
| POST   | `/admin/proposals/:id/dismiss` | editor | `{reason}` (1~500자)                     | 거절된 제안                         |

`decision`은 `accepted` 또는 `rejected`다. `decide`는 항목별 판단을 받으며 중복 itemId는 거절한다. 기존 축제 변경을 수락하면 초안의 이전 값이 제안 생성 당시 값과 같은지 검사한다. 달라졌거나 초안 검증에 실패한 항목은 `conflicts`에 이유가 반환되고 `pending`으로 남는다.

제안 결정·기각은 상태 변경과 관리자 감사 기록을 같은 DB 트랜잭션으로 저장한다. 감사 기록에는 관리자 ID, 제안 ID, 변경 전후 상태와 항목 결정, 신규 축제 ID 또는 기각 사유를 담는다. 승인으로 축제를 생성하거나 기존 초안을 바꾸면 적용된 초안의 전후값도 별도 축제 감사 기록에 저장한다.

`festival.new` 수락은 발견 후보를 관리자가 검토한 `after` 값으로 비공개 축제 초안을 만든다. `after`에서 `name`, `venue`, `days[{date,startsAt,endsAt}]`를 보완할 수 있으며 발견 원본 URL은 바꿀 수 없다. 필수 정보가 부족하면 `conflicts`로 반환하고 항목을 보류한다. 생성 또는 수정한 초안은 **관리자 축제 발행 API로 별도 발행해야** 공개 팩과 타임테이블에 반영된다. 발행 전에도 검증 가능한 발견 후보 요약은 목록에 표시된다.

새 축제 후보 검토 예시:

```json
{
  "decisions": [
    {
      "itemId": "0",
      "decision": "accepted",
      "after": {
        "name": "샘플 뮤직 페스티벌",
        "venue": "서울 올림픽공원",
        "days": [
          {
            "date": "2026-10-25",
            "startsAt": "2026-10-25T10:00:00+09:00",
            "endsAt": "2026-10-25T22:00:00+09:00"
          }
        ]
      }
    }
  ]
}
```

## 이미지, 실패와 보안

수집된 이미지는 형식·크기 검사를 거쳐 WebP로 다시 인코딩하고 메타데이터를 제거해 서버의 이미지 저장소에 보관한다. 원본 HTML/JSON 스냅샷도 같은 비공개 오브젝트 저장소에 30일 보관한다. 관리자 이미지·스냅샷 URL은 세션을 검사하며 외부 원본 URL로 리디렉션하지 않는다. 이미지 목록은 원본 URL, 수집 실행 ID, 보관 URL을 보여준다.
XMF 공식 갤러리의 모달 엔드포인트는 JSON 본문을 `text/html; charset=utf-8`로 반환할 수 있다. 이 고정 엔드포인트에 한해 `application/json`과 `text/html` 응답을 허용하되, 기존 JSON 구조·출연진 이름·응답 크기 검증을 모두 통과해야 아티스트 사진 소스를 생성한다.
갤러리 실행은 출연진별 기존 사진 소스의 이미지 힌트를 갱신하고, 실제로 갱신된 행이 없으면 새 사진 소스를 등록한다. PostgreSQL `UPDATE … RETURNING`의 변경 건수를 사용해 등록 여부를 판별한다.
멜론·YES24·NOL 공연 상세는 포스터와 확인된 출연진 사진을 한 번의 실행에서 최대 81개까지 수집한다. 다른 소스는 실행당 최대 8개를 유지한다. 출연진 사진이 공식 원본에 없거나 이미지 검증에 실패하면 상세 응답의 `imageUrl`은 `null`이다.

- HTTPS 공개 주소만 수집하고 DNS·연결 대상, 응답 크기, 시간 제한 및 `robots.txt`를 검사한다. 거부되면 소스 등록·시험은 422, 예약 실행은 `failed` 이력으로 기록한다.
- 소스·제안·이미지·스냅샷이 없으면 404다. 유효한 Bearer JWT가 없으면 401, 관리자 역할 또는 출처가 허용되지 않으면 403이다.
- 크롤 결과의 텍스트와 URL은 비신뢰 데이터로 취급한다. 관리자 검토 없이 공개 초안에 적용하지 않는다.

## 검증 기준

- KST 자정 실행, 중복 방지, 재기동 후 미실행분 확인, 비활성·broken 소스 제외.
- 공개 URL/robots 정책과 파서별 fixture, 원본 변경 여부, 이미지 형식·크기·메타데이터 제거 및 저장소 조회.
- 제안의 항목별 수락·거절, 동시 수정 충돌, 발견 축제의 비공개 초안 생성, 별도 발행 전 공개 팩 불변과 발견 목록 반영.
- 관리자 역할·세션·Origin 거부와 Swagger 요청 본문/응답 예시 노출.
