# 기기·축제 구독 API

기기 ID는 앱이 생성해 Keychain에 보관하는 UUID v4다. 모든 기기·구독 API는 `Authorization: Bearer <access JWT>`와 `X-Device-Id` 헤더를 필수로 받는다. 서버는 JWT 사용자와 기기에 저장된 소유자를 대조한다. `X-Device-Secret`은 사용하지 않는다. 축제 팩 조회 API에는 기기 헤더가 필요 없다. 로그인 전 기기 등록은 지원하지 않는다. 기존 익명 기기나 다른 계정의 기기는 새 JWT로 인수할 수 없다. 계정을 바꾸려면 이전 계정으로 기기를 삭제한 뒤 새 계정으로 등록한다. 이전 계정에 접근할 수 없으면 앱에서 새 UUID v4를 생성해야 한다.

기존 `/devices/{deviceId}` 호출은 지원하지 않는다. 앱은 경로에서 기기 ID를 제거하고 `X-Device-Id` 헤더로 옮겨야 한다. 이 계약은 API 명세서 v0.1의 경로보다 최신 기기 헤더 요청을 우선한다.

## `PUT /api/v1/devices`

기존 기기 갱신에는 같은 소유자의 access JWT가 필요하다. `liveActivityPushToStartToken`을 생략하면 기존 값이 유지되고, 명시적 `null`을 보내면 삭제한다. `apnsToken` 키는 항상 보내며 값이 없으면 `null`을 보낸다. `apnsEnvironment`는 앱의 APNs entitlement 값에 맞춰 `sandbox` 또는 `production`으로 보낸다. TestFlight는 `production`이며 Railway 개발/운영 환경과 별개다.

본문:

```json
{
  "apnsToken": null,
  "apnsEnvironment": "sandbox",
  "liveActivityPushToStartToken": null,
  "appVersion": "1.0.0",
  "osVersion": "18.0",
  "locale": "ko-KR",
  "timezone": "Asia/Seoul"
}
```

APNs 토큰은 제공할 때 2~256자 짝수 길이 hex 문자열이다. JSON 응답은 `{"code":"SUCCESS","data":{"deviceId":"UUID","userId":"사용자 UUID","subscriptions":[]},"message":"성공적으로 처리되었습니다."}` 형식이다. 다른 계정 또는 기존 익명 기기 ID의 토큰을 교체하려는 요청은 403이다.

## Live Activity

- `PUT /api/v1/devices/live-activity`: `{"festivalId":"fst_...","activityId":"앱 Activity ID","pushToken":"hex"}`. 공개된 축제의 활성 Activity 하나를 등록 또는 교체한다. 성공 204.
- `DELETE /api/v1/devices/live-activity`: 현재 Activity 토큰을 삭제한다. 성공 204.

## 기기 조회·삭제

- `GET /api/v1/devices`: 현재 기기의 등록 정보만 반환한다. 푸시 토큰은 응답에 포함하지 않는다.
- `DELETE /api/v1/devices`: 기기와 구독 및 대기 중인 알림 작업을 삭제한다. 성공 204.

## 축제 알림 구독

`GET /api/v1/notifications/subscriptions`, `PUT /api/v1/notifications/subscriptions/{festivalId}`, `DELETE /api/v1/notifications/subscriptions/{festivalId}`를 사용한다. PUT 본문은 `{"festivalStarts":true,"packUpdates":true}`다. 경로의 `festivalId`는 구독 대상이며 기기 식별과 무관하다. 공개된 축제에 대해서만 새 구독을 저장한다. 성공 응답의 `data`는 두 설정을 모두 포함한다. 회원 탈퇴 시 해당 계정 기기의 구독과 푸시 토큰을 삭제한다. 발송 규칙은 [notifications.md](./notifications.md)를 따른다.

공개 Swagger: `/api-docs/devices`. 관리자 Swagger에는 포함하지 않는다.
