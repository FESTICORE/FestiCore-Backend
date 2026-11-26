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
8. 게이트 우회 금지: `git commit`에 훅을 건너뛰는 옵션(긴 이름 · 축약 · `-n` · `-an` 같은 묶음, `bash -c` 안 포함)을 쓰거나 `core.hooksPath`를 바꾸는(`config` · `--unset` · `git -c core.hooksPath=…` · `GIT_CONFIG_KEY_n`/`GIT_CONFIG_PARAMETERS` 환경 변수) 명령을 막는다. 조회와 `.githooks`로 켜는 명령은 통과한다.

- 저장소에 husky · lint-staged가 없다. 린트 · 타입 · 테스트는 CI(`backend-ci.yml`)와 같은 명령을 verify가 돌린다.

### git pre-commit 게이트 (`.githooks/pre-commit`)

Claude 훅은 `git commit` 명령만 보므로, 사람이 직접 커밋하거나 같은 명령 안에서 고친 뒤 `commit -a`하는 경우는 git 훅이 잡는다. `verify`가 실행될 때 `core.hooksPath`를 `.githooks`로 켠다. `core.hooksPath`를 켜면 `.git/hooks`의 git-lfs 훅은 쓰이지 않는데, 이 저장소는 LFS로 추적하는 파일이 없다.

- `pre_commit_gate.py`는 먼저 `.DS_Store` · `.env` · 키 · 자격 증명 파일이 추가 · 수정으로 스테이징됐으면 막는다(6번과 같은 규칙, 지우는 변경은 통과). 이어서 커밋될 index의 코드 파일을 `verify.json`의 `code`(통과 시점 파일별 `모드 blob`)와 대조한다. 하나라도 다르면 막는다. 지운 파일은 verify 때도 지워져 있어야 한다. 통과 기록이 없거나 `code`가 없는 옛 기록이면 코드 커밋을 막는다. 문서(`.md`)만 담은 커밋은 보지 않는다.
- 검증 뒤 작업 트리만 더 고치고 스테이징하지 않았다면, index가 검증 내용과 같으므로 커밋된다.
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
| `.claude/hooks` · `scripts` · `settings.json` · `.githooks` | harness-syntax · harness-tests | `bash -n`(훅 셸 · `.githooks`) · JSON 파싱 · `unittest` |
| 코드 변경 전체(`.github/workflows/` 포함) | security | `.claude/scripts/check-security` |
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
- 통과하면 코드 내용 지문과 코드 파일별 내용(`code`)을 `verify.json`에 남긴다. 통과 후 코드를 고치면 다시 돌린다. 같은 단계가 연속 2번 실패하면 세 번째 전에 사용자에게 보고한다.

### 보안 검사 (`check-security`)

추적 파일과 아직 추적하지 않은 파일(.gitignore 제외)을 모두 본다. 하나라도 걸리면 실패한다.

| 검사 | 대상 | 막는 것 |
| --- | --- | --- |
| 비밀 값 | 바이너리를 뺀 모든 파일 | 개인 키, GitHub · Slack · Atlassian · AWS · Google 키, Slack 웹훅, Sentry DSN |
| 워크플로 셸 주입 | `.github/workflows/*.yml` | `run`에 외부에서 정할 수 있는 값(`github.head_ref`, 이슈 · PR · 댓글 · 리뷰 · 토론의 제목 · 본문, 브랜치 이름 · 라벨, 커밋 메시지 · 작성자)을 `${{ }}`로 바로 넣는 것. env로 받아 `"$VAR"`로 쓴다 |

- 규칙을 더하려면 스크립트의 `FORBIDDEN` · `SECRET_PATTERNS`에 한 줄을 더하고 이 표에 같은 규칙을 적는다.
- CIRQLE-Native-Mobile의 `check-security`에서 범용 검사만 가져왔다(FestiCore iOS #619와 같다).

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
