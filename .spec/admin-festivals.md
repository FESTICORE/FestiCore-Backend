# 축제 관리 API

## 목적과 권한

관리자 전용 축제 초안을 수정하고 발행 버전을 보존한다. 조회는 Bearer JWT와 활성 관리자 권한이 필요하다.
생성·수정·발행은 `editor` 이상, 롤백은 `owner`가 필요하다.

## 엔드포인트

기본 경로: `/api/v1/admin/festivals`.

| 메서드 | 경로                     | 입력                                                                    | 결과                                                              |
| ------ | ------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/`                      | 없음                                                                    | 축제 목록, 초안/발행 버전, 열린 크롤 제안 수                      |
| POST   | `/`                      | `{ name, venue, days }`                                                 | 기본 필드를 채운 초안(`draftVersion=1`)                           |
| POST   | `/discovered/:id/import` | 본문 생략, `{}`, `{ "days": [] }` 또는 검증된 `{ "days": [{ "date", "startsAt", "endsAt" }] }` | 동일 공개 ID의 비공개 초안(`draftVersion=1`) |
| GET    | `/:id/draft`             | ID                                                                      | 현재 초안·버전                                                    |
| PATCH  | `/:id/draft`             | `If-Match: "d{draftVersion}"`, JSON 병합 패치                           | 검증된 새 초안·버전                                               |
| PUT    | `/:id/draft/sets`        | 같은 `If-Match`, 배열                                                   | 공연 목록 전체 교체                                               |
| PUT    | `/:id/draft/zones`       | 같은 `If-Match`, 배열                                                   | 존 목록 전체 교체. 선택 `kind`·`area {x,y,w,h}`·`landmark`(1~12자)                 |
| GET    | `/:id/draft/diff`        | ID                                                                      | 발행본 대비 최상위 필드 차이                                      |
| POST   | `/:id/publish`           | `If-Match: "d{draftVersion}"`, `{ note?: string }`                     | 검토한 초안 버전만 발행. 새 `packVersion`, ETag, `pushedDevices`(알림 대기열 등록 수) |
| GET    | `/:id/versions`          | ID                                                                      | 발행 이력                                                         |
| POST   | `/:id/rollback`          | `{ toVersion }`                                                         | 이전 팩을 새 버전으로 재발행                                      |
| POST   | `/:id/pack/import-image` | multipart `image` (JPEG/PNG/WebP, 최대 10MB), `date` (등록된 축제 날짜) | HTTP 200 `{ draft: Set[], confidence: 0..1, unparsed: string[] }` |

존 지도: 초안 `zones[].area`는 지도 왼쪽 위 기준 0~1 비율 사각형이며 지도 밖으로 나갈 수 없다(w·h > 0, x+w ≤ 1, y+h ≤ 1). 영역이 있는 존이 하나라도 있으면 `mapAspect`(지도 너비/높이)가 필요하다. 초안 PATCH의 `mapStages`는 최대 8개의 `{ stageId, x, y, w }`(0~1)로 존 지도의 무대 머리글 줄 위치를 정하며, `stageId`는 초안 `stages`에 있어야 한다. 발행하면 공개 팩 `mapVersion`이 바뀐다(공개 축제 명세의 존 지도 참고).

공연 `Set`의 선택 필드 `imageUrl`에는 서버가 보관한 `/api/v1/festivals/images/{imageId}.webp` 경로만 넣는다. 외부 URL은 거부한다. 발행 후 공개 상세의 `sets`와 `timetable`에 이 경로가 전달되며, 사진이 없는 공연은 `imageUrl: null`이다. `timetable`의 각 항목에는 `date`와 `stageName`도 포함된다. 공연별 공식 시작·종료 시각이 없으면 공연을 임의 생성하지 않는다.

발견 항목 가져오기는 서버의 원본 `firstDate`·`lastDate`를 읽기 전용 `eventPeriod`로 저장한다. 날짜만 확인된 항목은 `days: []`로 승인하고 발행본은 만들지 않는다. 기존 시각 포함 `days` 입력도 유지한다. 입력한 첫날·마지막 날은 원본 기간과 같아야 하며, 최장 32일(양끝 포함)까지 허용한다. 날짜만 알려진 후보에서 매일 운영한다고 추정해 `days`를 채우지 않는다. `PATCH`로 `eventPeriod`를 수정할 수 없다. 발행 전에는 검증된 시작·종료 시각, 무대와 공연 세트가 필요하다. 기존 발행 팩에 `eventPeriod`가 없더라도 조회와 롤백 계약은 유지한다.

## 실패와 보안

- 대상이 없으면 404, 초안 값이 유효하지 않으면 400이다.
- 수정 `If-Match`가 없거나 잘못되면 428, 버전이 바뀌었으면 412와 최신 초안을 반환한다.
- 위험한 중첩 JSON 키(`__proto__`, `constructor`, `prototype`)는 거부한다.
- 발행 팩은 Brotli 압축 기준 200KB 이하이다. 발행·롤백 시 구독 기기의 `pack.updated` 알림을 대기열에 등록하고 별도 작업자가 APNs로 전송한다.
- 생성·초안 수정(공연/존 배열 교체 포함)·발행·롤백은 변경 전후 상태와 관리자 ID를 `admin_audit`에 같은 DB 트랜잭션으로 기록한다. 감사 기록에 실패하면 변경도 취소한다. 발행·롤백 감사 기록에는 팩 전체 대신 버전과 메모/대상 버전만 담는다.
- 이미지 입력은 Tesseract 한국어·영어 OCR을 사용한다. 무대명·시작/종료 시각·아티스트가 같은 OCR 행에서 명확한 경우만 기존 무대 ID와 축제 시간 범위에 맞춰 `draft`에 담는다. 불확실하거나 범위를 벗어나는 행은 `unparsed`에 보존한다. 초안·발행본을 저장하거나 변경하지 않으며 관리자가 결과를 검토하고 `PUT /:id/draft/sets`로 저장한다.
- 업로드는 픽셀 수·가로세로 길이를 제한하고, OCR 하위 프로세스는 고정 인자·15초 시간 제한을 사용한다. OCR 실행 실패 시 503을 반환한다.

## 검증

`src/modules/admin/festival/*.spec.ts`에서 입력 검증·동시 수정·권한·발행·롤백을 확인한다.

## 귀가 정보 입력 (`directions`)

관리자는 `PATCH /:id/draft`의 `directions`로 귀가 정보를 입력하고 발행하면 공개 팩에 반영된다.

```json
"directions": {
  "shuttle": { "body": "정문 셔틀 운행", "links": [], "stopName": "정문 셔틀 정류장" },
  "lastShuttleAt": "2026-10-17T23:40:00+09:00",
  "lastTrainAt": "2026-10-17T23:52:00+09:00",
  "lastDepartures": [
    { "date": "2026-10-17", "shuttleAt": "2026-10-17T23:40:00+09:00", "trainAt": "2026-10-17T23:52:00+09:00" }
  ]
}
```

- 날짜마다 다를 수 있는 막차·마지막 셔틀은 `lastDepartures`에 둔다. 최대 31개이며 `date`는 `YYYY-MM-DD`, 날짜는 중복할 수 없다. `shuttleAt`·`trainAt`은 오프셋을 포함한 ISO8601 또는 null이고 둘 중 하나는 있어야 한다. 자정을 넘는 막차는 다음 날짜의 시각을 그대로 쓴다.
- 발행할 때는 `lastDepartures[].date`가 `days[].date` 중 하나여야 한다. 초안 저장 시에는 날짜 형식만 검사한다.
- 단일 값 `lastShuttleAt`·`lastTrainAt`은 기존 앱 호환용으로 남기며 오프셋 포함 ISO8601 또는 null만 허용한다. PATCH 본문에 자유 문장(예: `23:40`)을 직접 보내면 400이다.
- 형식을 정하기 전에 저장된 초안에 자유 문장이 남아 있으면, 그 키를 보내지 않은 PATCH와 발행에서 경고 없이 null로 정규화한다. PATCH는 정규화된 값을 초안에 저장하고, 발행은 팩에만 null을 넣고 초안은 그대로 둔다. 다른 필드를 고치는 PATCH나 발행이 예전 값 때문에 막히지 않게 하려는 것이다. 자유 문장은 앱이 시각으로 해석할 수 없어 보존할 가치가 없으므로, 관용 처리로 남기기보다 null로 바꿨다. 이미 발행된 팩에 남은 자유 문장도 공개 투영에서 null로 보낸다.
- 마이그레이션 `1792500101000`이 `admin_festivals`의 초안·현재 발행본에 남은 자유 문장을 null로 정리한다. 공개 응답은 이미 null이므로 팩 버전은 올리지 않고, 과거 버전 기록은 바꾸지 않는다. 마이그레이션 뒤에 들어온 값과 롤백한 과거 팩에 대비해, 같은 정규화를 초안 PATCH·발행 외에 깃발 변경·회원 탈퇴의 팩 동기화와 크롤 제안 적용의 검증 앞에도 적용한다.
- `shuttle.stopName`은 셔틀 정류장 이름 1~40자 또는 null이다. 상세 안내는 기존 `shuttle.body`에 둔다.
- `shuttle.location`·`transit.location`은 셔틀 정류장·역 좌표 `{ "latitude": 37.3836, "longitude": 127.1268 }` 또는 null이다. 위도 -90~90, 경도 -180~180의 숫자가 아니면 400이다. 앱은 이 좌표로 현재 위치에서 걸어가는 시간을 Apple 지도로 계산하고, 없으면 정류장·역 이름을 축제 장소(`directions.location`) 근처에서 찾는다.
