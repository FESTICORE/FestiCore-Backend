"""PostToolUse(Read · Skill) 훅: 하네스 문서 · 규칙 · .spec · 스킬 사용을 로컬에 기록한다. (docs/agent/harness.md 관측)

기록: .claude/state/usage.jsonl (git 제외). 경로와 스킬 이름만 남기고 사용자 입력은 남기지 않는다.
리포트: .claude/scripts/harness-report
"""
import json
import os
import sys
import time

HARNESS_PREFIXES = ("docs/", ".claude/rules/", ".claude/agents/", ".spec/", "AGENTS.md", "CLAUDE.md")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or "."
    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input", {}) or {}
    if tool == "Skill":
        target = "skill:" + str(tool_input.get("skill", ""))
    elif tool == "Read":
        path = os.path.relpath(os.path.abspath(str(tool_input.get("file_path", ""))), root)
        if not path.startswith(HARNESS_PREFIXES):
            return
        target = path
    else:
        return
    state = os.path.join(root, ".claude", "state")
    try:
        os.makedirs(state, exist_ok=True)
        with open(os.path.join(state, "usage.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "target": target}, ensure_ascii=False) + "\n")
    except OSError:
        pass


if __name__ == "__main__":
    main()
