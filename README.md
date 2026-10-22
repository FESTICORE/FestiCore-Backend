# FestiCore Backend

**축제 일정·현장 정보·알림을 제공하는 FestiCore API 서버**

NestJS 11 · TypeScript 5 · PostgreSQL / TypeORM · Railway

[기술 스택](#기술-스택) · [구조](#구조) · [빠른 시작](#빠른-시작) · [api-문서](#api-문서) · [검증](#검증) · [배포](#배포)

## 프로젝트

FestiCore는 축제 목록과 상세·예매 링크·타임테이블, 오프라인 팩, 현장 깃발·크루, 기기별 알림을 제공합니다. 서버는 활성 크롤링 소스를 매일 **00:00 KST 이후 첫 점검**에 예약하며, 수집 결과는 관리자 검토와 공개 데이터 흐름을 거칩니다. 외부 사이트별 수집 성공 여부와 실제 저장 건수는 별도 운영 확인이 필요합니다.

Google·Apple 계정 로그인, JWT 토큰 회전, 기기 토큰, 축제 팩 갱신 WebSocket을 지원합니다. 관리자 웹은 [별도 AdminWeb 저장소](https://github.com/FESTICORE/AdminWeb)에서 개발합니다.

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| API | Node.js 22, NestJS 11, TypeScript 5 |
| 데이터 | PostgreSQL, TypeORM 마이그레이션 |
| 인증 | Google·Apple 로그인, JWT access/refresh, 관리자 역할 |
| 실시간·캐시 | WebSocket(`ws`), 선택적 Redis 캐시 |
| 이미지 | Railway 비공개 S3 호환 버킷, Sharp/WebP |
| 문서·검증 | Swagger/OpenAPI, Jest, ESLint, Docker·Postgres CI |
| 배포 | Railway `develop` / `production` 환경 |

## 구조

```text
src/
├── main.ts                 # 앱 부트스트랩·전역 API prefix
├── app.module.ts           # 루트 모듈
├── swagger.ts              # 공개/관리자 Swagger 분리
├── config/                 # 인증·DB·SSL 등 설정
├── database/               # TypeORM CLI·마이그레이션
├── gateway/                # 인증·요청 제한·로깅 공통 경계
├── common/                 # 응답·예외 처리 등 공통 규약
└── modules/
    ├── admin/              # 축제 초안·발행, 크롤링, 감사·권한
    ├── auth/               # Google·Apple 로그인과 토큰
    ├── public/             # 공개 축제·오프라인 팩·WebSocket
    ├── device/             # 기기 등록·핀·Live Activity
    ├── notification/       # 리마인더·축제 시작 알림
    ├── flags/              # 현장 깃발·신고
    ├── crews/              # 크루
    ├── schedule/           # 개인 일정
    ├── storage/            # 이미지 저장·읽기
    ├── metrics/            # 클라이언트 관측 이벤트
    └── health/             # DB 상태 확인
```

상세 설계는 [아키텍처](docs/architecture/ARCHITECTURE.md), 기능별 API 계약은 [.spec 목차](.spec/README.md), 문서 전체 목록은 [docs 목차](docs/README.md)를 봅니다. [API v0.2 반영 문서](.spec/api-v0.2-adoption.md)에는 명세와 구현 차이를 기록했습니다.

## 공통 API 규약

- API prefix는 `/api/v1`입니다. JSON 성공·오류 응답은 `code`, `data`, `message`를 사용합니다. HTML·WebSocket·204·304 응답은 해당 프로토콜 형식을 따릅니다.
- 사용자 로그인은 `POST /api/v1/auth/login` 한 경로에서 Google·Apple을 구분합니다. `POST /api/v1/auth/refresh`는 refresh 토큰을 회전하고, `POST /api/v1/auth/logout`은 세션을 폐기합니다. 프로필 조회·탈퇴는 `/api/v1/me`입니다.
- 기기 API는 등록 뒤 받은 기기 access 토큰을 `Authorization: Bearer`로 전달하며, 현재 계약에서는 `X-Device-Id`도 사용합니다. 자세한 요청·응답은 [기기 계약](.spec/devices.md)을 봅니다.
- 공개 축제 목록·상세는 `/api/v1/festivals`, 팩 갱신 WebSocket은 `/api/v1/festivals/updates`를 사용합니다. 공개 Swagger와 관리자 Swagger는 분리되어 있습니다.

## 빠른 시작

### 요구사항

- Node.js 22와 npm
- PostgreSQL 연결 및 서로 다른 JWT access/refresh 비밀값
- 이미지·Google·Apple·APNs 기능을 검증하려면 각 서비스의 환경별 자격 증명

```sh
git clone https://github.com/FESTICORE/FestiCore-Backend.git
cd FestiCore-Backend
npm ci
# 로컬 .env에 DB 연결과 JWT_ACCESS_SECRET, JWT_REFRESH_SECRET 설정
npm run migration:run
npm run start:dev
```

로컬 DB는 개별 `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`을 사용할 수 있습니다. 배포 환경에서는 `DATABASE_URL`을 우선 사용하고, 공개 DB URL 폴백은 인증서 검증 또는 명시적 옵트인이 필요합니다. Redis는 선택 사항이며 연결할 수 없으면 공개 팩 조회가 DB로 동작합니다. 변수 목록과 보안 설정은 [Railway 배포 가이드](docs/deployment/RAILWAY.md)를 확인하세요. 실제 비밀값은 저장소에 커밋하지 않습니다.

## API 문서

| 대상 | 로컬 주소 | 개발 환경 |
| --- | --- | --- |
| 공개 API | `http://localhost:3000/api-docs` | [공개 Swagger](https://festicore-dev.up.railway.app/api-docs) |
| 관리자 API | `http://localhost:3000/admin/api-docs` | [관리자 Swagger](https://festicore-dev.up.railway.app/admin/api-docs) |
| 헬스체크 | `http://localhost:3000/api/v1/health` | [개발 헬스체크](https://festicore-dev.up.railway.app/api/v1/health) |

운영 문서는 `https://festicore.up.railway.app`에서 같은 경로를 사용합니다. Swagger UI의 정의 선택 메뉴에서 영역별 문서를 열 수 있습니다. 배포된 문서가 최신 코드인지 여부는 해당 Railway 배포 커밋으로 확인해야 합니다.

## 검증

```sh
npx eslint 'src/**/*.ts' 'test/**/*.ts'  # 변경 없이 ESLint 검사
npx tsc --noEmit --incremental false    # 타입 검사
npm run build                           # Nest 빌드
npm test -- --runInBand                 # 단위 테스트
npm run test:e2e -- --runInBand         # HTTP E2E
```

`npm run lint`는 `--fix`가 포함되어 파일을 수정하므로 단순 검사에는 위 `npx eslint` 명령을 사용합니다. PR CI는 의존성 보안 검사, Docker 빌드, PostgreSQL 마이그레이션·헬스체크도 실행합니다. 로컬 단위·E2E 성공은 외부 OAuth, APNs, 크롤링 원본 및 운영 배포 성공을 증명하지 않습니다.

## 배포

| 환경 | Git 브랜치 | API 주소 | 태그 |
| --- | --- | --- | --- |
| 개발 | `develop` | `https://festicore-dev.up.railway.app` | `dev-v*` |
| 운영 | `main` | `https://festicore.up.railway.app` | `v*` |

Railway의 GitHub 브랜치 연결이 Dockerfile로 빌드·배포합니다. 기능 PR은 `develop`에 스쿼시 머지하고 개발 배포를 확인한 뒤 `main`으로 승격합니다. 태그 워크플로는 릴리스 기록을 남기며 태그 자체가 재배포를 실행하지는 않습니다. 환경별 Postgres·Redis·이미지 버킷 및 마이그레이션 절차는 [Railway 배포 가이드](docs/deployment/RAILWAY.md)에 있습니다.
