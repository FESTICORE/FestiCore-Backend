---
paths:
  - "src/database/**"
  - "src/**/*.entity.ts"
---

# DB · 마이그레이션 경로 규칙

상세 문서: `docs/architecture/ARCHITECTURE.md`, `docs/deployment/RAILWAY.md`

## Hard

- 운영(`NODE_ENV=production`)은 synchronize를 끄고 부팅 때 `migrationsRun`으로 `src/database/migrations`를 자동 적용한다. develop · main에 머지되면 바로 개발 · 운영 DB에 적용된다.
- 엔티티를 바꾸면 같은 PR에 마이그레이션을 더한다. 파일은 `<13자리 타임스탬프>-<이름>.ts`, 클래스 이름은 타임스탬프로 끝나고 `name`이 클래스 이름과 같다. 타임스탬프는 develop의 마지막 마이그레이션보다 뒤다. (verify migrations 단계가 검사)
- 이미 머지된 마이그레이션 파일은 고치지 않는다. 바꿀 내용은 새 마이그레이션으로 쓴다.
- `down`을 구현하고 기존 데이터 보존 · 되돌리기를 확인한다.
- 마이그레이션 실행은 `npm run migration:run`(safe-migration-cli)으로 한다. SQL 매개변수를 로그에 남기지 않는다.

## Soft (기존 코드가 다르면 기존 코드를 따른다)

- 데이터 보정 마이그레이션은 `<파일>.spec.ts` 또는 `.postgres.spec.ts`로 검사한다.
- 로컬 Postgres에서 `migration:generate … --dryrun --check`로 엔티티와 동기인지 본다.
