#!/bin/bash
# Git 규칙 검사 훅 진입점 (Claude Code PreToolUse · Bash). 설명: docs/agent/harness.md
#
# 모든 Bash 명령마다 실행된다. git commit / push · gh pr create / merge가 아니면 bash 문자열 비교만 하고 끝낸다.
# 해당하면 check_git_rules.py를 한 번 실행해 브랜치 · main 대상 PR · 커밋 메시지 · 스테이징 파일 · 검증 기록을 본다.
#
# 직접 실행 (Codex 등 훅이 없는 환경):
#   bash .claude/hooks/check-git-rules.sh --check-message "설명 추가 #396"
#   bash .claude/hooks/check-git-rules.sh --check-branch "feature/agent-harness"

py="$(dirname "$0")/check_git_rules.py"

if [ $# -gt 0 ]; then
  exec python3 -I -S "$py" "$@"
fi

input=$(cat)
case "$input" in
  *git*commit*|*git*push*|*gh*pr*create*|*gh*pr*merge*) printf '%s' "$input" | exec python3 -I -S "$py" ;;
  *) exit 0 ;;
esac
