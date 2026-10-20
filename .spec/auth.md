# 스펙: 소셜 로그인 (Auth)

## 개요

웹과 모바일 앱에서 **Google / Apple** SDK로 받은 자격증명을 백엔드로 보내 검증하고,
사용자로 매핑한 뒤 **자체 JWT(access/refresh)** 를 발급한다. provider별 검증 서비스는
분리하되 HTTP 엔드포인트는 하나로 통합한다.

## 인증 플로우

```
[웹 또는 앱] SDK 로그인
  → Google: idToken (+ 선택 serverAuthCode)
  → Apple: identityToken + authorizationCode(필수)
[웹 또는 앱] → [API] POST /api/v1/auth/login { provider, token, name?, authorizationCode? }
[API] provider별 서비스로 토큰 검증 (서명/aud/iss/exp)
  → SocialProfile { provider, providerId, email?, name?, picture? }
[API] 사용자 find-or-create (unique: provider + providerId)
[API] authorizationCode 가 있으면 provider refresh 토큰 교환·저장(탈퇴 시 revoke 용)
[API] 자체 JWT 발급 → { accessToken, refreshToken, newUser, user }
```

- 이후 요청은 `Authorization: Bearer <accessToken>`.
- 전역 `JwtAuthGuard`(Gateway)가 기본 인증을 강제하고, `@Public()` 라우트만 예외.

## Provider 분리

| 서비스          | 책임                     | 검증 방식                                                                                  |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `GoogleService` | Google idToken 검증      | `google-auth-library` `verifyIdToken` (aud=GOOGLE_CLIENT_ID 또는 GOOGLE_MOBILE_CLIENT_IDS) |
| `AppleService`  | Apple identityToken 검증 | Apple JWKS 서명 검증(`jose`), iss=`https://appleid.apple.com`, aud=APPLE_CLIENT_ID         |
| `TokenService`  | 자체 JWT 발급·회전       | access/refresh 별도 secret, `typ` 클레임, refresh 는 sha256 해시만 저장                    |
| `AuthService`   | 오케스트레이션           | 프로필 → find-or-create → JWT 발급/갱신/탈퇴                                               |

자격증명 미설정 provider는 비활성 — 로그인 시 `503`.

## 엔드포인트

| 메서드 | 경로                          | 인증   | 요청                                             | 설명                                              |
| ------ | ----------------------------- | ------ | ------------------------------------------------ | ------------------------------------------------- |
| POST   | `/api/v1/auth/login`          | 불필요 | `{ provider, token, name?, authorizationCode? }` | 소셜 로그인/가입. apple 은 authorizationCode 필수 |
| POST   | `/api/v1/auth/refresh`        | 불필요 | `{ refreshToken }`                               | access/refresh 재발급(회전, 1회용)                |
| POST   | `/api/v1/auth/logout`         | 필요   | -                                                | refresh 토큰 전체 폐기                            |
| GET    | `/api/v1/auth/me`             | 필요   | -                                                | 현재 사용자                                       |
| DELETE | `/api/v1/auth/me`             | 필요   | -                                                | 회원 탈퇴(provider revoke → 토큰·계정 삭제)       |
| DELETE | `/api/v1/auth/session`        | 필요   | -                                                | 현재 세션 종료                                    |
| GET    | `/api/v1/me`                  | 필요   | -                                                | 프로필 조회                                       |
| PATCH  | `/api/v1/me`                  | 필요   | 닉네임 등                                        | 프로필 수정                                       |
| DELETE | `/api/v1/me`                  | 필요   | -                                                | 탈퇴                                              |
| GET    | `/api/v1/auth/apple/start`    | 불필요 | -                                                | Apple 웹 로그인 시작                              |
| POST   | `/api/v1/auth/apple/callback` | 불필요 | `form_post`                                      | Apple 웹 콜백                                     |
| GET    | `/api/v1/auth/web/result`     | 불필요 | 일회용 브라우저 티켓                             | 웹 결과 전달                                      |
| POST   | `/api/v1/auth/web/token`      | 불필요 | 일회용 브라우저 티켓                             | 자체 토큰 교환                                    |

Apple 웹 로그인 설정: `APPLE_WEB_REDIRECT_URI`는 환경별
`https://<도메인>/api/v1/auth/apple/callback`이고,
`APPLE_WEB_CLIENT_ID=co.festiCore.io`이다. `WEB_OAUTH_CLIENT_ORIGIN`은 실제 웹 클라이언트의
고정 HTTPS origin이다. Google 웹은 Google Identity Services에서 받은 ID 토큰을 앱과 동일한 `POST /api/v1/auth/login`에 보낸다. 웹 클라이언트 ID는 `GOOGLE_CLIENT_ID`, 앱 클라이언트 ID는 `GOOGLE_MOBILE_CLIENT_IDS`에 설정한다.

### 로그인 응답

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "accessToken": "…",
    "refreshToken": "…",
    "newUser": true,
    "user": {
      "id": "uuid",
      "provider": "google",
      "email": "a@b.c",
      "nickname": "홍길동",
      "profileImageUrl": null
    }
  },
  "message": "성공적으로 처리되었습니다."
}
```

## 보안 규칙

- `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` 누락 또는 동일하면 부팅 실패.
- access 토큰 `typ=access`, refresh 토큰 `typ=refresh` — 가드는 access 만 통과시킨다.
- refresh 소비는 조건부 업데이트(`revokedAt IS NULL`)로 원자적 — 동시 재사용 시 하나만 성공.
- logout 후에도 이미 발급된 access 토큰은 만료(`JWT_ACCESS_TTL`, 기본 30m)까지 유효(의도된 트레이드오프).
- 첫 로그인 동시 경합으로 unique 위반(23505)이 나면 재조회해 기존 사용자로 처리.
- 에러 로그 바디 진단은 production 환경에서 항상 off, 인증 값(`token`, `authorizationCode` 등)은 가린다.
- 알려진 한계: refresh 와 logout 이 ms 단위로 겹치면 logout 직후 새 토큰이 발급될 수 있다.

## 실패 응답

| 상황                                    | 상태 |
| --------------------------------------- | ---- |
| 검증 실패(provider 값, apple code 누락) | 400  |
| 토큰 없음/무효/refresh 재사용           | 401  |
| provider 미설정                         | 503  |

## 검증 기준

- 대응 테스트: [test/auth.e2e-spec.ts](../test/auth.e2e-spec.ts), `src/config/auth.config.spec.ts`
