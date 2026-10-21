# 기기·축제 구독 API

기기 ID는 앱이 생성해 Keychain에 보관하는 UUID v4다. `PUT /api/v1/devices/{deviceId}` 최초 호출 시 서버가 256비트 `deviceSecret`을 한 번 반환한다. 앱은 이 값을 Keychain에 보관하고 이후 모든 기기 API 요청에 `X-Device-Secret` 헤더로 보낸다. 서버에는 SHA-256 해시만 저장한다. 계정 로그인 전에는 Authorization 헤더를 생략하고, 로그인 후에는 `Bearer` access token을 보내면 기기를 계정에 연결한다. 계정 변경도 같은 기기 비밀값이 필요하다. 잘못된 JWT는 익명 요청으로 취급하지 않고 401을 반환한다.

## `PUT /api/v1/devices/{deviceId}`

기존 기기를 인증 없이 갱신하면 계정 연결은 유지한다. `liveActivityPushToStartToken`을 생략하면 기존 값이 유지되고, 명시적 `null`을 보내면 삭제한다. `apnsToken` 키는 항상 보내며 값이 없으면 `null`을 보낸다.

본문:

```json
{
  "apnsToken": null,
  "liveActivityPushToStartToken": null,
  "appVersion": "1.0.0",
  "osVersion": "18.0",
  "locale": "ko-KR",
  "timezone": "Asia/Seoul"
}
```

APNs 토큰은 제공할 때 2~256자 짝수 길이 hex 문자열이다. 응답은 `{"deviceId":"UUID","userId":null,"subscriptions":[],"deviceSecret":"64자 hex"}` 형식이다. `deviceSecret`은 최초 등록 응답에만 존재한다. 비밀값 분실 시 임의의 기기 ID로 재등록할 수 없으므로 앱에서 새 UUID를 생성해야 한다. 소유권 증명 없이 기존 기기의 토큰을 교체하려는 요청은 403이다.

## Live Activity

- `PUT /api/v1/devices/{deviceId}/live-activity`: `{"festivalId":"fst_...","activityId":"앱 Activity ID","pushToken":"hex"}`. 공개된 축제의 활성 Activity 하나를 등록 또는 교체한다. 성공 204.
- `DELETE /api/v1/devices/{deviceId}/live-activity`: 현재 Activity 토큰을 삭제한다. 성공 204.

## 축제 팩 변경 구독

`PUT /api/v1/devices/{deviceId}/subscriptions/{festivalId}` 본문은 `{"packUpdates":true}`다. 공개된 축제에 대해서만 저장한다. 성공 응답은 `{"festivalId":"fst_...","packUpdates":true}`다. 회원 탈퇴 시 해당 계정 기기의 구독과 푸시 토큰을 삭제한다.

공개 Swagger: `/api-docs/devices`. 관리자 Swagger에는 포함하지 않는다.
