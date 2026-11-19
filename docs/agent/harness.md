# 에이전트 하네스

하네스는 에이전트가 일하는 환경 전체다. 규칙 문서, 경로별 규칙, 훅, 검증 스크립트로 이루어진다. CIRQLE-Native-Mobile 하네스를 FestiCore-iOS와 같은 구조로 옮기고 NestJS에 맞게 바꿨다.

- 프롬프트 지시는 확률이고 실행되는 검사는 보장이다. 같은 실수가 반복되면 문서보다 검사로 막는다.
- 규칙은 Hard(반드시)와 Soft(기존 코드가 다르면 기존 코드)로 나누고, 경로별로 나눠 해당 파일을 다룰 때만 읽게 한다.

## 구성

| 종류 | 위치 | 역할 |
| --- | --- | --- |
| 진입점 · 아키텍처 | `CLAUDE.md` · `docs/architecture/ARCHITECTURE.md` | 계층 · 공통 규약 |
| 경로별 규칙 | `.claude/rules/modules.md`(`src/modules` · `gateway` · `common`) · `database.md`(`src/database` · `*.entity.ts`) | frontmatter `paths`로 적용 |
| 훅 | `.claude/hooks/*` + `.claude/settings.json` | git 규칙 강제 · 종료 확인 · 사용 기록 |
| 스크립트 | `.claude/scripts/verify` · `check-boundaries` · `harness-report` | 검증 · 계층 경계 · 사용 리포트 |
| 로컬 상태 | `.claude/state/` (git 제외) | `verify.json` · 단계별 로그 · `usage.jsonl` |

## 훅

| 이벤트 | 스크립트 | 내용 |
| --- | --- | --- |
| `PreToolUse` (Bash) | `check-git-rules.sh` → `check_git_rules.py` | 아래 검사 |
| `PostToolUse` (Read · Skill) | `usage_log.py` | `docs/` · `.claude/rules/` · `.spec/` · 스킬 사용 기록 |
| `Stop` | `stop_guard.py` | 검증 안 된 코드 변경이 있으면 응답 종료를 한 번 막는다 |

`git commit` · `git push` · `gh pr create` · `gh pr merge` 검사:

1. `develop` · `main`에서 커밋 · 푸시 금지, 두 브랜치로 직접 푸시 · 삭제 금지.
2. `main`은 운영 배포다. `--base main` PR 생성과 대상이 main인 PR 머지(`gh pr view`로 확인)를 막는다. 대상을 확인하지 못하면 막는다. 운영 승격은 사람이 한다.
3. 브랜치 이름: `<종류>/<영문 소문자 kebab-case>`. 종류는 git log에 실제로 쓰인 `feature` · `feat` · `fix` · `docs` · `refactor` · `test` · `chore` · `hotfix` · `release` · `sync`.
4. 커밋 제목: 한국어, 끝에 `#이슈번호`(예: `… #396`), 스쿼시 머지의 ` (#323)` 허용.
5. `Co-Authored-By` 금지(대소문자 무관, `--trailer` 포함).
6. `.DS_Store` · `.env`(`.env.example` 제외) · `*.pem|p8|p12|key` · `credentials*.json` 등 스테이징 금지.
7. 검증 게이트: 코드 변경이 있는데 `verify.json`의 통과 지문과 작업 트리 지문이 다르면 막는다.

- 저장소에 husky · lint-staged가 없고 `.git/hooks`는 git-lfs 훅뿐이라 합칠 기존 커밋 검사는 없다. 린트 · 타입 · 테스트는 CI(`backend-ci.yml`)와 같은 명령을 verify가 돌린다.
- 개인 전역 gitignore가 `.claude/`를 무시하면 하네스 파일은 `git add -f`로 올린다.

```bash
bash .claude/hooks/check-git-rules.sh --check-message "하네스를 더한다 #396" < /dev/null
bash .claude/hooks/check-git-rules.sh --check-branch "feature/agent-harness" < /dev/null
python3 -m unittest discover -s .claude/hooks/tests < /dev/null
```

## 검증 게이트

```bash
.claude/scripts/verify < /dev/null          # develop 이후 바뀐 코드에 맞는 단계만
.claude/scripts/verify --all < /dev/null    # eslint · jest 전체
.claude/scripts/verify --e2e < /dev/null    # 위에 npm run test:e2e 추가(Postgres 필요)
```

| 바뀐 경로 | 단계 | 명령 |
| --- | --- | --- |
| `.claude/hooks` · `scripts` · `settings.json` | harness-syntax · harness-tests | `bash -n` · JSON 파싱 · `unittest` |
| `src/` | boundaries | `check-boundaries --base <develop 분기점>`(바뀐 파일만) |
| `src/database/migrations/` · `*.entity.ts` | migrations | 이름 · 타임스탬프 순서 검사 + 자동 적용 경고 |
| `*.ts`(src · test) | lint · typecheck | `npx eslint <바뀐 파일>` · `npx tsc --noEmit --incremental false` |
| `src/` · `package*.json` · `tsconfig*` · `nest-cli.json` | build | `npm run build` |
| `src/modules/<모듈>`(admin은 `admin/<하위>`) · `src/<폴더>` | unit | `npx jest --runInBand <경로>` |
| `scripts/` | scripts | `npm run packs:test` · `test-publish-auto-tag.py` |

- `npm run lint`는 `--fix`로 파일을 고치므로 쓰지 않고 CI와 같은 `npx eslint`를 쓴다.
- `package*.json` · `tsconfig*`가 바뀌거나 `--all`이면 jest 전체를 돌린다. `.md`만 바뀌면 검증하지 않는다.
- e2e와 `*.postgres.spec.ts`는 Postgres가 필요하다(`DB_HOST`=localhost · `DB_PORT`=5432 · `DB_USERNAME`/`DB_PASSWORD`=postgres · `DB_NAME`=festicore, `LIVE_ACTIVITY_PG_URL`). 없으면 CI가 맡는다.
- 엔티티와 마이그레이션의 동기 여부는 DB 없이 알 수 없다. 로컬 Postgres에서 `npm run migration:run` 뒤 `npm run typeorm -- migration:generate src/database/migrations/Check --dryrun --check`로 본다.
- 모든 명령은 stdin `/dev/null`로 돌리고 출력은 `.claude/state/verify/<단계>.log`에 남긴다. 종료 코드를 파이프로 가리지 않는다.
- 통과하면 코드 내용 지문을 `verify.json`에 남긴다. 통과 후 코드를 고치면 다시 돌린다. 같은 단계가 연속 2번 실패하면 세 번째 전에 사용자에게 보고한다.

### 계층 경계 (`check-boundaries`)

| 규칙 (ARCHITECTURE.md "Controller는 DB/ORM 직접 접근 금지") | 대상 |
| --- | --- |
| Controller는 `typeorm` · `@nestjs/typeorm`을 import하지 않는다 | `src/**/*.controller.ts` |
| Controller는 `query` · `createQueryBuilder` · `getRepository` · `transaction` · `@InjectRepository`를 쓰지 않는다 | `src/**/*.controller.ts` |

- develop(aa6a8d8) 기준 기존 위반: `admin-festival-map.controller.ts`(import · `query`), `public-festival-map.controller.ts`(import). 규칙은 느슨하게 하지 않았다. 전체 검사는 실패하고, verify는 바뀐 파일만 보므로 이 두 파일을 고칠 때 service로 옮긴다.

## 관측과 한계

- `.claude/scripts/harness-report [--days 90]`: 문서 · 규칙 · 스킬 사용 횟수와 안 쓰인 문서.
- 훅은 실수를 막는 장치이지 보안 경계가 아니다. `env git commit` · 셸 변수 · 편집기 메시지, `gh api`로 하는 머지는 검사하지 않는다.
- `gh pr merge --squash`의 제목 · 본문은 검사하지 않는다. 직접 지정하고 머지 후 커밋 메시지를 확인한다.
- Codex에는 Claude 훅이 걸리지 않는다. 커밋 전에 위 직접 검사와 verify를 실행한다.
- 규칙을 바꾸면 같은 PR에서 문서와 훅을 함께 고친다.
