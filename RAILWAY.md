# Railway 배포 가이드

FestiCore 백엔드는 Railway에서 **develop / production** 두 환경으로 운영한다.

| 환경       | 연결 브랜치 | 용도          |
| ---------- | ----------- | ------------- |
| develop    | `develop`   | 개발/스테이징 |
| production | `main`      | 운영          |

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
참조를 건다.

- `DATABASE_URL` — 내부(사설망) URL. 런타임·CLI가 최우선 사용
- `DATABASE_PUBLIC_URL` — 내부 URL이 없을 때만 폴백. 서버 인증 없이 자격증명을 보내지 않도록
  `DB_SSL_CA`(인증서 검증) 또는 `DB_SSL_INSECURE=true`(명시적 옵트인)가 없으면 부팅이 실패한다

## 3. 환경변수 (서비스 Variables)

`railway.toml`에서 `NODE_ENV=production`(두 환경)과 `DEV_LOGIN_ENABLED=true`(develop만)는 자동 설정된다.
추가로 설정할 값:

```
PORT=3000
PUBLIC_URL=https://<환경별-도메인>          # Swagger 서버 표기용
CORS_ORIGINS=https://<허용-origin>          # 쉼표 구분
JWT_ACCESS_SECRET=<랜덤>                    # 필수
JWT_REFRESH_SECRET=<다른 랜덤>              # 필수, access 와 달라야 함(같으면 부팅 실패)
JWT_ACCESS_TTL=30m
JWT_REFRESH_TTL=14d
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=                          # 개행은 \n
```

로컬은 같은 키를 `.env`에 둔다(로컬 DB는 `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME`, 기본 DB명 `festicore`).

## 4. 배포 설정

`railway.toml`에 정의됨:

- Builder: Dockerfile
- Start: `node dist/main`
- Healthcheck: `/api/v1/health` (DB `SELECT 1` 실패 시 503 → 배포 실패로 드러남)
- 스키마: prod 는 `synchronize` off, 부팅 시 `migrationsRun` 으로 `src/database/migrations` 실행

## 5. 배포 방식 (브랜치 자동 배포 + 릴리스 태그)

배포는 **Railway GitHub 연동**이 담당한다. 브랜치에 푸시하면 Railway가 해당 커밋을
빌드·배포하고 대시보드에 커밋 메시지·SHA를 표시한다.

- `develop` 브랜치 푸시 → **develop** 환경 배포
- `main` 브랜치 푸시 → **production** 환경 배포

`.github/workflows/auto-tag.yml`는 배포를 하지 않고, 푸시된 커밋에 대해
**릴리스 기록용 태그**만 자동 생성한다(`develop` → `dev-v*`, `main` → `v*`).

## 6. 확인

- 헬스체크: `https://<도메인>/api/v1/health`
- Swagger: `https://<도메인>/api-docs` (도메인별: `/api-docs/auth`)
