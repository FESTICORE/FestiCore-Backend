---
paths:
  - "src/modules/**"
  - "src/gateway/**"
  - "src/common/**"
---

# 기능 모듈 경로 규칙

상세 문서: `docs/architecture/ARCHITECTURE.md`, API 계약: `.spec/<도메인>.md`

## Hard

- Controller는 요청 · 응답 변환과 service 호출만 한다. TypeORM import · `query` · `createQueryBuilder` · `@InjectRepository`를 두지 않는다. (check-boundaries가 검사)
- 비즈니스 로직은 service가 소유하고 외부 API는 주입받는다. 미리 인터페이스를 만들지 않는다.
- 공개 라우트만 `@Public()`을 붙인다. 기본은 전역 `JwtAuthGuard`다.
- JSON 응답 · 오류 형식(`{ code, data, message }`)은 `ResponseInterceptor` · `AllExceptionsFilter`에 맡긴다.
- 새 도메인은 `modules/index.ts` · `common/api-domains.ts` · `swagger.ts`의 `MODULES_BY_SLUG`에 등록하고 `.spec/<도메인>.md`를 쓴다.
- 토큰 · 비밀 값 · 개인정보는 로그와 테스트 실패 메시지에 넣지 않는다.

## Soft (기존 코드가 다르면 기존 코드를 따른다)

- 환경변수는 `ConfigService`로 읽는다. `process.env`는 config 팩토리 · main에서만 쓴다.
- 새 controller는 `controller/`, service는 `service/` 폴더에 둔다.
- 바뀐 엔드포인트는 `test/*.e2e-spec.ts`와 `.spec/*.md`를 함께 고친다.
