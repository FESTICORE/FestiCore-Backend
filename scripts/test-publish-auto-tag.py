import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-auto-tag.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        previous = os.getcwd()
        os.chdir(self.tmp.name)
        self.addCleanup(os.chdir, previous)
        def git(*args):
            return subprocess.check_output(['git', *args], text=True).strip()
        git('init', '-q')
        git('config', 'user.name', 'Test')
        git('config', 'user.email', 'test@example.com')
        git('commit', '--allow-empty', '-qm', '한국어 제목\n\n본문')
        self.sha = git('rev-parse', 'HEAD')
        git('tag', '-a', 'dev-v0.0.2', '-m', 'dev-v0.0.2', '-m', '한국어\n여러 줄')
        self.calls = []
        self.refs = {}
        self.tags = {}
        self.listed = []
        self.failures = []
        self.after_ref_error = False
        self.racing_commit = None
        real_run = subprocess.run
        def gh(command, **kwargs):
            if command[0] == 'git':
                return real_run(command, **kwargs)
            self.assertEqual(command[:2], ['gh', 'api'])
            path = command[2].removeprefix('repos/owner/repo/')
            body = json.loads(Path(command[command.index('--input') + 1]).read_text()) if '--input' in command else None
            self.calls.append((path, body))
            if self.failures:
                code = self.failures.pop(0)
                return subprocess.CompletedProcess(command, 1, '', f'gh: failure (HTTP {code})')
            status, value = 0, {}
            if path.startswith('tags?'):
                value = [self.listed]
            elif path.startswith('git/ref/tags/'):
                name = path.removeprefix('git/ref/tags/')
                if name not in self.refs:
                    return subprocess.CompletedProcess(command, 1, '', 'gh: Not Found (HTTP 404)')
                value = {'object': self.refs[name]}
            elif path == 'git/tags':
                self.tags['annotation'] = {'object': {'type': 'commit', 'sha': body['object']}}
                value = {'sha': 'annotation'}
            elif path.startswith('git/tags/'):
                value = self.tags[path.removeprefix('git/tags/')]
            elif path == 'git/refs':
                self.refs[body['ref'].removeprefix('refs/tags/')] = {'type': 'tag', 'sha': body['sha']}
                if self.racing_commit:
                    self.refs[body['ref'].removeprefix('refs/tags/')] = {'type': 'commit', 'sha': self.racing_commit}
                    return subprocess.CompletedProcess(command, 1, '', 'gh: already exists (HTTP 422)')
                if self.after_ref_error:
                    return subprocess.CompletedProcess(command, 1, '', 'gh: already exists (HTTP 422)')
            else:
                self.fail(path)
            return subprocess.CompletedProcess(command, status, json.dumps(value), '')
        self.gh = patch.object(module.subprocess, 'run', side_effect=gh)
        self.gh.start()
        self.addCleanup(self.gh.stop)
        self.sleep = patch.object(module.time, 'sleep').start()
        self.addCleanup(patch.stopall)

    def publish(self):
        module.publish('owner/repo', 'dev-v0.0.2', 'dev-v', self.sha)

    def test_creates_annotation_and_verifies_ref_preserving_message(self):
        self.publish()
        body = next(body for path, body in self.calls if path == 'git/tags')
        self.assertEqual(body['message'], 'dev-v0.0.2\n\n한국어\n여러 줄\n')
        self.assertEqual(module.target('owner/repo', 'dev-v0.0.2'), self.sha)

    def test_rerun_uses_previous_version_for_same_commit(self):
        self.listed = [{'name': 'dev-v0.0.1', 'commit': {'sha': self.sha}}]
        self.refs['dev-v0.0.1'] = {'type': 'commit', 'sha': self.sha}
        self.publish()
        self.assertFalse(any(body for _, body in self.calls))

    def test_same_target_collision_is_already_complete(self):
        self.refs['dev-v0.0.2'] = {'type': 'commit', 'sha': self.sha}
        self.publish()
        self.assertFalse(any(body for _, body in self.calls))

    def test_non_commit_reference_is_rejected(self):
        self.refs['dev-v0.0.2'] = {'type': 'tree', 'sha': 'tree'}
        with self.assertRaisesRegex(RuntimeError, 'does not resolve'):
            self.publish()
        self.assertFalse(any(body for _, body in self.calls))

    def test_collision_with_other_commit_fails_without_writes(self):
        self.refs['dev-v0.0.2'] = {'type': 'commit', 'sha': 'other'}
        with self.assertRaisesRegex(RuntimeError, 'collision'):
            self.publish()
        self.assertFalse(any(body for _, body in self.calls))

    def test_ref_success_followed_by_error_is_verified(self):
        self.after_ref_error = True
        self.publish()

    def test_racing_different_target_ref_is_not_overwritten(self):
        self.racing_commit = 'different-commit'
        with self.assertRaises(module.ApiError):
            self.publish()
        self.assertEqual(self.refs['dev-v0.0.2']['sha'], 'different-commit')
        self.assertEqual(sum(path == 'git/refs' for path, _ in self.calls), 1)

    def test_transient_errors_retry_at_most_three_times(self):
        self.failures = [500, 502]
        self.publish()
        self.assertEqual(self.sleep.call_count, 2)
        self.calls.clear()
        self.failures = [503, 503, 503]
        with self.assertRaises(module.ApiError):
            self.publish()
        self.assertEqual(len(self.calls), 3)

    def test_permission_failure_is_not_retried(self):
        self.failures = [403]
        with self.assertRaises(module.ApiError):
            self.publish()
        self.assertEqual(len(self.calls), 1)


if __name__ == '__main__':
    unittest.main()
