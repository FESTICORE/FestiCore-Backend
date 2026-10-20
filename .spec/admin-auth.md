# 관리자 인증 API

## 목적과 권한

등록된 관리자에게 매직 링크를 보내고, 일회용 토큰을 소비해 HttpOnly 세션 쿠키를 발급한다.
관리자 API는 이 쿠키와 역할(`viewer`, `editor`, `owner`)로 보호한다.

## 엔드포인트

| 메서드 | 경로 | 입력 | 결과/권한 |
| --- | --- | --- | --- |
| POST | `/api/v1/admin/auth/magic-link` | `{ "email": "admin@example.com" }` | 202. 등록 여부를 드러내지 않는 메시지 |
| GET | `/api/v1/admin/auth/callback?token=…` | 43자 일회용 토큰 | CSRF 확인 폼과 임시 쿠키 |
| POST | `/api/v1/admin/auth/callback` | 폼 `{ token, csrf }` | 토큰 소비, 관리자 세션 쿠키 설정, 관리자 웹으로 303 이동 |
| GET | `/api/v1/admin/auth/me` | 관리자 세션 쿠키 | 현재 관리자 정보 |
| POST | `/api/v1/admin/auth/logout` | 관리자 세션 쿠키 | 204, 세션 폐기와 쿠키 제거 |

## 실패와 보안

- 토큰 형식 오류는 400, CSRF·Origin 불일치는 403, 세션 부재는 401이다.
- 콜백 쿠키는 `HttpOnly`, 운영 HTTPS에서는 `Secure`이다. 세션 쿠키 범위는 `/api/v1/admin`이다.
- 매직 링크는 일회용이며 만료된다. 이메일 존재 여부를 요청 응답에 노출하지 않는다.
- 관리자 웹과 API를 교차 사이트로 배포하면 브라우저의 서드파티 쿠키 정책에 영향을 받는다.
  동일 사이트 도메인 또는 관리자 웹 프록시를 배포 시 정해야 한다.

## 검증

`src/modules/admin/auth/*.spec.ts`, `test/auth.e2e-spec.ts`에서 링크·CSRF·세션·권한을 확인한다.
