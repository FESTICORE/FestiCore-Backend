# 내 알림함·새 알림 배지

## 목적

앱의 알림함 화면과 새 알림 배지에 쓸 사용자 단위 알림 기록을 제공한다. `social_notification_deliveries`와 `notification_deliveries`는 기기별 APNs 발송 큐이므로 알림함으로 쓰지 않는다. 알림함은 계정 단위 `user_notifications` 테이블에 따로 쌓는다.

## 엔드포인트

모든 경로는 `/api/v1` 기준이며 앱 access JWT(`Authorization: Bearer <token>`)가 필요하다. 토큰이 없거나 만료되면 401이다.

| 메서드 | 경로 | 요청 | 성공 |
| --- | --- | --- | --- |
| GET | `/me/notifications` | 쿼리 `festivalId?`, `before?`(이전 응답의 `nextCursor`), `limit?`(1~50, 기본 20) | 200, `data: { items, nextCursor }` |
| GET | `/me/notifications/unread-count` | 쿼리 `festivalId?`, 헤더 `If-None-Match?` | 200, `data: { unreadCount }`와 `ETag: "unread-<개수>"`. ETag가 같으면 본문 없는 304 |
| POST | `/me/notifications/read` | `{ "ids": ["ntf_..."] }` 또는 `{ "all": true, "festivalId"?: "fst_..." }` | 204 |
| POST | `/me/notifications/delete` | `{ "ids": ["ntf_..."] }` | 204 |

- `ids`는 `ntf_` 뒤 소문자 16진수 32자인 ID 1~100개다. 내 알림이 아니거나 없는 ID는 오류 없이 무시한다. 다른 사용자의 알림 존재 여부는 드러내지 않는다.
- `read`는 `ids`와 `all=true` 중 하나만 받는다. `festivalId`는 `all=true`와 함께만 보낼 수 있다. 이미 읽은 항목의 `readAt`은 바꾸지 않는다.
- 선택 삭제는 본문이 있으므로 `DELETE` 대신 `POST`를 쓴다.
- `unread-count`는 `Cache-Control: private, no-cache`, `Vary: Authorization`을 보낸다. ETag는 개수만으로 만든다.

## 목록 항목

```json
{
  "id": "ntf_0123456789abcdef0123456789abcdef",
  "type": "crew.status",
  "festivalId": "fst_2026",
  "title": "크루원 상태 변경",
  "body": "민지님의 상태가 moving(으)로 변경됐어요.",
  "createdAt": "2026-10-17T06:40:00.000Z",
  "readAt": null,
  "route": "/crews/crw_123",
  "subject": { "crewId": "crw_123", "userId": "<작성자 UUID>" }
}
```

- 정렬은 `createdAt` 내림차순, 같은 시각이면 `id` 내림차순이다. `nextCursor`가 `null`이면 마지막 페이지다. 커서는 해석하지 않고 그대로 `before`에 넣는다.
- `subject` 값은 모두 문자열이며 유형에 따라 키가 다르다. 앱은 모르는 `type`을 일반 알림으로 표시한다.
- 보존 기간은 `createdAt`으로부터 30일이다. 지난 항목은 목록과 개수에서 빠지고 정리 작업이 한 시간마다 `createdAt` 인덱스로 찾아 지운다. 회원 탈퇴 시 함께 삭제된다.

## 생성 경로

| type | 생성 시점 | 수신자 | `subject` | 병합 |
| --- | --- | --- | --- | --- |
| `flag.status` | 공개·숨김 아님 깃발의 상태 변경, `resting` 제외 | 작성자를 뺀 팔로워 | `flagId` | 깃발당 한 행. 새 변경이 내용을 바꾸고 읽지 않음으로 되돌림 |
| `crew.status` | 크루원 상태 변경 | 작성자를 뺀 크루원 | `crewId`, `userId` | 크루원당 한 행, 위와 같음 |
| `crew.status` (해산) | 크루 해산 | 크루장을 뺀 크루원 | `crewId` | 한 번만 |
| `crew.gather` | 집결 요청 | 요청자를 뺀 크루원 | `crewId`, `gatherId` | 요청마다 |
| `crew.member_joined` | 초대 코드로 크루 참가 | 참가자를 뺀 크루원 | `crewId`, `userId` | 같은 사람이 다시 합류하면 최신으로 갱신 |
| `pack.updated` | 팩 발행·롤백 | 이 축제를 핀(`pinned=true`)한 기기의 소유 계정 | `packVersion` | 버전마다 |
| `festival.reminder` | D-1 리마인더 발송 직전 | 발송 기기의 소유 계정 | 없음 | 계정당 한 번 |
| `festival.start` | 개최일 시작 알림 발송 직전 | 발송 기기의 소유 계정 | 없음 | 개최일마다 계정당 한 번 |

- 상태·집결·해산·합류·팩 갱신 기록은 원본 쓰기와 같은 트랜잭션 안의 SAVEPOINT에서 만든다. 원본 쓰기가 롤백되면 알림함 기록도 남지 않는다. 알림함 수신자 조회나 기록이 실패하면 SAVEPOINT까지만 되돌리고 오류를 기록한 뒤 원본 쓰기(상태 변경, 크루 참가, 팩 발행 등)는 그대로 커밋한다.
- 알림함은 푸시 동의(`pushOptIn`), 기기 알림 설정(`notify*`), 축제별 푸시 구독(`packUpdates`), APNs 토큰과 무관하게 계정 관계로 수신자를 정한다. `pack.updated`는 팩 업데이트 푸시를 껐더라도 그 축제를 핀한 로그인 계정이면 알림함에 남는다. 단, `festival.reminder`와 `festival.start`는 기존 기기별 예약 작업이 발송될 때 기록하므로 APNs 토큰이 있는 로그인 기기를 가진 계정만 받는다. 이 기록이 실패해도 푸시는 계속 보낸다.
- 익명 기기는 알림함 계정이 없으므로 기록하지 않는다.
- 제목·본문·이동 경로는 같은 이벤트의 푸시 문구와 같은 함수에서 만든다.

## 생성하지 않는 유형

- `set.reminder`(공연 시작 전 알림)는 앱의 로컬 알림이므로 서버 알림함에 넣지 않는다.
- `timetable.changed`는 공연 변경 이벤트(`setOverrides`)가 아직 없어 생성 경로가 없다. 라이브의 `setOverrides`는 현재 빈 배열이다.

## 검증 기준

- 단위 테스트: 목록 쿼리 매개변수와 커서 왕복, 잘못된 `festivalId`·`before`·`limit`·`ids`의 400, `read`의 본문 조합 검증, 다른 사용자 ID를 무시하는 소유자 조건, 각 생성 경로의 수신자 쿼리와 병합 여부.
- HTTP 계약 테스트: 401, 목록 200, `unread-count`의 ETag·304, `read`·`delete`의 204와 본문 검증 400.
- PostgreSQL 테스트(`LIVE_ACTIVITY_PG_URL`이 있을 때): 마이그레이션 적용, 병합 업서트, 커서 페이지, 소유자 범위의 읽음·삭제, 30일 보존 필터.
