# 공개 축제 API

## 목적과 권한

앱이 발행된 축제 팩, 깃발 및 현장 라이브 상태를 조회한다. 축제 목록에는 판매처에서 발견했으나 팩을 발행하지 않은 항목도 포함한다. 모든 요청은 GET이며 JSON 요청 본문을 보내지 않는다. `live`는 익명 조회를 허용하고, 앱 access token이 있으면 개인화된 `me`를 포함한다. 관리자 초안은 반환하지 않는다.

## 엔드포인트

| 경로                                     | 쿼리·헤더                                                                                      | 200 응답                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /api/v1/festivals`                  | `after=YYYY-MM-DD` 또는 이전 응답의 `nextCursor`, `limit=1..50`(기본 20), 선택 `If-None-Match` | `items`(ID, 이름, 장소, 날짜, 팩 버전, 상태, 썸네일, 발견 항목의 `sourceUrl`), `nextCursor` |
| `GET /api/v1/festivals/:id`              | 목록에서 받은 축제 ID, 본문 없음                                                               | 발행 축제는 공개 팩, 발견 축제는 확인된 날짜·장소·출처·저장 포스터·출연진과 빈 `timetable`  |
| `GET /api/v1/festivals/:id/pack/version` | 없음                                                                                           | `packVersion`, `packUpdatedAt`, `etag`                                                      |
| `GET /api/v1/festivals/:id/pack`         | 선택 `If-None-Match`, `Accept-Encoding: br` 또는 `gzip`                                        | 발행된 팩 전체 JSON                                                                         |
| `GET /api/v1/festivals/:id/flags`        | 선택 `tag=slam&tag=calm`처럼 반복, OR 필터                                                     | `items`(공개 깃발 프로필), `packVersion`                                                    |
| `GET /api/v1/festivals/:id/live`         | 필수 `X-Device-Id: UUID`, 선택 `Authorization: Bearer <access-token>` 및 `If-None-Match`       | `festivalId`, `setOverrides`, `activeFlags`, `me`, `serverAt`                               |

200 JSON 응답은 모두 `{ "code": "SUCCESS", "data": <표의 응답>, "message": "성공적으로 처리되었습니다." }` 형식이다. JSON 오류는 `{ "code": "<업무 또는 HTTP 오류 코드>", "data": null, "message": "<오류 설명>" }` 형식이며, 허용된 오류 세부 정보가 있으면 `data`에 포함한다. HTTP 상태는 응답 상태 줄에서 확인한다. 304 응답에는 본문이 없다.

`GET /festivals`의 `after`가 날짜이면 그 날짜 이후 종료되는 축제부터 조회한다. 발행 축제는 `days[0].startsAt`을 실제 시각으로 비교하고, 발견 항목은 공연 첫날 자정을 **정렬에만** 사용한다. 발견 항목에 시작 시각을 제공하지 않는다. 동률은 축제 ID로 정렬한다. `nextCursor`는 최초 조회 하한을 보존하는 `YYYY-MM-DD~정렬 ISO8601 시각~fst_...` 형식으로 제공한다. 다음 요청에 사용할 때는 커서 전체를 URL 인코딩한다.

발견 항목은 `status: "discovered"`, `packVersion: 0`, `flagsEnabled: false`로 구분한다. 보관된 공식 포스터가 없으면 `thumbUrl`은 `null`이다. 공식 행사 페이지가 직접 연결한 계정이 있으면 `officialInstagramUrl`을 포함하며 주최자 공통 계정을 행사 계정으로 표시하지 않는다. 이 ID의 팩·버전·깃발·라이브 요청은 발행 전 404다. 앱은 마지막 성공 목록과 발행 팩을 기기 저장소에 보관하고, 재연결 시 ETag와 팩 버전을 비교해 갱신한다. 오프라인 중 서버의 새 데이터는 도착할 수 없다. 자세한 발견 항목 계약은 [수집 축제 공개 목록](crawl-catalog.md)을 따른다.

`/pack`의 ETag는 JSON 응답 형식 변경을 구분하는 `"cdm1-v{packVersion}"`이다. `/pack/version`의 `etag`도 같은 값을 반환한다. `If-None-Match`가 일치하면 본문 없이 304를 반환한다. 이전 형식의 ETag는 일치하지 않아 새 본문을 다시 받는다. 압축별 응답은 `Vary: Accept-Encoding`으로 구분한다. 목록과 라이브도 조건부 조회를 지원한다. 목록 캐시는 60초다. `live`의 `X-Poll-After: 30`은 최소 권장 폴링 간격이며, 기기당 분당 4회 초과 시 429와 `Retry-After`를 보낸다. 지난 요청 제한 기록 정리가 실패하면 새 제한 기록을 만들지 않고 503을 반환하며, 5분 간격으로 정리를 재시도한다.

## 오류와 보안

- 발행본이 없는 축제는 404다. 발행 JSON도 `Festival` 명세에 있는 필드만 재귀적으로 투영한다. 초안 전용 속성, 숨김·비공개 깃발, 내부 이미지 저장 키는 공개 응답에 포함하지 않는다.
- `after`/`limit`/`tag`/기기 UUID 형식 오류는 400이다. 잘못된 Bearer 토큰은 401이다.
- 개인화 라이브 응답은 `Cache-Control: private`과 `Vary: Authorization`을 사용한다.
- 라이브의 `setOverrides`는 현재 빈 배열이다. 공연 변경 이벤트 연계는 후속 작업이다.

## 검증

`test/public-api.e2e-spec.ts`에서 발행·발견 목록, 커서, 비공개 조회, 버전/팩 캐시, 압축 협상, 깃발 필터·사진 URL, 익명/로그인 라이브, 잘못된 요청 및 요청 제한을 검증한다.
