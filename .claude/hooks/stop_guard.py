"""Stop 훅: 검증하지 않은 코드 변경이 있으면 한 번 종료를 막고 verify를 안내한다. (docs/agent/harness.md)

- 같은 응답에서 이미 한 번 막았으면(stop_hook_active) 그대로 끝낸다. 무한 반복을 막기 위해서다.
- 문서(*.md)만 바뀌었으면 막지 않는다.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness_state as hs  # noqa: E402


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    if data.get("stop_hook_active"):
        return
    try:
        root = hs.repo_root(data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or ".")
        files = hs.unverified(root)
    except Exception:  # 훅 오류로 세션을 막지 않는다
        return
    if not files:
        return
    shown = ", ".join(files[:5]) + (f" 외 {len(files) - 5}개" if len(files) > 5 else "")
    print(json.dumps({
        "decision": "block",
        "reason": (f"검증하지 않은 코드 변경이 있습니다({shown}). "
                   ".claude/scripts/verify를 실행해 통과를 확인하거나, 검증하지 못한 이유를 사용자에게 보고하세요. "
                   "검증하지 않은 결과를 완료로 보고하지 않습니다."),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
