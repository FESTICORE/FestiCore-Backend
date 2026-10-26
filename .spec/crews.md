# 크루 API

비공개 크루는 축제당 사용자 1개, 크루당 최대 12명입니다. 초대 미리보기 외에는 앱 Bearer access token이 필요합니다. `:crewId` 하위 경로는 멤버만 사용할 수 있고 이름 변경, 초대 교체, 소유권 양도, 해산은 크루장만 할 수 있습니다. 기본 경로는 `/api/v1/crews`, 공개 Swagger는 `/api-docs/crews`입니다.

| 메서드 | 경로                             | 본문                                                                                                                                     | 성공                                        |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| POST   | `/crews`                         | `{ "festivalId":"fst_2026", "name":"함께 즐겨요", "nickname":"로이" }` (`nickname` 선택)                                                 | 201 Crew, Location 헤더                     |
| GET    | `/crews/:crewId`                 | 없음                                                                                                                                     | 200 Crew + live, `Cache-Control: no-store`  |
| GET    | `/crews/invite/:code`            | 없음                                                                                                                                     | 200 초대 미리보기; 로그인 불필요, 분당 10회 |
| POST   | `/crews/join`                    | `{ "inviteCode":"K7P2QX", "nickname":"로이" }` (`nickname` 선택)                                                                         | 200 Crew + live                             |
| POST   | `/crews/:crewId/invite/rotate`   | 없음                                                                                                                                     | 200 `{ inviteCode, inviteExpiresAt }`       |
| POST   | `/crews/:crewId/status`          | `Idempotency-Key` 필수, `{ "zoneId":"zon_main", "state":"here", "clientAt":"2026-10-21T01:00:00.000Z" }` (`zoneId`/`state` 중 하나 이상) | 200 CrewMemberLive; 분당 12회               |
| POST   | `/crews/:crewId/gather`          | `{ "zoneId":"zon_main" }`                                                                                                                | 200 `{ zoneId, byUserId, at }`              |
| PATCH  | `/crews/:crewId`                 | `{ "name":"우리 크루" }`                                                                                                                 | 200 Crew                                    |
| PATCH  | `/crews/:crewId/members/me`      | `{ "nickname":"로이" }`                                                                                                                  | 200 `{ userId, nickname }`                  |
| DELETE | `/crews/:crewId/members/:userId` | 없음                                                                                                                                     | 204 본문 없음                               |
| POST   | `/crews/:crewId/transfer`        | `{ "toUserId":"<같은 크루의 다른 사용자 UUID>" }`                                                                                        | 200 Crew                                    |
| DELETE | `/crews/:crewId`                 | 없음                                                                                                                                     | 204 본문 없음                               |

모든 요청 본문은 알 수 없는 필드를 거부합니다. 이름은 1~~20자, 닉네임은 1~~12자, 초대 코드는 6자리입니다. `status.clientAt`은 ISO 8601이며 서버 시각과 5분 이내여야 합니다. 이전 상태 시각이면 409 `STATUS_STALE`와 `current`를 보냅니다. 상태 변경의 `Idempotency-Key`는 1~128자이며 동일 사용자·키·본문의 성공 응답을 24시간 재전송하고, 같은 키로 다른 본문이나 크루를 보내면 409 `IDEMPOTENCY_CONFLICT`를 반환합니다. 만료된 키는 다시 사용할 수 있고 만료 기록은 서버가 주기적으로 정리합니다. 같은 시각과 내용의 재전송은 현재 상태를 반환합니다. `state=leaving`은 `zoneId`를 비웁니다.

초대 코드는 48시간 유효하며 교체 시 이전 코드는 무효입니다. 없는 코드와 만료된 코드는 미리보기에서 동일한 404입니다. 가입에서는 만료 410 `INVITE_EXPIRED`, 보관 410 `CREW_ARCHIVED`, 정원 초과 409 `CREW_FULL`, 다른 크루 소속 409 `CREW_ALREADY_IN`과 `crewId`를 반환합니다. 새 코드가 고유하지 않으면 409 `INVITE_CODE_UNAVAILABLE`입니다. 집결은 크루당 10분 간격이며 429 `GATHER_COOLDOWN`에 `retryAfter`(초)를 포함합니다.

축제 마지막 `days[].endsAt`에서 24시간 뒤 크루를 보관하고, 이후 조회만 허용합니다. 보관 후 30일에는 멤버 존·상태와 집결 기록을 지우고 멤버 목록은 유지합니다.

## 검증 기준과 남은 연동

- DTO 검증, 인증, 멤버/크루장 권한, 만료·정원·중복, 상태 역전과 중복 전송, 집결 간격, 양도/탈퇴 경쟁 상태를 테스트합니다.
- `crew.status`/`crew.gather` 푸시는 SocialNotificationService에서 처리합니다. 크루 상태 변경은 같은 트랜잭션에서 개인화 Live Activity 갱신을 큐에 기록하고, 작업자가 유효한 Activity 토큰에 APNs `update`를 전송합니다. 현재 상태는 GET 라이브 보드에서도 조회됩니다. 서버 전송 경로와 별개로 실제 기기 화면 갱신은 유효 토큰으로 검증해야 합니다.
- 크루 해산 시 삭제 전 크루장과 모든 멤버의 푸시 수신 기기를 큐에 기록하고, 크루가 삭제된 뒤에도 `crew.status` 알림 `크루가 해산됐어요`를 전달합니다. 사용자의 푸시 수신 동의와 전송 시점의 기기 토큰을 확인합니다.
- 초대 조회 제한은 현재 IP 기준입니다. 명세의 디바이스당 10회 제한을 적용하려면 검증된 디바이스 식별자를 인증 없는 요청에 연결해야 합니다.
