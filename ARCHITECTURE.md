# FestiCore Backend 아키텍처 규율

NestJS 기반 백엔드. **가벼운 클린 아키텍처**를 지향한다. 계층 분리는 지키되, 규모에 맞지 않는 과한 추상화(포트/어댑터 남발, 불필요한 인터페이스)는 만들지 않는다.

## 폴더 구조

```
src/
  main.ts                 부트스트랩 (prefix, helmet, CORS, ValidationPipe, Swagger)
  app.module.ts           루트 모듈 (Config, TypeORM, Gateway, 기능 모듈)
  swagger.ts              /api-docs 전체 + /api-docs/<slug> 도메인별 문서
  gateway/                전역 HTTP 경계 (필터·인터셉터·Throttler·JwtAuthGuard)
  config/                 설정 팩토리 (auth, typeorm, db-ssl)
  common/                 횡단 관심사 (api-domains, filters, interceptors, interfaces)
  database/               CLI data-source, migrations
  modules/<도메인>/
    <도메인>.module.ts
    controller/           HTTP 진입점 (얇게 유지)
    service/              비즈니스 로직
    (필요 시 dto/, entity/, guard/, decorator/, types/)
```

## 계층 규칙

- **Controller**는 얇게: 요청/응답 변환과 서비스 호출만. DB/ORM 직접 접근 금지.
- **Service**가 비즈니스 로직을 소유. 외부 의존(외부 API)은 주입받는다. 도메인이 커지면 `service/`를 여러 파일로 분리하되, 미리 인터페이스를 만들지 않는다.

## 공통 규약

- **응답**: 모든 성공 응답은 `ResponseInterceptor`가 `{ success, statusCode, data, message }`로 감싼다.
- **에러**: 모든 예외는 `AllExceptionsFilter`가 `{ success:false, statusCode, data:null, message }`로 변환.
- **인증**: 전역 `JwtAuthGuard`가 기본. 공개 라우트만 `@Public()`.
- **설정**: `ConfigService`로만 환경변수 접근. `process.env` 직접 사용 지양(config 팩토리·main 예외).
- **API prefix**: 전역 `api/v1`. Swagger 문서는 `/api-docs`.
- **새 도메인 추가**: `modules/<도메인>` 생성 → `modules/index.ts` 등록 → `common/api-domains.ts` + `swagger.ts`의 `MODULES_BY_SLUG` 등록 → `.spec/<도메인>.md` 작성.
- **DB**: TypeORM + Postgres. `DATABASE_URL` 우선, 없으면 `DATABASE_PUBLIC_URL`(SSL 검증 필수) 또는 `DB_*`. dev 는 synchronize, prod 는 마이그레이션.

## 검증

- 엔드포인트 스펙(`.spec/*.md`)과 e2e(`test/*.e2e-spec.ts`)로 확인한다.
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`.

## 배포

- [RAILWAY.md](./RAILWAY.md). `develop`/`main` 브랜치 자동 배포, `dev-v*`/`v*` 태그(GitHub Actions).
