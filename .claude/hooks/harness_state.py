"""하네스 공용 상태: 코드 변경 판별 · 작업 트리 지문 · 검증 기록. (docs/agent/harness.md)

verify(.claude/scripts/verify) · 커밋 게이트(check_git_rules.py) · 종료 확인(stop_guard.py)이 함께 쓴다.
상태는 .claude/state/(git 제외)에 둔다.
"""
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time

# 검증이 필요한 코드 경로. 문서(*.md)만 바뀌면 검증하지 않는다.
CODE_DIRS = ("src", "test", "scripts", ".claude/hooks", ".claude/scripts")
CODE_FILES = ("package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "nest-cli.json",
              "eslint.config.mjs", ".prettierrc", "Dockerfile", "railway.toml", ".claude/settings.json")
STATE_DIR = os.path.join(".claude", "state")
VERIFY_FILE = os.path.join(STATE_DIR, "verify.json")
MAX_FAILURES = 2  # 같은 단계가 이 횟수만큼 연속 실패하면 사용자에게 보고한다


def git(root, *args, env=None):
    # 개인 전역 gitignore(예: .claude/)는 보지 않는다. 저장소 .gitignore만 적용해 하네스 파일 변경도 코드 변경으로 본다.
    return subprocess.run(
        ["git", "-C", root, "-c", "core.excludesFile=/dev/null", *args],
        capture_output=True, text=True, env=env, check=True, timeout=30,
        stdin=subprocess.DEVNULL,
    ).stdout


def is_doc(path):
    return path.endswith(".md")


def is_code(path):
    if is_doc(path):
        return False
    return path in CODE_FILES or any(path.startswith(d + "/") for d in CODE_DIRS)


def repo_root(start):
    return git(start, "rev-parse", "--show-toplevel").strip()


def base_ref(root):
    """비교 기준: develop과 갈라진 지점. 원격이 없으면 로컬 develop."""
    for ref in ("origin/develop", "develop"):
        try:
            return git(root, "merge-base", "HEAD", ref).strip()
        except subprocess.CalledProcessError:
            continue
    return "HEAD"


def changed_code_files(root):
    """develop 이후 바뀐 코드 파일(커밋 · 스테이징 · 작업 중 · 새 파일 모두)."""
    tracked = git(root, "diff", "--name-only", base_ref(root)).splitlines()
    untracked = git(root, "ls-files", "--others", "--exclude-standard").splitlines()
    return sorted({p for p in tracked + untracked if is_code(p)})


def present_code_paths(root):
    return [p for p in CODE_DIRS + CODE_FILES if os.path.exists(os.path.join(root, p))]


def fingerprint(root):
    """작업 트리의 코드 파일 내용 지문. 커밋으로 나눠 담아도 내용이 같으면 같은 값이다.

    실제 index는 건드리지 않는다. 복사한 임시 index에 담아 tree를 만든다(git stash를 쓰지 않는다).
    """
    fd, index = tempfile.mkstemp(prefix="harness-index-")
    os.close(fd)
    try:
        real_index = git(root, "rev-parse", "--path-format=absolute", "--git-path", "index").strip()
        if os.path.exists(real_index):
            shutil.copyfile(real_index, index)  # stat 정보를 살려 다시 해시하지 않게 한다
        else:
            os.unlink(index)
        env = dict(os.environ, GIT_INDEX_FILE=index)
        paths = present_code_paths(root)
        if paths:
            git(root, "add", "-A", "--", *paths, env=env)
        tree = git(root, "write-tree", env=env).strip()
        listing = git(root, "ls-tree", "-r", tree, "--", *CODE_DIRS, *CODE_FILES).splitlines()
        code = [line for line in listing if is_code(line.split("\t", 1)[-1])]
        return hashlib.sha256("\n".join(code).encode()).hexdigest()
    finally:
        if os.path.exists(index):
            os.unlink(index)


def load(root):
    try:
        with open(os.path.join(root, VERIFY_FILE), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(root, state):
    os.makedirs(os.path.join(root, STATE_DIR), exist_ok=True)
    state["at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    with open(os.path.join(root, VERIFY_FILE), "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def unverified(root):
    """검증이 필요한데 마지막 통과 기록과 지문이 다르면 바뀐 코드 파일 목록을 돌려준다."""
    files = changed_code_files(root)
    if not files:
        return []
    state = load(root)
    if state.get("passed") and state.get("fingerprint") == fingerprint(root):
        return []
    return files
