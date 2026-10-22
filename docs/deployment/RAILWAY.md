# Railway 배포 가이드

FestiCore 백엔드는 Railway에서 **develop / production** 두 환경으로 운영한다.

| 환경       | 연결 브랜치 | API 도메인                             | 용도          |
| ---------- | ----------- | -------------------------------------- | ------------- |
| develop    | `develop`   | `https://festicore-dev.up.railway.app` | 개발/스테이징 |
| production | `main`      | `https://festicore.up.railway.app`     | 운영          |

## 1. 프로젝트/환경 구성

Railway 프로젝트 **FestiCore** (Roy's Projects). Cider 프로젝트와 같은 형태로 환경마다 서비스 2개를 둔다.

| 서비스              | 소스                                           | 역할                     |
| ------------------- | ---------------------------------------------- | ------------------------ |
| `FestiCore-Backend` | GitHub `FESTICORE/FestiCore-Backend`           | NestJS API (Dockerfile)  |
| `Postgres`          | `ghcr.io/railwayapp-templates/postgres-ssl:18` | DB (`DATABASE_URL` 제공) |

- `production` 환경 → `main` 브랜치 자동 배포
- `develop` 환경(production 복제) → `develop` 브랜치 자동 배포
- 로컬 연결: `railway link --project FestiCore` 후 `railway environment <develop|production>`

## 2. 플러그인 추가 (환경마다 각각)

각 환경에 **Postgres** 플러그인을 추가하고 서비스 변수에 `DATABASE_URL=${{Postgres.DATABASE_URL}}`
참조를 건다. 공개 팩 캐시를 사용할 환경에는 Redis 서비스를 연결하고 백엔드 서비스 변수에
`REDIS_URL=${{Redis.REDIS_URL}}` 참조를 건다. Redis는 선택 의존이며 URL이 없거나
연결에 실패해도 공개 팩 조회는 DB로 동작한다.
Redis 클라이언트는 `family: 0`으로 IPv4·IPv6를 모두 허용하므로 Railway 사설망이
IPv6 주소만 제공하는 환경에서도 연결할 수 있다.

- `DATABASE_URL` — 내부(사설망) URL. 런타임·CLI가 최우선 사용
- `DATABASE_PUBLIC_URL` — 내부 URL이 없을 때만 폴백. 서버 인증 없이 자격증명을 보내지 않도록
  `DB_SSL_CA`(인증서 검증) 또는 `DB_SSL_INSECURE=true`(명시적 옵트인)가 없으면 부팅이 실패한다

## 3. 환경변수 (서비스 Variables)

`railway.toml`에서 `NODE_ENV=production`(두 환경)은 자동 설정된다.
추가로 설정할 값:

```
PORT=3000
PUBLIC_URL=https://<환경별-도메인>          # Swagger 서버 표기용
CORS_ORIGINS=https://<허용-origin>          # 쉼표 구분
WS_MAX_CLIENTS=5000                         # 공개 축제 팩 WebSocket 인스턴스별 연결 상한
WS_MAX_CLIENTS_PER_IP=500                  # 공용 Wi-Fi/NAT를 고려한 IP별 상한
JWT_ACCESS_SECRET=<랜덤>                    # 필수
JWT_REFRESH_SECRET=<다른 랜덤>              # 필수, access 와 달라야 함(같으면 부팅 실패)
JWT_ACCESS_TTL=30m
JWT_REFRESH_TTL=14d
CURRENT_TERMS_ENFORCED=false                # 앱 약관 화면 배포·검증 후 true로 전환
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_MOBILE_CLIENT_IDS=                     # iOS/Android OAuth client ID, 쉼표 구분. 웹 ID는 GOOGLE_CLIENT_ID
WEB_OAUTH_CLIENT_ORIGIN=https://<웹-클라이언트-origin> # 슬래시 없는 고정 HTTPS origin
APPLE_CLIENT_ID=
APPLE_WEB_CLIENT_ID=co.festiCore.io
APPLE_WEB_REDIRECT_URI=https://<환경별-도메인>/api/v1/auth/apple/callback
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=                          # 개행은 \n
APNS_TEAM_ID=                              # APNs Auth Key의 Apple Team ID
APNS_KEY_ID=                               # APNs Auth Key ID
APNS_PRIVATE_KEY=                          # APNs .p8 키, 개행은 \n
APNS_BUNDLE_ID=                            # iOS 앱 bundle ID (apns-topic)
APPLE_REVOKE_ENCRYPTION_KEY=                # Apple 폐기 재시도 토큰 암호화: 32바이트 base64 또는 64자리 hex, 환경별 별도 키
RAILWAY_BUCKET_NAME=                        # 각 환경의 비공개 이미지 버킷
RAILWAY_BUCKET_REGION=
RAILWAY_BUCKET_ENDPOINT=
RAILWAY_BUCKET_ACCESS_KEY_ID=
RAILWAY_BUCKET_SECRET_ACCESS_KEY=
# 또는 AWS_S3_BUCKET_NAME, AWS_DEFAULT_REGION, AWS_ENDPOINT_URL,
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY로 대체 가능
AWS_S3_URL_STYLE=virtual                    # 엔드포인트가 경로 방식이면 path
```

로컬은 같은 키를 `.env`에 둔다(로컬 DB는 `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME`, 기본 DB명 `festicore`).

기존 앱은 가입 정보 화면이 없으므로 새 API 배포 시 `CURRENT_TERMS_ENFORCED=false`로 둔다.
앱에서 `GET /me`의 약관 상태와 `TERMS_REQUIRED` 처리를 검증한 뒤 develop에서 먼저
`true`로 켜고 쓰기·탈퇴·해제 경로를 확인한 다음 production에 적용한다.
설정이 없거나 `false`이면 약관 동의값은 저장하지만 쓰기 제한은 하지 않는다.

공개 팩 WebSocket은 `wss://<환경별-도메인>/api/v1/festivals/updates`에서 제공한다.
브라우저 Origin은 `CORS_ORIGINS`에 있어야 하며 네이티브 앱의 Origin 없는 연결은 허용한다.
연결이 끊겼거나 앱이 백그라운드에 있는 동안 놓친 변경은 저장된 팩 버전과
`GET /api/v1/festivals`의 ETag를 비교해 다시 받아야 한다. Railway 프록시의
실제 WSS 연결과 모바일 재접속은 각 환경에 배포된 뒤 확인한다.

Google 웹은 Google Identity Services에서 받은 ID 토큰을 모바일 앱과 동일한
`POST /api/v1/auth/login`에 `{ "provider": "google", "token": "<idToken>" }`으로 보낸다.
웹 클라이언트의 승인된 JavaScript 원본에는 실제 웹사이트의 HTTPS origin을 등록한다.
백엔드의 Google 리디렉션 URI는 사용하지 않는다. `GOOGLE_CLIENT_ID`는 웹 클라이언트 ID,
`GOOGLE_MOBILE_CLIENT_IDS`는 iOS/Android 클라이언트 ID 목록이며,
백엔드는 이 목록으로 ID 토큰의 audience를 검증한다.

이미지 저장은 Railway 환경마다 분리된 비공개 버킷을 사용한다. 현재 개발 버킷은
`festicore-images-dev`, 운영 버킷은 `festicore-images-prod`이다. 버킷 자격증명은
각 환경의 변수 참조로 설정하고 저장소·문서에 실제 값을 기록하지 않는다.
이미지 저장 서비스는 WebP 변환과 키·크기 검증을 수행한다. 실제 버킷 업로드는
현재 CI에서 검증하지 않으므로 배포 후 별도 스모크 검증이 필요하다.

Apple Services ID `co.festiCore.io`의 웹 인증 도메인에는
`festicore.up.railway.app`, `festicore-dev.up.railway.app`을 등록했다. Return URL은
각 도메인의 `https://<도메인>/api/v1/auth/apple/callback`으로 등록했다.
현재 iOS Apple 로그인은 앱의 identity token과 authorization code를
`POST /api/v1/auth/login`에 전송하므로 이 웹 Return URL을 사용하지 않는다.
웹 Apple 로그인은 `/api/v1/auth/apple/start`에서 시작하며 POST(form_post) 콜백에서
state와 nonce를 검증한다. 웹 티켓 교환은 백엔드와 동일한 origin만 허용한다.
Apple 토큰 폐기가 실패하면 탈퇴 트랜잭션에서 암호화된 재시도 작업을 저장한다.
`APPLE_REVOKE_ENCRYPTION_KEY`를 develop/production 모두에 먼저 설정해야 한다.
작업자는 1분마다 최대 10건을 처리하고 최대 12회 지수 간격으로 재시도한다.
12회 실패한 작업은 `apple_revoke_retries.exhaustedAt`에 표시되며 운영 점검이 필요하다.
기존 암호문이 남아 있는 동안 키를 변경하면 복호화할 수 없으므로 키를 보존해야 한다.

축제 시작 알림은 발행된 팩의 `days[].startsAt`에서 예약되며 서버 프로세스가
매분 대기 작업을 확인한다. `APNS_*` 네 변수는 develop/production 서비스에 각각
설정한다. 키의 topic·환경 권한이 실제 iOS 앱과 일치해야 한다. 기기 등록 API의
`apnsEnvironment`는 앱 entitlement를 기준으로 `sandbox` 또는 `production`을
보내며 Railway 환경명으로 추측하지 않는다. TestFlight 토큰은 `production`이다.
APNs HTTP 200은 Apple 서버의 수락 결과이며 실기기 수신 증거는 아니다.

## 관리자 인증 배포 조건

관리자 권한에는 환경별로 `ADMIN_OWNER_EMAIL`과 `ADMIN_WEB_URL`을 설정하고,
관리자 웹의 origin을 `CORS_ORIGINS`에도 포함한다. 최초 owner는 해당 이메일의
확인된 Google 로그인이 완료된 뒤 사용자 ID에 연결된다. 기존 관리자 계정의
미연결 행은 연결 전까지 관리자 API에 접근할 수 없다.

관리자 웹은 일반 `POST /api/v1/auth/login`으로 받은 Bearer access JWT를 사용한다.
별도 관리자 쿠키·매직 링크 설정은 필요하지 않다. 일반 로그아웃은 refresh 토큰을
폐기하며 이미 발급된 access JWT는 만료까지 유효하다. 관리자 권한 비활성화는
다음 요청부터 적용된다.

## 4. 배포 설정

`railway.toml`에 정의됨:

- Builder: Dockerfile
- Start: `node dist/main`
- Healthcheck: `/api/v1/health` (DB `SELECT 1` 실패 시 503 → 배포 실패로 드러남)
- Redis 상태는 health 응답의 `data.redis` (`up`/`down`/`disabled`)에서 확인한다. Redis 장애만으로는 503이 되지 않는다.
- 스키마: prod 는 `synchronize` off, 부팅 시 `migrationsRun` 으로 `src/database/migrations` 실행

## 5. 배포 방식 (브랜치 자동 배포 + 릴리스 태그)

배포는 **Railway GitHub 연동**이 담당한다. 브랜치에 푸시하면 Railway가 해당 커밋을
빌드·배포하고 대시보드에 커밋 메시지·SHA를 표시한다.

- `develop` 브랜치 푸시 → **develop** 환경 배포
- `main` 브랜치 푸시 → **production** 환경 배포

`.github/workflows/auto-tag.yml`는 배포를 하지 않고, 푸시된 커밋에 대해
**릴리스 기록용 태그**만 자동 생성한다(`develop` → `dev-v*`, `main` → `v*`).

## 6. 확인

- 개발 헬스체크: `https://festicore-dev.up.railway.app/api/v1/health`
- 운영 헬스체크: `https://festicore.up.railway.app/api/v1/health`
- 개발 Swagger: `https://festicore-dev.up.railway.app/api-docs`
- 운영 Swagger: `https://festicore.up.railway.app/api-docs`
- OpenAPI JSON: 각 도메인의 `/api-docs-json`; 도메인별 문서는
  `/api-docs/health`, `/api-docs/auth`, `/admin/api-docs/accounts`,
  `/admin/api-docs/festivals`에 있다.

2026-10-21 기준 두 환경 모두 `/api-docs`와 `/api-docs-json`이 HTTP 200을
반환했다. 응답 확인은 최신 코드가 해당 환경에 배포되었다는 증거와 구분한다.
