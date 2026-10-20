# 공개 축제 API

## 목적과 권한

앱이 발행된 축제 팩, 깃발 및 현장 라이브 상태를 조회한다. 모든 요청은 GET이며 JSON 요청 본문을 보내지 않는다. `live`는 익명 조회를 허용하고, 앱 access token이 있으면 개인화된 `me`를 포함한다. 관리자 초안은 반환하지 않는다.

## 엔드포인트

| 경로 | 쿼리·헤더 | 200 응답 |
| --- | --- | --- |
| `GET /api/v1/festivals` | `after=YYYY-MM-DD` 또는 이전 응답의 `nextCursor`, `limit=1..50`(기본 20), 선택 `If-None-Match` | `items`(ID, 이름, 장소, 일정, 팩 버전, 상태, 썸네일), `nextCursor` |
| `GET /api/v1/festivals/:id/pack/version` | 없음 | `packVersion`, `packUpdatedAt`, `etag` |
| `GET /api/v1/festivals/:id/pack` | 선택 `If-None-Match`, `Accept-Encoding: br` 또는 `gzip` | 발행된 팩 전체 JSON |
| `GET /api/v1/festivals/:id/flags` | 선택 `tag=slam&tag=calm`처럼 반복, OR 필터 | `items`(공개 깃발 프로필), `packVersion` |
| `GET /api/v1/festivals/:id/live` | 필수 `X-Device-Id: UUID`, 선택 `Authorization: Bearer <access-token>` 및 `If-None-Match` | `festivalId`, `setOverrides`, `activeFlags`, `me`, `serverAt` |

`GET /festivals`의 `after`가 날짜이면 그 날짜 이후 종료되는 축제부터 조회한다. 목록은 `days[0].startsAt`을 실제 시각으로 비교하고 축제 ID를 동률 순서로 정렬한다. UTC 오프셋이 다른 축제도 실제 시각순이다. `nextCursor`는 최초 조회 하한을 보존하는 `YYYY-MM-DD~시작 ISO8601 시각~fst_...` 형식으로 제공한다. 다음 요청에 사용할 때는 커서 전체를 URL 인코딩한다.

`/pack`의 ETag는 명세대로 `"v{packVersion}"`이다. `If-None-Match`가 일치하면 본문 없이 304를 반환한다. 압축별 응답은 `Vary: Accept-Encoding`으로 구분한다. 목록과 라이브도 조건부 조회를 지원한다. `live`의 `X-Poll-After: 30`은 최소 권장 폴링 간격이며, 기기당 분당 4회 초과 시 429와 `Retry-After`를 보낸다. 지난 요청 제한 기록 정리가 실패하면 새 제한 기록을 만들지 않고 503을 반환하며, 5분 간격으로 정리를 재시도한다.

## 오류와 보안

- 발행본이 없는 축제는 404다. 발행 JSON도 `Festival` 명세에 있는 필드만 재귀적으로 투영한다. 초안 전용 속성, 숨김·비공개 깃발, 내부 이미지 저장 키는 공개 응답에 포함하지 않는다.
- `after`/`limit`/`tag`/기기 UUID 형식 오류는 400이다. 잘못된 Bearer 토큰은 401이다.
- 개인화 라이브 응답은 `Cache-Control: private`과 `Vary: Authorization`을 사용한다.
- 라이브의 `setOverrides`는 현재 빈 배열이다. 공연 변경 이벤트 연계는 후속 작업이다.

## 검증

`test/public-api.e2e-spec.ts`에서 발행 목록, 커서, 비공개 조회, 버전/팩 캐시, 압축 협상, 깃발 필터·사진 URL, 익명/로그인 라이브, 잘못된 요청 및 요청 제한을 검증한다.
