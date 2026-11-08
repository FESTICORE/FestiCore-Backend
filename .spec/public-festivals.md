# 공개 축제 API

## 목적과 권한

앱이 발행된 축제 팩, 깃발 및 현장 라이브 상태를 조회한다. 축제 목록에는 판매처에서 발견했으나 팩을 발행하지 않은 항목도 포함한다. 모든 요청은 GET이며 JSON 요청 본문을 보내지 않는다. `live`는 익명 조회를 허용하고, 앱 access token이 있으면 개인화된 `me`를 포함한다. 관리자 초안은 반환하지 않는다.

## 엔드포인트

| 경로                                     | 쿼리·헤더                                                                                      | 200 응답                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /api/v1/festivals`                  | `after=YYYY-MM-DD` 또는 이전 응답의 `nextCursor`, `limit=1..50`(기본 20), 선택 `If-None-Match` | `items`(ID, 이름, 장소, 날짜, 팩 버전, 상태, 썸네일, `artistNames`, 발견 항목의 `sourceUrl`), `nextCursor` |
| `GET /api/v1/festivals/:id`              | 목록에서 받은 축제 ID, 본문 없음                                                               | 발행 축제는 공개 팩과 공연별 날짜·무대명·시간·보관 이미지가 포함된 `timetable` 및 공연별 출연진에서 중복을 제거한 `artists`, 발견 축제는 확인된 날짜·장소·출처·저장 포스터·출연진과 빈 `timetable`  |
| `GET /api/v1/festivals/:id/pack/version` | 선택 `If-None-Match`                                                                           | `packVersion`, `packUpdatedAt`, `etag`                                                      |
| `GET /api/v1/festivals/:id/pack/changes` | 필수 `from`(앱에 저장된 팩 버전, 1 이상 정수), 선택 `If-None-Match` | `fromVersion`, `toVersion`, `sizeBytes`, `changedSets`, `lastShuttleAt`, `lastTrainAt`, `lastDepartures` |
| `GET /api/v1/festivals/:id/pack`         | 선택 `If-None-Match`, `Accept-Encoding: br` 또는 `gzip`                                        | 발행된 팩 전체 JSON 및 공연별 출연진에서 중복을 제거한 `artists`                            |
| `GET /api/v1/festivals/:id/flags`        | 선택 `tag=slam&tag=calm`처럼 반복, OR 필터                                                     | `items`(공개 깃발 프로필), `packVersion`                                                    |
| `GET /api/v1/festivals/:id/live`         | 필수 `X-Device-Id: UUID`, 선택 `Authorization: Bearer <access-token>` 및 `If-None-Match`       | `festivalId`, `setOverrides`, `activeFlags`, `me`, `serverAt`                               |

200 JSON 응답은 모두 `{ "code": "SUCCESS", "data": <표의 응답>, "message": "성공적으로 처리되었습니다." }` 형식이다. JSON 오류는 `{ "code": "<업무 또는 HTTP 오류 코드>", "data": null, "message": "<오류 설명>" }` 형식이며, 허용된 오류 세부 정보가 있으면 `data`에 포함한다. HTTP 상태는 응답 상태 줄에서 확인한다. 304 응답에는 본문이 없다.

`GET /festivals`의 `after`가 날짜이면 그 날짜 이후 종료되는 축제부터 조회한다. 발행 축제는 `days[0].startsAt`을 실제 시각으로 비교하고, 발견 항목은 공연 첫날 자정을 **정렬에만** 사용한다. 발견 항목에 시작 시각을 제공하지 않는다. 동률은 축제 ID로 정렬한다. `nextCursor`는 최초 조회 하한을 보존하는 `YYYY-MM-DD~정렬 ISO8601 시각~fst_...` 형식으로 제공한다. 다음 요청에 사용할 때는 커서 전체를 URL 인코딩한다.

앱은 핀한 축제의 각 `days[]`에서 `startsAt - 6시간`부터 `endsAt + 3시간`까지를 당일 화면 창으로 판단한다. 서버의 `Date` 응답 헤더를 기준 시각으로 삼고, 창 안에서는 S01 라이브 보드를 첫 화면으로 연다. 이 화면 선택은 앱 동작이며 목록·상세 API가 응답을 숨기는 조건은 아니다.

발견 항목은 `status: "discovered"`, `packVersion: 0`, `flagsEnabled: false`로 구분한다. 보관된 공식 포스터가 없으면 `thumbUrl`은 `null`이다. 공식 행사 페이지가 직접 연결한 계정이 있으면 `officialInstagramUrl`을 포함하며 주최자 공통 계정을 행사 계정으로 표시하지 않는다. 이 ID의 팩·버전·깃발·라이브 요청은 발행 전 404 `FESTIVAL_NOT_FOUND`다. 앱은 마지막 성공 목록과 발행 팩을 기기 저장소에 보관하고, 재연결 시 ETag와 팩 버전을 비교해 갱신한다. 오프라인 중 서버의 새 데이터는 도착할 수 없다. 자세한 발견 항목 계약은 [수집 축제 공개 목록](crawl-catalog.md)을 따른다.

목록·상세·발행 팩은 `thumbUrl`과 `ticketLinks`를 제공한다. `thumbUrl`은 HTTPS 썸네일, 서버에 보관한 `/api/v1/festivals/images/…` 경로 또는 `null`이다. `ticketLinks`는 최대 5개의 `{label, url}` 항목이며 `label`은 1~20자, `url`은 HTTPS 주소다. 발견 축제의 예매처 링크는 중복 제거해 합치고, 공식 행사 페이지에서 확인된 Instagram 계정 링크를 포함할 수 있다. 발행 팩의 링크는 관리자 초안에서 검증한 값만 공개한다.

`/pack/changes`는 앱 팩 관리 화면의 업데이트 안내에 쓴다. `sizeBytes`는 현재 발행 팩 JSON 크기, `changedSets`는 `from` 버전 대비 추가·삭제되었거나 아티스트·무대·시작·종료 시각이 바뀐 공연 수다. `lastShuttleAt`·`lastTrainAt`은 공개 팩 투영 값(오프셋 포함 ISO8601 또는 null)이 바뀐 경우에만 `{ "before", "after" }`이고 아니면 `null`이다. `lastDepartures`는 날짜별 마지막 셔틀·막차가 추가·삭제·변경된 날짜만 `[{ "date", "before": { "shuttleAt", "trainAt" } | null, "after": … | null }]`로 날짜순으로 주고, 바뀐 날짜가 없으면 `null`이다. `from`이 현재 버전 이상이면 `changedSets`는 0, 버전 기록이 없으면 `null`이다. `from`이 정수가 아니면 400 `VALIDATION`, 발행 전 축제는 404 `FESTIVAL_NOT_FOUND`다. 응답은 `public, no-cache, must-revalidate`이고 ETag는 `"cdm{투영 버전}-chg{from}-{현재 /pack ETag의 따옴표 안 값}"`이다. 같은 packVersion이라도 이미지 승인 변경으로 `/pack` 본문·ETag·`sizeBytes`가 바뀌면 이 ETag도 바뀐다. `from`과 현재 공개 팩이 같으면 `If-None-Match`에 304를 반환한다.

`/pack`의 ETag는 JSON 응답 형식 변경을 구분하는 `"cdm6-v{packVersion}"`이다. `/pack/version`의 응답 헤더와 본문 `etag`도 같은 값을 반환한다. 두 경로 모두 `If-None-Match`가 일치하면 본문 없이 304를 반환한다. 이전 형식의 ETag는 일치하지 않아 새 본문을 다시 받는다. 압축별 응답은 `Vary: Accept-Encoding`으로 구분한다. 목록과 라이브도 조건부 조회를 지원한다. 축제 목록은 `public, no-cache, must-revalidate`로 저장을 허용하되 매 요청 공유 캐시 재검증을 요구한다. 이전 `max-age=3600` 응답은 Railway CDN이 요청의 `Cache-Control: no-cache`를 무시하고 오래된 304를 반환했다. 앱은 이전 목록 ETag를 `If-None-Match`로 보내 변경이 없을 때 304를 받을 수 있다. `live`의 `X-Poll-After: 30`은 최소 권장 폴링 간격이며, 기기당 분당 4회 초과 시 429와 `Retry-After`를 보낸다. 지난 요청 제한 기록 정리가 실패하면 새 제한 기록을 만들지 않고 503을 반환하며, 5분 간격으로 정리를 재시도한다.

## 오류와 보안

- 발행본이 없는 축제는 404다. 발행 JSON도 `Festival` 명세에 있는 필드만 재귀적으로 투영한다. 초안 전용 속성, 숨김·비공개 깃발, 내부 이미지 저장 키는 공개 응답에 포함하지 않는다.
- `after`/`limit`/`tag`/기기 UUID 형식 오류는 400이다. 잘못된 Bearer 토큰은 401이다.
- 개인화 라이브 응답은 `Cache-Control: private`과 `Vary: Authorization`을 사용한다.
- 라이브의 `setOverrides`는 현재 빈 배열이다. 공연 변경 이벤트 연계는 후속 작업이다.

## 검증

`test/public-api.e2e-spec.ts`에서 발행·발견 목록, 커서, 비공개 조회, 버전/팩 캐시, 압축 협상, 깃발 필터·사진 URL, 익명/로그인 라이브, 잘못된 요청 및 요청 제한을 검증한다.

## 목록 출연진 이름 (`artistNames`)

- `GET /api/v1/festivals`의 모든 항목에 `artistNames: string[]`를 넣는다. 앱은 받아 둔 목록으로 아티스트 이름 검색을 오프라인에서도 할 수 있다.
- 발행 축제는 공개 팩 `artists`와 같은 출처(시간표 `sets[].artist`)를, 발견 항목은 목록에 이미 쓰는 출연진(승인된 `crawl_lineup_revisions` 포함)을 쓴다.
- 앞뒤 공백을 지우고 `artistNameKeys`로 같은 이름·한영 병기 표기를 한 번만 남긴다. 처음 나온 표기를 유지하고 최대 50개로 자른다. 출연진을 모르면 빈 배열이다.
- 목록 ETag는 응답 본문 해시이므로 출연진이 바뀌면 ETag도 바뀐다.
- 검증: `public-festival-artist-names.spec.ts`가 중복·빈 이름 제거, 한영 병기 병합, 50개 제한, 빈 배열을 확인한다.

## 팩 귀가 정보

- 공개 팩 `directions`에 `lastDepartures: [{ date, shuttleAt, trainAt }]`를 항상 넣는다. 입력이 없으면 빈 배열이다. 각 시각은 오프셋 포함 ISO8601 또는 null이다.
- `directions.shuttle`이 있으면 `body`, `links`와 함께 선택 `stopName`을 제공한다.
- `directions.shuttle.location`·`directions.transit.location`은 입력이 있을 때만 `{ latitude, longitude }`로 제공한다. 형식이 다른 저장 값은 null로 보내고 그 밖의 키는 버린다.
- `lastShuttleAt`·`lastTrainAt`은 오프셋 포함 ISO8601이면 그대로, 형식 확정 전의 자유 문장이면 null로 제공한다. 입력 형식과 검증은 [admin-festivals.md](admin-festivals.md)의 귀가 정보 입력을 따른다.
- 이 필드 추가로 팩 투영 버전을 4로 올렸다. 이전 `cdm3-` ETag는 일치하지 않아 앱이 새 팩을 한 번 다시 받는다.
- 정류장·역 좌표 추가로 팩 투영 버전을 6으로 올렸다. 이전 `cdm5-` ETag는 일치하지 않아 앱이 새 팩을 한 번 다시 받는다.
