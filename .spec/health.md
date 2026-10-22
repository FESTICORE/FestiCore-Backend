# 스펙: 헬스체크 (Health)

## 개요

서버와 DB 상태 및 선택 의존인 Redis 상태를 확인하는 엔드포인트. Railway 헬스체크와 운영 모니터링에 사용한다.

## 엔드포인트

| 메서드 | 경로             | 인증   |
| ------ | ---------------- | ------ |
| GET    | `/api/v1/health` | 불필요 |

## 응답

정상(200) — 전역 `ResponseInterceptor`가 감싼다.

```json
{
  "code": "SUCCESS",
  "data": {
    "status": "ok",
    "uptime": 12.34,
    "timestamp": "2026-10-20T12:00:00.000Z",
    "db": "up",
    "redis": "disabled"
  },
  "message": "성공적으로 처리되었습니다."
}
```

`data.redis`는 `REDIS_URL` 미설정 시 `disabled`, 연결 및 `PING` 성공 시 `up`, 실패 시 `down`이다. Redis 장애만으로는 503을 반환하지 않는다.

DB 프로브(`SELECT 1`) 실패(503) — `AllExceptionsFilter` 표준 에러.

```json
{
  "code": "SERVICE_UNAVAILABLE",
  "data": null,
  "message": "데이터베이스에 연결할 수 없습니다."
}
```

## 검증 기준

- DB 정상 → 200, `data.status === "ok"`, `data.db === "up"`
- Redis 상태 → `data.redis === "disabled" | "up" | "down"`; Redis 장애에도 DB가 정상이라면 200
- DB 실패 → 503, `code === "SERVICE_UNAVAILABLE"`, `data === null`
- 대응 테스트: [test/health.e2e-spec.ts](../test/health.e2e-spec.ts)
