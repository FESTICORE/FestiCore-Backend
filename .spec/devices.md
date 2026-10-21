# 기기·축제 구독 API

기기 ID는 앱이 생성해 Keychain에 보관하는 UUID v4다. 모든 기기 API는 `X-Device-Id` 헤더로 이 ID를 받는다. 축제 팩 조회 API에는 기기 헤더가 필요 없다. `PUT /api/v1/devices` 최초 호출 시 서버가 256비트 `deviceSecret`을 한 번 반환한다. 앱은 이 값을 Keychain에 보관하고 이후 기기 변경 요청에 `X-Device-Secret` 헤더로 보낸다. 서버에는 SHA-256 해시만 저장한다. 계정 로그인 전에는 Authorization 헤더를 생략하고, 로그인 후에는 `Bearer` access token을 보내면 기기를 계정에 연결한다. 계정 변경도 같은 기기 비밀값이 필요하다. 잘못된 JWT는 익명 요청으로 취급하지 않고 401을 반환한다. UUID만으로는 타인의 APNs 토큰을 교체할 수 있으므로 비밀값 검증을 유지한다.

기존 `/devices/{deviceId}` 호출은 지원하지 않는다. 앱은 경로에서 기기 ID를 제거하고 `X-Device-Id` 헤더로 옮겨야 한다. 이 계약은 API 명세서 v0.1의 경로보다 최신 기기 헤더 요청을 우선한다.

## `PUT /api/v1/devices`

기존 기기를 계정 JWT 없이 갱신하더라도 기기 비밀값이 필요하며 계정 연결은 유지한다. `liveActivityPushToStartToken`을 생략하면 기존 값이 유지되고, 명시적 `null`을 보내면 삭제한다. `apnsToken` 키는 항상 보내며 값이 없으면 `null`을 보낸다. `apnsEnvironment`는 앱의 APNs entitlement 값에 맞춰 `sandbox` 또는 `production`으로 보낸다. TestFlight는 `production`이며 Railway 개발/운영 환경과 별개다.

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

APNs 토큰은 제공할 때 2~256자 짝수 길이 hex 문자열이다. JSON 응답은 `{"code":"SUCCESS","data":{"deviceId":"UUID","userId":null,"subscriptions":[],"deviceSecret":"64자 hex"},"message":"성공적으로 처리되었습니다."}` 형식이다. `deviceSecret`은 최초 등록 응답의 `data`에만 존재한다. 비밀값 분실 시 임의의 기기 ID로 재등록할 수 없으므로 앱에서 새 UUID를 생성해야 한다. 소유권 증명 없이 기존 기기의 토큰을 교체하려는 요청은 403이다.

## Live Activity

- `PUT /api/v1/devices/live-activity`: `{"festivalId":"fst_...","activityId":"앱 Activity ID","pushToken":"hex"}`. 공개된 축제의 활성 Activity 하나를 등록 또는 교체한다. 성공 204.
- `DELETE /api/v1/devices/live-activity`: 현재 Activity 토큰을 삭제한다. 성공 204.

## 기기 조회·삭제

- `GET /api/v1/devices`: 현재 기기의 등록 정보만 반환한다. 푸시 토큰과 비밀값은 응답에 포함하지 않는다.
- `DELETE /api/v1/devices`: 기기와 구독 및 대기 중인 알림 작업을 삭제한다. 성공 204.

## 축제 알림 구독

`GET /api/v1/notifications/subscriptions`, `PUT /api/v1/notifications/subscriptions/{festivalId}`, `DELETE /api/v1/notifications/subscriptions/{festivalId}`를 사용한다. PUT 본문은 `{"festivalStarts":true,"packUpdates":true}`다. 경로의 `festivalId`는 구독 대상이며 기기 식별과 무관하다. 공개된 축제에 대해서만 새 구독을 저장한다. 성공 응답의 `data`는 두 설정을 모두 포함한다. 회원 탈퇴 시 해당 계정 기기의 구독과 푸시 토큰을 삭제한다. 발송 규칙은 [notifications.md](./notifications.md)를 따른다.

공개 Swagger: `/api-docs/devices`. 관리자 Swagger에는 포함하지 않는다.
