import importlib.machinery
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


HOOKS = pathlib.Path(__file__).resolve().parents[1]
REPO = HOOKS.parents[1]
SCRIPTS = REPO / ".claude" / "scripts"


def load_script(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def run(*args, cwd, check=True):
    return subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, check=check, stdin=subprocess.DEVNULL)


class GitRulesHookTests(unittest.TestCase):
    """실제 git 저장소(임시)에 훅을 복사해 PreToolUse 입력 그대로 실행한다."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="harness-test-")
        self.repo = os.path.join(self.tmp, "repo")
        os.makedirs(os.path.join(self.repo, "src"))
        shutil.copytree(HOOKS, os.path.join(self.repo, ".claude", "hooks"),
                        ignore=shutil.ignore_patterns("tests", "__pycache__"))
        run("git", "init", "-q", "-b", "develop", cwd=self.repo)
        run("git", "config", "user.name", "tester", cwd=self.repo)
        run("git", "config", "user.email", "tester@example.com", cwd=self.repo)
        with open(os.path.join(self.repo, "src", "a.ts"), "w") as f:
            f.write("export const a = 1;\n")
        shutil.copyfile(REPO / ".gitignore", os.path.join(self.repo, ".gitignore"))
        # 실제 저장소처럼 훅을 추적한다(개인 전역 gitignore가 .claude/를 무시해도).
        run("git", "-c", "core.excludesFile=/dev/null", "add", "-A", cwd=self.repo)
        run("git", "commit", "-q", "-m", "init", cwd=self.repo)
        run("git", "checkout", "-q", "-b", "feature/agent-harness", cwd=self.repo)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def hook(self, command, cwd=None):
        payload = json.dumps({"tool_input": {"command": command}, "cwd": cwd or self.repo})
        return subprocess.run(["bash", os.path.join(self.repo, ".claude", "hooks", "check-git-rules.sh")],
                              input=payload, capture_output=True, text=True)

    def direct(self, *args):
        return subprocess.run(["bash", os.path.join(self.repo, ".claude", "hooks", "check-git-rules.sh"), *args],
                              capture_output=True, text=True)

    def assertBlocked(self, result, text):
        self.assertEqual(2, result.returncode, result.stderr)
        self.assertIn(text, result.stderr)

    def test_non_git_command_passes(self):
        self.assertEqual(0, self.hook("ls -la").returncode)
        self.assertEqual(0, self.hook('echo "git commit -m x"').returncode)

    def test_valid_commit_passes(self):
        self.assertEqual(0, self.hook('git commit -m "하네스를 맞춘다 #396"').returncode)

    def test_protected_branch_commit_and_push_blocked(self):
        run("git", "checkout", "-q", "develop", cwd=self.repo)
        self.assertBlocked(self.hook('git commit -m "하네스를 맞춘다 #396"'), "보호 브랜치")
        self.assertBlocked(self.hook("git push origin develop"), "보호 브랜치")
        run("git", "checkout", "-q", "-b", "main", cwd=self.repo)
        self.assertBlocked(self.hook("git push"), "보호 브랜치")

    def test_push_to_protected_from_feature_blocked(self):
        self.assertBlocked(self.hook("git push origin HEAD:develop"), "직접 푸시")
        self.assertEqual(0, self.hook("git push -u origin feature/agent-harness").returncode)

    def test_branch_name(self):
        run("git", "checkout", "-q", "-b", "wip/harness", cwd=self.repo)
        self.assertBlocked(self.hook('git commit -m "하네스를 맞춘다 #396"'), "브랜치 이름")
        self.assertBlocked(self.direct("--check-branch", "feature/Agent_Harness"), "브랜치 이름")
        self.assertBlocked(self.direct("--check-branch", "feature/#27"), "브랜치 이름")
        for name in ("feature/more-settings-home", "fix/152-live-activity", "feat/admin-auth", "docs/api-specs"):
            self.assertEqual(0, self.direct("--check-branch", name).returncode, name)

    def test_english_subject_blocked(self):
        self.assertBlocked(self.hook('git commit -m "Add agent harness #396"'), "한국어")

    def test_missing_issue_number_blocked(self):
        self.assertBlocked(self.hook('git commit -m "하네스를 맞춘다"'), "이슈 번호")
        self.assertBlocked(self.hook('git commit -m "하네스를 맞춘다 #"'), "이슈 번호")
        self.assertBlocked(self.direct("--check-message", "#396 하네스를 맞춘다"), "이슈 번호")

    def test_env_and_credentials_blocked(self):
        for path in (".env", "config/.env.production", "keys/AuthKey_ABC.p8", "service-account.json"):
            full = os.path.join(self.repo, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            open(full, "w").close()
            run("git", "add", "-f", path, cwd=self.repo)
            self.assertBlocked(self.hook('git commit -m "설정을 더한다 #396"'), "자격 증명", )
            run("git", "rm", "-q", "--cached", path, cwd=self.repo)
        open(os.path.join(self.repo, ".env.example"), "w").close()
        run("git", "add", "-f", ".env.example", cwd=self.repo)
        self.assertEqual(0, self.hook('git commit -m "예시 설정을 더한다 #396"').returncode)

    def test_main_pr_blocked(self):
        self.assertBlocked(self.hook('gh pr create --base main --title "운영 반영 #396"'), "main(운영 배포)")
        self.assertBlocked(self.hook('gh pr create -B main'), "main(운영 배포)")
        self.assertBlocked(self.hook('gh pr merge 1 --squash --base main'), "main(운영 배포)")
        # 저장소에 원격이 없어 대상 브랜치를 확인할 수 없으면 막는다
        self.assertBlocked(self.hook('gh pr merge 1 --squash'), "대상 브랜치를 확인하지 못했습니다")
        self.assertEqual(0, self.hook('gh pr create --base develop --title "하네스 #396"').returncode)
        self.assertEqual(0, self.hook('gh pr list').returncode)

    def test_cirqle_type_prefix_is_not_required(self):
        self.assertEqual(0, self.direct("--check-message", "하네스를 맞춘다 #396").returncode)
        self.assertEqual(0, self.direct("--check-message", "S10 화면을 맞춘다 #396 (#510)").returncode)

    def test_heredoc_message_checked(self):
        command = "git commit -F - <<'EOF'\nAdd harness #396\n\n본문\nEOF"
        self.assertBlocked(self.hook(command), "한국어")
        command = "git commit -F - <<'EOF'\n하네스를 맞춘다 #396\n\n본문\nEOF"
        self.assertEqual(0, self.hook(command).returncode)
        command = 'git commit -m "$(cat <<\'EOF\'\nAdd harness #396\n\n본문\nEOF\n)"'
        self.assertBlocked(self.hook(command), "한국어")

    def test_co_authored_by_blocked(self):
        command = ('git commit -m "$(cat <<\'EOF\'\n하네스를 맞춘다 #396\n\n'
                   'Co-Authored-By: Claude <noreply@anthropic.com>\nEOF\n)"')
        self.assertBlocked(self.hook(command), "Co-Authored-By")
        self.assertBlocked(self.hook('git commit -m "하네스를 맞춘다 #396" -m "co-authored-by: x <x@y>"'),
                           "Co-Authored-By")
        self.assertBlocked(self.hook('git commit -m "하네스를 맞춘다 #396" --trailer "Co-authored-by: x <x@y>"'),
                           "Co-Authored-By")

    def test_ds_store_blocked(self):
        open(os.path.join(self.repo, ".DS_Store"), "w").close()
        run("git", "add", "-f", ".DS_Store", cwd=self.repo)
        self.assertBlocked(self.hook('git commit -m "하네스를 맞춘다 #396"'), ".DS_Store")

    def test_unverified_code_blocked_until_verify_record_matches(self):
        sys.path.insert(0, os.path.join(self.repo, ".claude", "hooks"))
        import harness_state as hs
        config = os.path.join(self.repo, "src", "a.ts")
        with open(config, "a") as f:
            f.write("export const b = 2;\n")
        run("git", "add", "-A", "src", cwd=self.repo)
        self.assertBlocked(self.hook('git commit -m "설정을 바꾼다 #396"'), "검증하지 않은")
        hs.save(self.repo, {"passed": True, "fingerprint": hs.fingerprint(self.repo)})
        self.assertEqual(0, self.hook('git commit -m "설정을 바꾼다 #396"').returncode)
        with open(config, "a") as f:
            f.write("export const c = 3;\n")
        self.assertBlocked(self.hook('git commit -m "설정을 바꾼다 #396"'), "검증하지 않은")

    def test_other_repo_commit_uses_its_own_harness_state(self):
        other = os.path.join(self.tmp, "other")
        os.makedirs(os.path.join(other, "src"))
        os.makedirs(os.path.join(other, ".claude", "hooks"))
        with open(os.path.join(other, ".claude", "hooks", "harness_state.py"), "w") as f:
            f.write("def unverified(root):\n    return []\n")  # 그 저장소 규칙으로는 검증할 변경이 없다
        run("git", "init", "-q", "-b", "develop", cwd=other)
        run("git", "config", "user.name", "tester", cwd=other)
        run("git", "config", "user.email", "tester@example.com", cwd=other)
        run("git", "commit", "-q", "--allow-empty", "-m", "init", cwd=other)
        run("git", "checkout", "-q", "-b", "feature/other-change", cwd=other)
        with open(os.path.join(other, "src", "b.ts"), "w") as f:
            f.write("export const b = 2;\n")
        run("git", "add", "-A", "src", cwd=other)
        self.assertEqual(0, self.hook(f'git -C {other} commit -m "다른 저장소를 고친다 #396"').returncode)
        os.remove(os.path.join(other, ".claude", "hooks", "harness_state.py"))  # 없으면 이 저장소 규칙으로 막는다
        self.assertBlocked(self.hook(f'git -C {other} commit -m "다른 저장소를 고친다 #396"'), "검증하지 않은")

    def test_docs_only_change_needs_no_verify(self):
        for path in ("README.md", "src/README.md"):
            with open(os.path.join(self.repo, path), "w") as f:
                f.write("x")
        run("git", "add", "-A", cwd=self.repo)
        self.assertEqual(0, self.hook('git commit -m "문서를 고친다 #396"').returncode)

    def test_worktree_reads_gitdir_head(self):
        worktree = os.path.join(self.tmp, "wt")
        run("git", "worktree", "add", "-q", worktree, "develop", cwd=self.repo)
        shutil.copytree(os.path.join(self.repo, ".claude", "hooks"), os.path.join(worktree, ".claude", "hooks"),
                        dirs_exist_ok=True)
        self.assertTrue(os.path.isfile(os.path.join(worktree, ".git")))
        sys.path.insert(0, str(HOOKS))
        import check_git_rules
        head = check_git_rules.head_file(os.path.join(worktree, "src"))
        self.assertIn(os.path.join(".git", "worktrees"), head)
        self.assertEqual("develop", check_git_rules.current_branch(worktree))
        self.assertEqual("feature/agent-harness", check_git_rules.current_branch(self.repo))
        # 메인 checkout은 feature 브랜치지만 worktree는 develop이므로 막혀야 한다
        self.assertBlocked(self.hook('git commit -m "하네스를 맞춘다 #396"', cwd=worktree), "보호 브랜치")
        self.assertBlocked(self.hook(f'cd {worktree} && git commit -m "하네스를 맞춘다 #396"'), "보호 브랜치")

    def test_skipping_pre_commit_gate_blocked(self):
        no_verify = "--no-" + "verify"  # 이 테스트를 실행하는 명령이 훅에 걸리지 않게 나눠 쓴다
        for command in (f'git commit {no_verify} -m "하네스를 맞춘다 #361"',
                        'git commit -n -m "하네스를 맞춘다 #361"',
                        'git commit -an -m "하네스를 맞춘다 #361"',
                        f"bash -c 'git commit {no_verify} -m \"하네스를 맞춘다 #361\"'"):
            self.assertBlocked(self.hook(command), "검증 게이트")
        self.assertEqual(0, self.hook('git commit -m "옵션 -n; 설명 #361"').returncode)

    def test_hooks_path_change_blocked(self):
        for command in ("git config core.hooksPath /dev/null",
                        "git config --unset core.hooksPath",
                        'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m "x #1"',
                        'git -c core.hooksPath=/tmp commit -m "하네스를 맞춘다 #361"'):
            self.assertBlocked(self.hook(command), "core.hooksPath")
        for command in ("git config core.hooksPath .githooks", "git config --get core.hooksPath"):
            self.assertEqual(0, self.hook(command).returncode, command)

    def test_pre_commit_gate_compares_index_with_verify_record(self):
        sys.path.insert(0, os.path.join(self.repo, ".claude", "hooks"))
        import harness_state as hs
        shutil.copytree(REPO / ".githooks", os.path.join(self.repo, ".githooks"))
        hs.install_git_hooks(self.repo)
        self.assertEqual(".githooks", run("git", "config", "--get", "core.hooksPath", cwd=self.repo).stdout.strip())
        source = os.path.join(self.repo, "src", "a.ts")

        def commit():
            return run("git", "commit", "-q", "-m", "코드를 바꾼다 #361", cwd=self.repo, check=False)

        with open(source, "a") as f:
            f.write("export const b = 2;\n")
        run("git", "add", "-A", "src", cwd=self.repo)
        result = commit()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("[검증 게이트]", result.stderr)
        # 지문만 있는 옛 기록으로는 통과하지 않는다
        hs.save(self.repo, {"passed": True, "fingerprint": hs.fingerprint(self.repo)})
        self.assertNotEqual(0, commit().returncode)
        hs.save(self.repo, {"passed": True, "fingerprint": hs.fingerprint(self.repo), "code": hs.code_entries(self.repo)})
        # 검증 뒤 작업 트리만 바뀌고 index가 검증 내용과 같으면 커밋된다
        with open(source, "a") as f:
            f.write("export const c = 3;\n")
        result = commit()
        self.assertEqual(0, result.returncode, result.stderr)
        # 검증 뒤 고친 내용을 스테이징하면 막힌다
        run("git", "add", "-A", "src", cwd=self.repo)
        self.assertIn("src/a.ts", commit().stderr)
        # 삭제도 verify 때 지워져 있어야 통과한다
        run("git", "reset", "-q", "--", "src", cwd=self.repo)
        run("git", "checkout", "-q", "--", "src", cwd=self.repo)
        run("git", "rm", "-q", "src/a.ts", cwd=self.repo)
        self.assertIn("src/a.ts", commit().stderr)
        hs.save(self.repo, {"passed": True, "fingerprint": hs.fingerprint(self.repo), "code": hs.code_entries(self.repo)})
        self.assertEqual(hs.DELETED, hs.load(self.repo)["code"]["src/a.ts"])
        self.assertEqual(0, commit().returncode)
        # 문서만 담은 커밋은 게이트가 보지 않는다
        with open(os.path.join(self.repo, "README.md"), "w") as f:
            f.write("x")
        run("git", "add", "README.md", cwd=self.repo)
        self.assertEqual(0, commit().returncode)
        # 직접 커밋해도 .env · 키 파일은 막고, 실수로 올린 파일을 지우는 커밋은 통과한다
        with open(os.path.join(self.repo, ".env"), "w") as f:
            f.write("A=1\n")
        run("git", "add", "-f", ".env", cwd=self.repo)
        self.assertIn("[커밋 게이트]", commit().stderr)
        run("git", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "실수로 올린다 #361", cwd=self.repo)
        run("git", "rm", "-q", "--cached", ".env", cwd=self.repo)
        self.assertEqual(0, commit().returncode)

    def test_stop_guard_blocks_once(self):
        with open(os.path.join(self.repo, "src", "a.ts"), "a") as f:
            f.write("export const b = 2;\n")
        guard = os.path.join(self.repo, ".claude", "hooks", "stop_guard.py")
        result = subprocess.run(["python3", "-I", "-S", guard], input=json.dumps({"cwd": self.repo}),
                                capture_output=True, text=True)
        self.assertEqual("block", json.loads(result.stdout)["decision"])
        result = subprocess.run(["python3", "-I", "-S", guard],
                                input=json.dumps({"cwd": self.repo, "stop_hook_active": True}),
                                capture_output=True, text=True)
        self.assertEqual("", result.stdout)


class VerifyAndBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd()
        os.chdir(REPO)
        self.verify = load_script("verify", SCRIPTS / "verify")
        self.boundaries = load_script("check_boundaries", SCRIPTS / "check-boundaries")

    def tearDown(self):
        os.chdir(self.cwd)

    def test_jest_paths_follow_changed_modules(self):
        paths = self.verify.jest_paths
        self.assertEqual(["src/modules/flags"], paths(["src/modules/flags/service/flags.service.ts"]))
        self.assertEqual(["src/modules/admin/crawl"], paths(["src/modules/admin/crawl/service/a.ts"]))
        self.assertEqual(["src/common", "src/main"], paths(["src/common/x/a.ts", "src/main.ts"]))
        self.assertEqual([], paths(["test/flags.e2e-spec.ts", "scripts/a.cjs"]))
        self.assertIsNone(paths(["package.json"]))

    def test_steps_for_paths(self):
        names = lambda files, run_all=False, e2e=False: [n for n, _ in self.verify.steps_for(files, run_all, "BASE", e2e)]
        self.assertEqual([], names([]))
        self.assertEqual(["harness-syntax", "harness-tests", "security"], names([".claude/hooks/check_git_rules.py"]))
        self.assertEqual(["security", "boundaries", "lint", "typecheck", "build", "unit"], names(["src/main.ts"]))
        self.assertEqual(["security"], names([".github/workflows/backend-ci.yml"]))
        self.assertEqual(["security", "boundaries", "migrations", "build", "unit"],
                         names(["src/database/migrations/1792500999000-x.ts"]))  # 없는 파일은 lint 대상이 아니다
        self.assertIn("e2e", names([], e2e=True))
        steps = dict(self.verify.steps_for(["src/main.ts"], False, "BASE"))
        self.assertEqual(["npx", "eslint", "src/main.ts"], steps["lint"])
        self.assertEqual(["npx", "jest", "--runInBand", "--passWithNoTests", "src/main"], steps["unit"])
        self.assertEqual(["npx", "jest", "--runInBand"], dict(self.verify.steps_for([], True, "BASE"))["unit"])

    def test_docs_are_not_code(self):
        sys.path.insert(0, str(HOOKS))
        import harness_state as hs
        self.assertFalse(hs.is_code("docs/agent/harness.md"))
        self.assertFalse(hs.is_code(".spec/flags.md"))
        self.assertTrue(hs.is_code("src/main.ts"))
        self.assertTrue(hs.is_code("package.json"))
        self.assertTrue(hs.is_code(".claude/hooks/check_git_rules.py"))
        # 게이트 스크립트 · 워크플로를 고친 커밋도 검증을 거친다
        self.assertTrue(hs.is_code(".githooks/pre-commit"))
        self.assertTrue(hs.is_code(".github/workflows/backend-ci.yml"))

    def test_security_check_finds_secrets_and_injection(self):
        security = load_script("check_security", SCRIPTS / "check-security")
        tmp = tempfile.mkdtemp(prefix="security-test-")
        try:
            files = {
                ".github/workflows/a.yml": "jobs:\n  a:\n    steps:\n      - run: echo \"${{ github.event"
                                           + ".pull_request.title }}\"\n      - env:\n          T: ${{ github.event"
                                           + ".pull_request.title }}\n        run: echo \"$T\"\n",
                # 패턴을 나눠 써서 이 테스트 파일 자체가 비밀 값으로 잡히지 않게 한다
                "src/key.ts": "const key = '-----BEGIN " + "PRIVATE KEY-----';\n",
                "src/safe.ts": "const host = 'https://example.com';\n",
            }
            for path, text in files.items():
                os.makedirs(os.path.join(tmp, os.path.dirname(path)), exist_ok=True)
                with open(os.path.join(tmp, path), "w") as f:
                    f.write(text)
            joined = "\n".join(security.check_workflows(tmp, list(files)) + security.check_secrets(tmp, list(files)))
            self.assertIn("[워크플로 셸 주입] .github/workflows/a.yml:4", joined)
            self.assertNotIn("a.yml:6", joined)
            self.assertIn("[비밀 값: 개인 키] src/key.ts:1", joined)
            self.assertNotIn("safe.ts", joined)
            for value in ("github.head_ref", "github.event.pull_request.head.label"):
                self.assertTrue(security.WORKFLOW_INJECTION.search("${{ " + value + " }}"), value)
            for value in ("github.event.pull_request.number", "github.sha"):
                self.assertFalse(security.WORKFLOW_INJECTION.search("${{ " + value + " }}"), value)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_boundary_rules_catch_violations(self):
        import re
        rules = {name: re.compile(pattern, re.M) for name, _, _, pattern, _ in self.boundaries.rules(str(REPO))}
        imports = rules["Controller는 TypeORM을 import하지 않는다"]
        self.assertTrue(imports.search("import { DataSource } from 'typeorm';\n"))
        self.assertTrue(imports.search("import { InjectRepository } from '@nestjs/typeorm';\n"))
        self.assertFalse(imports.search("import { FlagsService } from '../service/flags.service';\n"))
        orm = rules["Controller는 ORM 조회를 직접 하지 않는다"]
        self.assertTrue(orm.search("await this.db.query('SELECT 1')"))
        self.assertFalse(orm.search("return this.service.find(id);"))
        self.assertTrue(self.boundaries.matches("src/modules/a/controller/a.controller.ts", "src/**/*.controller.ts"))


if __name__ == "__main__":
    unittest.main()
