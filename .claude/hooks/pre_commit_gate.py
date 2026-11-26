"""git pre-commit 게이트 본체. 자격 증명 · 환경 파일이 스테이징됐거나 커밋될 index의 코드가
verify 통과 시점과 다르면 커밋을 막는다. (docs/agent/harness.md)

Claude 훅(check_git_rules.py)은 git commit 명령만 보지만, 이 게이트는 사람이 직접 커밋하거나
같은 명령 안에서 고친 뒤 commit -a 해도 실제 index로 판정한다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I 실행이라 직접 넣는다
import check_git_rules as rules  # noqa: E402  금지 파일 규칙을 Claude 훅과 같게 쓴다
import harness_state as hs  # noqa: E402


def staged_forbidden(root):
    """스테이징된 .DS_Store · .env · 키 · 자격 증명 파일. 지우는 변경은 통과시킨다."""
    out = hs.git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    return [p for p in out.split("\0")
            if p and (rules.SECRET_RE.search(p) or p == ".DS_Store" or p.endswith("/.DS_Store"))]


def main():
    root = hs.repo_root(".")
    forbidden = staged_forbidden(root)
    if forbidden:
        sys.stderr.write(f"[커밋 게이트] 자격 증명 · 환경 파일이 스테이징돼 있습니다({', '.join(forbidden[:5])}).\n"
                         "'git rm --cached <경로>'로 빼세요. 규칙: docs/agent/harness.md\n")
        return 1
    files = hs.staged_unverified(root)
    if not files:
        return 0
    shown = ", ".join(files[:5]) + (f" 외 {len(files) - 5}개" if len(files) > 5 else "")
    sys.stderr.write(f"[검증 게이트] 커밋할 코드가 verify 통과 시점과 다릅니다({shown}).\n"
                     ".claude/scripts/verify로 통과를 확인한 뒤 커밋하세요. 규칙: docs/agent/harness.md\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
