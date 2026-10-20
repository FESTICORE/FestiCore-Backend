# FestiCore-Backend

페스티코어(FestiCore) 백엔드. NestJS 11 + TypeORM(Postgres), Railway 배포.

## 구성

| 영역    | 내용                                                                |
| ------- | ------------------------------------------------------------------- |
| common  | 표준 응답/에러 형식, 예외 필터, 로깅·응답 인터셉터, API 도메인 목록 |
| gateway | 전역 Throttler·JwtAuthGuard(`@Public` 예외)·필터·인터셉터           |
| swagger | `/api-docs` 전체, `/api-docs/<도메인>` 도메인별 문서                |
| auth    | Google·Apple 통합 로그인, JWT access/refresh 회전, 회원 탈퇴      |
| admin   | 관리자 매직 링크 인증, 축제 초안·발행·롤백                       |
| storage | Railway 비공개 버킷의 WebP 사진 저장·읽기                       |
| health  | `GET /api/v1/health` — DB 실패 시 503                               |

구조와 규칙은 [아키텍처 문서](./docs/architecture/ARCHITECTURE.md), 엔드포인트 계약은 [.spec/](./.spec/README.md),
배포는 [Railway 문서](./docs/deployment/RAILWAY.md)를 본다. 문서 전체 목록은 [docs/](./docs/README.md)에 있다.

## 로컬 실행

```bash
npm install
# .env 작성(변수 목록은 docs/deployment/RAILWAY.md). 최소: DB_* 와 서로 다른 JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/api-docs`
- 개발 Swagger: https://festicore-dev.up.railway.app/api-docs
- 운영 Swagger: https://festicore.up.railway.app/api-docs

Swagger UI의 드롭다운에서 전체·인증·관리자 인증·축제 관리 문서를 선택할 수 있다.
브라우저 호출에는 해당 환경의 유효한 인증 정보가 필요하다. 두 환경의 Swagger UI와 JSON 문서가
HTTP 200을 반환하는 것은 확인했으며, 최신 `develop` 배포 여부는 Railway 배포 상태로 별도 확인한다.

## 스크립트

| 명령                         | 설명                           |
| ---------------------------- | ------------------------------ |
| `npm run start:dev`          | 개발 서버(watch)               |
| `npm run build`              | 빌드(`dist/`)                  |
| `npm run lint`               | ESLint                         |
| `npm test`                   | 단위 테스트                    |
| `npm run test:e2e`           | e2e(DB 없이 인메모리 저장소)   |
| `npm run migration:generate` | 마이그레이션 생성(`-- <경로>`) |
| `npm run migration:run`      | 마이그레이션 실행              |

## 브랜치 / 배포

- `develop` → Railway **develop** 환경, `main` → **production** 환경 자동 배포
- 푸시 시 릴리스 태그 자동 생성(`dev-v*` / `v*`)
