# 관리자 대시보드 API

어드민 대시보드의 오늘 요약·참여율·추이를 서비스 DB에서 집계한다. 외부 서비스(Mixpanel·Sentry)는 쓰지 않는다. 모든 경로는 `viewer` 이상 관리자가 필요하고 `Cache-Control: no-store`로 응답한다. 스키마 변경은 없다.

| 메서드 | 경로 | 결과 |
| --- | --- | --- |
| GET | `/api/v1/admin/dashboard/summary` | 오늘(KST) 요약과 현재 참여율 |
| GET | `/api/v1/admin/dashboard/trends?from&to&granularity=day\|week` | 기간 추이 |

## summary

- `date`: 오늘 KST 날짜
- `newUsers`: 오늘 가입한 `users`
- `logins`: 오늘 발급한 `refresh_token_sessions`(로그인 횟수, 사용자 수 아님)
- `activeDevices`: 오늘 서버가 받은 `metric_events`의 고유 기기 수(인덱스가 있는 `receivedAt` 기준이라 오프라인에서 늦게 올린 이벤트는 받은 날로 센다)
- `totalUsers`: 전체 `users`
- `engagement`(0~1, 분모가 0이면 `null`)
  - `pushOptInRate`: 푸시 동의 사용자 / 전체 사용자
  - `flagFollowerRate`: 깃발을 하나 이상 팔로우한 사용자 / 전체 사용자
  - `crewMemberRate`: 크루에 속한 사용자 / 전체 사용자
  - `notificationReadRate`: 최근 30일 알림 중 읽은 비율, `notifications30d`는 그 분모

## trends

- `from`·`to`는 KST 날짜(포함), 오늘 이전, 최대 92일. 형식·범위 오류는 400.
- `granularity`는 `day`(기본) 또는 `week`(월요일 시작). 그 밖의 값은 400.
- 응답: `{ from, to, granularity, totalSignups, signups, logins, activeDevices, follows }`. 각 시계열은 `[{ date, count }]`이고 빈 구간은 0으로 채운다. 주 단위의 `date`는 그 주 월요일이다.
- `activeDevices`는 구간 안의 고유 기기 수라서 일 단위 값을 더해도 주 단위 값과 같지 않다.
