"""Git 규칙 검사 (docs/agent/harness.md).

check-git-rules.sh가 git commit / push · gh pr create / merge가 보일 때만 호출한다.

  1) 보호 브랜치(main, develop)에 직접 커밋 · 푸시 금지, main · develop 삭제 금지
  2) main(운영 배포)을 대상으로 한 gh pr create · gh pr merge 금지. main 승격은 사람이 한다
  3) 작업 브랜치 이름: <종류>/<작업명, 영문 소문자 kebab-case> (git log의 feature · feat · fix · docs 등)
  4) 커밋 제목: 한국어로 쓰고 끝에 #이슈번호 (스쿼시 머지가 붙인 " (#PR번호)"는 허용)
  5) 커밋 메시지에 Co-Authored-By 금지
  6) .DS_Store · .env · 자격 증명 파일 커밋 금지
  7) 검증하지 않은 코드 커밋 금지(harness_state의 지문과 .claude/state/verify.json 비교)

위반하면 stderr에 이유를 쓰고 exit 2 → Claude Code가 명령을 막는다.
직접 실행: python3 check_git_rules.py --check-message "설명 추가 #1" / --check-branch "feature/x"
"""
import json
import os
import re
import shlex
import subprocess
import sys

BRANCH_KINDS = ("feature", "feat", "fix", "docs", "refactor", "test", "chore", "hotfix", "release", "sync")
BRANCH_RE = re.compile(r"^(?:" + "|".join(BRANCH_KINDS) + r")/[a-z0-9]+(-[a-z0-9]+)*$")
PROTECTED = {"main", "develop"}
HANGUL_RE = re.compile(r"[가-힣]")
ISSUE_SUFFIX_RE = re.compile(r"\S #[0-9]+( \(#[0-9]+\))?$")
CO_AUTHOR_RE = re.compile(r"co-authored-by", re.I)

GIT_OPTS = r"(?:\s+(?:-C|-c|--git-dir|--work-tree)\s+\S+|\s+-\S+)*"   # git -C 경로 commit 등
# 명령이 시작되는 자리(처음 · && · || · ; · | · 줄바꿈 · $( · ( 뒤)에 오는 git만 실제 명령으로 본다.
# echo "git commit" 같은 문자열이나 heredoc 본문 속 문장은 검사하지 않는다.
CMD_START = r"(?:^|&&|\|\||;|\||\n|\$\(|\()\s*(?:\w+=\S+\s+)*"
COMMIT_RE = re.compile(CMD_START + r"git" + GIT_OPTS + r"\s+commit(?:\s|$)")
PUSH_RE = re.compile(CMD_START + r"git" + GIT_OPTS + r"\s+push(?:\s|$)")
GH_PR_RE = re.compile(CMD_START + r"gh\s+pr\s+(create|merge)(?:\s|$)")
GH_BASE_MAIN_RE = re.compile(r"(?:--base|-B)[\s=]+['\"]?main['\"]?(?:\s|$)")
# 스테이징하면 안 되는 파일: .env(.example 제외) · 키 · 인증서 · 서비스 계정 JSON
SECRET_RE = re.compile(r"(?:^|/)(?:\.env(?:\.(?!example$)[^/]+)?|.*\.(?:pem|p8|p12|key)|"
                       r"(?:credentials|service-account|google-services)[^/]*\.json|id_rsa[^/]*)$")
SEPARATOR_RE = re.compile(r"&&|\|\||;|\||\n")
PUSH_DELETE_RE = re.compile(r"(?:--delete|-d)\s.*\b(?:main|develop)\b|\s:(?:main|develop)(?:\s|$)")
PUSH_PROTECTED_RE = re.compile(r"[\s:](?:main|develop)(?:\s|$)")
HEREDOC_RE = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?\s*\n(.*?)\n\s*\1", re.S)
PLACEHOLDER_RE = re.compile(r"@@HEREDOC(\d+)@@")
CD_RE = re.compile(r"(?:^|&&|;|\n)\s*cd\s+(\"[^\"]+\"|'[^']+'|\S+)")
GIT_C_RE = re.compile(r"git\s+-C\s+(\"[^\"]+\"|'[^']+'|\S+)")
HOOK_DIR = os.path.dirname(os.path.abspath(__file__))


def fail(reason):
    sys.stderr.write(f"[git 규칙 위반] {reason}\n규칙: docs/agent/harness.md\n")
    sys.exit(2)


def check_message(subject):
    if not HANGUL_RE.search(subject):
        fail(f"커밋 제목은 한국어로 씁니다. 입력: '{subject}'")
    if not ISSUE_SUFFIX_RE.search(subject):
        fail(f"커밋 제목 끝에 작업 이슈 번호를 '#396'처럼 붙입니다. 입력: '{subject}'")


def check_body(message):
    if CO_AUTHOR_RE.search(message):
        fail("커밋 메시지에 Co-Authored-By를 넣지 않습니다.")


def check_branch(branch):
    if branch in PROTECTED:
        fail(f"보호 브랜치 '{branch}'에는 직접 커밋 · 푸시하지 않습니다. feature/<작업명> 브랜치에서 develop으로 PR을 보내세요.")
    if not BRANCH_RE.match(branch):
        fail(f"브랜치 이름은 '<종류>/<작업명>'(종류: {', '.join(BRANCH_KINDS)}, 영문 소문자 kebab-case)입니다. 현재: '{branch}'")


def strip_heredocs(cmd):
    """heredoc 본문을 자리표시(@@HEREDOC{n}@@)로 바꾸고 본문 목록을 돌려준다."""
    bodies = []

    def keep(match):
        bodies.append(match.group(2))
        return f"<<{match.group(1)}\n@@HEREDOC{len(bodies) - 1}@@\n{match.group(1)}"

    return HEREDOC_RE.sub(keep, cmd), bodies


def segment(skeleton, match):
    """git 명령이 시작된 곳부터 다음 명령 구분자 전까지. $( 가 열려 있으면 끝까지 본다.

    `-F - <<EOF`처럼 heredoc을 여는 명령은 본문 자리표시까지 포함한다.
    """
    start = match.end()
    end = SEPARATOR_RE.search(skeleton, start)
    if end is None or "$(" in skeleton[start:end.start()]:
        return skeleton[start:]
    part = skeleton[start:end.start()]
    if "<<" in part:
        placeholder = PLACEHOLDER_RE.search(skeleton, end.start())
        if placeholder:
            return skeleton[start:placeholder.end()]
    return part


def commit_message(part, bodies):
    """커밋 메시지 전체. 실행 전에 알 수 없으면(편집기 · 셸 변수) None."""
    placeholder = PLACEHOLDER_RE.search(part)
    if placeholder:
        return bodies[int(placeholder.group(1))]
    try:
        tokens = shlex.split(part)
    except ValueError:
        return None
    messages = []
    for i, token in enumerate(tokens):
        if token in ("-m", "--message") and i + 1 < len(tokens):
            messages.append(tokens[i + 1])
        elif token.startswith("--message="):
            messages.append(token.split("=", 1)[1])
        elif token.startswith("-m") and len(token) > 2 and not token.startswith("--"):
            messages.append(token[2:])
        elif token in ("-F", "--file") and i + 1 < len(tokens):
            messages.append(read_file(tokens[i + 1]))
        elif token.startswith("--file="):
            messages.append(read_file(token.split("=", 1)[1]))
        elif token == "--trailer" and i + 1 < len(tokens):
            check_body(tokens[i + 1])
    messages = [m for m in messages if m is not None]
    if not messages:
        return None
    return "\n\n".join(messages)


def read_file(path):
    if path == "-":
        return None
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def subject_of(message):
    lines = [line.strip() for line in message.splitlines() if line.strip()]
    return lines[0] if lines else ""


def git(*args):
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True, timeout=3,
                              stdin=subprocess.DEVNULL).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def head_file(start):
    """.git/HEAD 경로를 찾는다. worktree에서는 .git이 'gitdir: …' 파일이라 그 gitdir의 HEAD를 본다."""
    current = os.path.abspath(start)
    while True:
        dot_git = os.path.join(current, ".git")
        if os.path.isdir(dot_git):
            return os.path.join(dot_git, "HEAD")
        if os.path.isfile(dot_git):
            try:
                with open(dot_git, encoding="utf-8") as f:
                    line = f.read().strip()
            except OSError:
                return None
            if not line.startswith("gitdir:"):
                return None
            gitdir = line[len("gitdir:"):].strip()
            if not os.path.isabs(gitdir):
                gitdir = os.path.join(current, gitdir)
            return os.path.join(gitdir, "HEAD")
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def current_branch(start="."):
    """HEAD 파일을 직접 읽는다(프로세스 생성 없음). 찾지 못할 때만 git을 부른다."""
    path = head_file(start)
    if path:
        try:
            with open(path, encoding="utf-8") as head:
                ref = head.read().strip()
            return ref[len("ref: refs/heads/"):] if ref.startswith("ref: refs/heads/") else "HEAD"
        except OSError:
            pass
    return git("rev-parse", "--abbrev-ref", "HEAD")


def command_dir(skeleton, first_git, base):
    """git 명령이 실제로 도는 폴더: 그 앞의 마지막 `cd 경로` 또는 `git -C 경로`. 없으면 훅 입력의 cwd."""
    def resolve(path):
        path = os.path.expanduser(path.strip("\"'"))
        return path if os.path.isabs(path) else os.path.join(base, path)

    target = base
    for m in CD_RE.finditer(skeleton[:first_git.start()]):
        target = resolve(m.group(1))
    git_c = GIT_C_RE.search(skeleton, first_git.start(), first_git.end())
    if git_c:
        target = resolve(git_c.group(1))
    return target if os.path.isdir(target) else base



def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--check-message":
        check_message(subject_of(sys.argv[2])); check_body(sys.argv[2]); print("OK"); return
    if len(sys.argv) == 3 and sys.argv[1] == "--check-branch":
        check_branch(sys.argv[2]); print("OK"); return

    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    cmd = data.get("tool_input", {}).get("command", "")

    skeleton, bodies = strip_heredocs(cmd)
    commit_matches = list(COMMIT_RE.finditer(skeleton))
    push_matches = list(PUSH_RE.finditer(skeleton))
    commits = [segment(skeleton, m) for m in commit_matches]
    pushes = [segment(skeleton, m) for m in push_matches]
    base = data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or "."
    for m in GH_PR_RE.finditer(skeleton):
        check_gh_pr(m.group(1), segment(skeleton, m), base)
    if not (commits or pushes):
        return

    first_git = min(commit_matches + push_matches, key=lambda m: m.start())
    os.chdir(command_dir(skeleton, first_git, base))
    branch = current_branch(".")
    if branch and branch != "HEAD":
        check_branch(branch)

    if any(PUSH_DELETE_RE.search(part) for part in pushes):
        fail("main · develop 브랜치는 삭제하지 않습니다.")
    if any(PUSH_PROTECTED_RE.search(part) for part in pushes):
        fail("보호 브랜치(main · develop)로 직접 푸시하지 않습니다. PR을 사용하세요.")
    if not commits:
        return

    for part in commits:
        message = commit_message(part, bodies)
        if message is not None:  # 편집기 · 셸 변수 메시지는 실행 전에 알 수 없어 검사하지 않는다
            subject = subject_of(message)
            if "$" not in subject:
                check_message(subject)
            check_body(message)

    staged = git("diff", "--cached", "--name-only").splitlines()
    if any(path == ".DS_Store" or path.endswith("/.DS_Store") for path in staged):
        fail(".DS_Store가 스테이징돼 있습니다. 'git rm --cached <경로>'로 빼세요.")
    secrets = [path for path in staged if SECRET_RE.search(path)]
    if secrets:
        fail(f"자격 증명 · 환경 파일이 스테이징돼 있습니다({', '.join(secrets[:5])}). 'git rm --cached <경로>'로 빼세요.")

    root = git("rev-parse", "--show-toplevel")
    if root:
        check_verified(root)


def check_gh_pr(action, part, base):
    """main은 운영 배포 브랜치다. main 대상 PR 생성 · 머지를 막는다."""
    if GH_BASE_MAIN_RE.search(part):
        fail("main(운영 배포) 대상 PR은 만들거나 머지하지 않습니다. 기능 PR은 develop으로 보냅니다.")
    if action != "merge":
        return
    try:
        tokens = shlex.split(part)
    except ValueError:
        tokens = []
    target = next((t for t in tokens if not t.startswith("-")), None)
    try:
        result = subprocess.run(["gh", "pr", "view", *([target] if target else []), "--json", "baseRefName",
                                 "-q", ".baseRefName"], cwd=base if os.path.isdir(base) else None,
                                capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        result = None
    if result is None or result.returncode != 0 or not result.stdout.strip():
        fail("머지할 PR의 대상 브랜치를 확인하지 못했습니다. main 머지는 운영 배포라 확인 없이 진행하지 않습니다. "
             "gh pr merge <번호>로 PR을 지정해 다시 실행하세요.")
    if result.stdout.strip() == "main":
        fail("main(운영 배포) 대상 PR은 머지하지 않습니다. 운영 승격은 사람이 직접 합니다.")


def check_verified(root):
    """검증 게이트: 코드 변경이 있는데 verify 통과 기록과 지문이 다르면 커밋을 막는다."""
    sys.path.insert(0, HOOK_DIR)  # -I 실행이라 직접 넣는다
    import harness_state as hs
    try:
        files = hs.unverified(root)
    except Exception:
        return  # 판단할 수 없으면 막지 않는다 (git 오류는 git이 직접 알린다)
    if files:
        shown = ", ".join(files[:5]) + (f" 외 {len(files) - 5}개" if len(files) > 5 else "")
        fail(f"검증하지 않은 코드 변경이 있습니다({shown}). "
             ".claude/scripts/verify로 통과를 확인한 뒤 커밋하세요. 통과 후 코드를 고쳤으면 다시 실행합니다.")


if __name__ == "__main__":
    main()
