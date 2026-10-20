# FestiCore-Backend

페스티코어(FestiCore) 백엔드. NestJS 11 + TypeORM(Postgres), Railway 배포.

## 구성

| 영역    | 내용                                                                |
| ------- | ------------------------------------------------------------------- |
| common  | 표준 응답/에러 형식, 예외 필터, 로깅·응답 인터셉터, API 도메인 목록 |
| gateway | 전역 Throttler·JwtAuthGuard(`@Public` 예외)·필터·인터셉터           |
| swagger | `/api-docs` 전체, `/api-docs/<도메인>` 도메인별 문서                |
| auth    | Google·Apple 소셜 로그인, JWT access/refresh 회전, 회원 탈퇴        |
| health  | `GET /api/v1/health` — DB 실패 시 503                               |

구조와 규칙은 [ARCHITECTURE.md](./ARCHITECTURE.md), 엔드포인트 명세는 [.spec/](./.spec/README.md),
배포는 [RAILWAY.md](./RAILWAY.md)를 본다.

## 로컬 실행

```bash
npm install
# .env 작성(변수 목록은 RAILWAY.md 3절). 최소: DB_* 와 서로 다른 JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/api-docs`

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
