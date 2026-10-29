# 내 일정 API

Bearer access token이 필요하다. 응답은 공통 ResponseInterceptor 형식으로 감싼다. 사용자 ID는 본문에서 받지 않고 토큰에서 읽는다.

## PUT `/api/v1/me/schedule/{festivalId}`

공개된 해당 축제 팩의 공연 ID로 내 일정 전체를 교체한다. 빈 `setIds`는 일정을 비운다.

```json
{
  "setIds": ["set_a1b2c3d4"],
  "clientAt": "2026-10-21T12:00:00+09:00"
}
```

`setIds`는 중복 없는 0~60개이며, 모두 같은 축제의 공개 팩에 존재해야 한다. `clientAt`은 시간대가 포함된 ISO 8601 시각이다. 서버보다 5분 넘게 미래면 400이다. 저장된 값보다 오래되거나 같은 시각에 다른 목록을 보내면 409 `STATUS_STALE`와 현재 값을 반환한다. 같은 시각에 같은 목록을 재전송하면 쓰기 없이 기존 응답을 반환한다.

이전 발행 팩에 공연 `id`가 없어도 공개 팩 응답에서 공연 내용 기반의 안정적인 `set_...` ID를 제공한다. 일정 요청에는 공개 팩에서 받은 ID를 사용한다.

성공 `200` data 예시: `{"setIds":["set_a1b2c3d4"],"updatedAt":"2026-10-21T03:00:01.000Z"}`.

실제 일정이 저장되면 해당 축제의 사용자 중 갱신 대상으로 선택된 활성 Live Activity 기기의 의도를 같은 DB 트랜잭션에 기록한다. 활성 기기가 없으면 의도는 0건이다. 같은 시각·내용의 재전송이나 저장 전 거부된 요청은 의도를 추가하지 않는다. 의도 기록에 실패하면 일정 저장도 롤백한다.

오류: 400 형식 오류 또는 `VALIDATION`(없는 setId 목록), 401 인증 실패, 404 미공개/없는 축제, 409 `STATUS_STALE`.

## GET `/api/v1/me/schedule/{festivalId}`

기기 간 동기화를 위한 조회 API. 일정이 없으면 `200` data `{"setIds":[],"updatedAt":null}`. 없는/미공개 축제는 404다.

공개 Swagger: `/api-docs/schedule`. 관리자 Swagger에는 포함하지 않는다.
