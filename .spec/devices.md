# 기기·축제 구독 API

기기 ID는 앱이 생성해 Keychain에 보관하는 UUID v4다. 최초 `PUT /api/v1/devices`는 로그인 없이 가능하며 `deviceAccessToken`을 한 번 발급한다. 이후 기기·구독 API에는 `Authorization: Bearer <deviceAccessToken>`과 `X-Device-Id`가 필요하다. 로그인 계정이 소유한 기기는 계정 access JWT를 사용한다. 서버는 토큰과 저장된 소유자를 대조한다. `X-Device-Secret`은 사용하지 않는다. 축제 팩 조회 API에는 기기 헤더가 필요 없다. 기존 익명 기기나 다른 계정의 기기는 UUID만으로 인수할 수 없다. 계정 전환 시 기존 소유자 인증으로 기기를 삭제한 뒤 등록한다. 인증을 잃었다면 새 UUID v4가 필요하다.

기존 `/devices/{deviceId}` 호출은 지원하지 않는다. 앱은 경로에서 기기 ID를 제거하고 `X-Device-Id` 헤더로 옮겨야 한다. 이 계약은 API 명세서 v0.1의 경로보다 최신 기기 헤더 요청을 우선한다.

## `PUT /api/v1/devices`

기존 기기 갱신에는 같은 소유자의 Bearer가 필요하다. 익명 기기 갱신 시 같은 기기 식별자를 담은 `deviceAccessToken`을 다시 발급하며 기존 토큰도 만료 전까지 유효하다. 응답을 받지 못해 재시도해도 기기가 잠기지 않는다. `liveActivityPushToStartToken`을 생략하면 기존 값이 유지되고, 명시적 `null`을 보내면 삭제한다. `apnsToken` 키는 항상 보내며 값이 없으면 `null`을 보낸다. `apnsEnvironment`는 앱의 APNs entitlement 값에 맞춰 `sandbox` 또는 `production`으로 보낸다. TestFlight는 `production`이며 Railway 개발/운영 환경과 별개다.

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

APNs 토큰은 제공할 때 2~256자 짝수 길이 hex 문자열이다. JSON 응답은 `{"code":"SUCCESS","data":{"deviceId":"UUID","userId":null,"deviceAccessToken":"JWT","subscriptions":[]},"message":"성공적으로 처리되었습니다."}` 형식이다. 계정 기기에는 `deviceAccessToken`이 없다. 다른 계정 또는 기존 익명 기기 ID의 토큰을 교체하려는 요청은 403이다.

## Live Activity

- `PUT /api/v1/devices/live-activity`: `{"festivalId":"fst_...","activityId":"앱 Activity ID","pushToken":"hex"}`. 공개된 축제의 활성 Activity 하나를 등록 또는 교체한다. 성공 204.
- `DELETE /api/v1/devices/live-activity`: 현재 Activity 토큰을 삭제한다. 성공 204.

## 기기 조회·삭제

- `GET /api/v1/devices`: 현재 기기의 등록 정보만 반환한다. 푸시 토큰은 응답에 포함하지 않는다.
- `DELETE /api/v1/devices`: 기기와 구독 및 대기 중인 알림 작업을 삭제한다. 성공 204.

## 축제 알림 구독

`GET /api/v1/notifications/subscriptions`, `PUT /api/v1/notifications/subscriptions/{festivalId}`, `DELETE /api/v1/notifications/subscriptions/{festivalId}`를 사용한다. PUT 본문은 `{"pinned":true,"reminders":true,"packUpdates":false}`다. `pinned`는 필수다. 새 핀의 `reminders`와 `festivalStarts` 기본값은 true, `packUpdates`는 false다. 기존 구독을 수정하면서 생략한 알림 설정은 유지한다. 기존 알림 구독은 마이그레이션에서 핀으로 이관하고, 이전 `festivalStarts` 동의값으로 D-1 `reminders`를 설정한다. `pinned:false`로 바꾸면 시작 알림은 꺼지지만 구독 행은 보존한다. 구독 PUT은 인증된 기기별 분당 10회로 제한한다. 경로의 `festivalId`는 구독 대상이며 기기 식별과 무관하다. 공개된 축제에 대해서만 저장한다. `PUT /api/v1/notifications/subscriptions/{festivalId}/pack-download`에 현재 발행된 `packVersion`을 보내면 팩 다운로드를 기록한다. 회원 탈퇴 시 해당 계정 기기와 구독, 푸시 토큰을 삭제한다. 발송 규칙은 [notifications.md](./notifications.md)를 따른다.

공개 Swagger: `/api-docs/devices`. 관리자 Swagger에는 포함하지 않는다.
