# 스펙: 헬스체크 (Health)

## 개요

서버 및 DB 상태를 확인하는 엔드포인트. Railway 헬스체크와 운영 모니터링에 사용한다.

## 엔드포인트

| 메서드 | 경로             | 인증   |
| ------ | ---------------- | ------ |
| GET    | `/api/v1/health` | 불필요 |

## 응답

정상(200) — 전역 `ResponseInterceptor`가 감싼다.

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "status": "ok",
    "uptime": 12.34,
    "timestamp": "2026-10-20T12:00:00.000Z",
    "db": "up"
  },
  "message": "성공적으로 처리되었습니다."
}
```

DB 프로브(`SELECT 1`) 실패(503) — `AllExceptionsFilter` 표준 에러.

```json
{
  "success": false,
  "statusCode": 503,
  "data": null,
  "message": "데이터베이스에 연결할 수 없습니다."
}
```

## 검증 기준

- DB 정상 → 200, `data.status === "ok"`, `data.db === "up"`
- DB 실패 → 503, `success === false`
- 대응 테스트: [test/health.e2e-spec.ts](../test/health.e2e-spec.ts)
