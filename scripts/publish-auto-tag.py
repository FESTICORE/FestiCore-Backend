"""Publish an existing local annotated tag without Git receive-pack transport."""
import json
import os
import re
import subprocess
import tempfile
import time
from urllib.parse import quote


class ApiError(RuntimeError):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


def api(repo, path, body=None, pages=False):
    with tempfile.TemporaryDirectory() as directory:
        command = ['gh', 'api', f'repos/{repo}/{path}', '-H',
                   'X-GitHub-Api-Version: 2026-03-10']
        if pages:
            command += ['--paginate', '--slurp']
        if body is not None:
            filename = os.path.join(directory, 'body.json')
            with open(filename, 'w', encoding='utf-8') as output:
                json.dump(body, output, ensure_ascii=False)
            command += ['--method', 'POST', '--input', filename]
        for attempt in range(3):
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode == 0:
                return json.loads(result.stdout)
            match = re.search(r'HTTP (\d{3})', result.stderr)
            status = int(match[1]) if match else None
            if attempt == 2 or (status is not None and status != 429 and status < 500):
                raise ApiError(result.stderr.strip(), status)
            time.sleep(attempt + 1)


def target(repo, tag):
    try:
        obj = api(repo, 'git/ref/tags/' + quote(tag, safe=''))['object']
    except ApiError as error:
        if error.status == 404:
            return None
        raise
    for _ in range(10):
        if obj['type'] == 'commit':
            return obj['sha']
        if obj['type'] != 'tag':
            break
        obj = api(repo, 'git/tags/' + obj['sha'])['object']
    raise RuntimeError(f'{tag}: tag does not resolve to a commit')


def publish(repo, tag, prefix, sha):
    if not re.fullmatch(re.escape(prefix) + r'\d+\.\d+\.\d+', tag):
        raise ValueError('Invalid release tag')
    # A rerun may calculate the next version after its earlier tag succeeded.
    for page in api(repo, 'tags?per_page=100', pages=True):
        for existing in page:
            name = existing['name']
            if (re.fullmatch(re.escape(prefix) + r'\d+\.\d+\.\d+', name)
                    and existing['commit']['sha'] == sha and target(repo, name) == sha):
                print(f'Already tagged: {name} -> {sha}')
                return
    current = target(repo, tag)
    if current is not None:
        if current != sha:
            raise RuntimeError(f'{tag}: collision with another commit')
        return
    local = subprocess.check_output(['git', 'rev-parse', f'{tag}^{{commit}}'], text=True).strip()
    if local != sha:
        raise RuntimeError('Local tag does not match the workflow commit')
    # Read the original git tag -a paragraphs verbatim, including Korean text.
    raw = subprocess.check_output(['git', 'cat-file', 'tag', tag], text=True)
    message = raw.split('\n\n', 1)[1]
    annotated = api(repo, 'git/tags', {
        'tag': tag, 'message': message, 'object': sha, 'type': 'commit',
    })
    try:
        api(repo, 'git/refs', {'ref': f'refs/tags/{tag}', 'sha': annotated['sha']})
    except ApiError:
        # POST may have committed before a transport error, or a concurrent
        # creator may own the ref. Never update/force an existing reference.
        if target(repo, tag) != sha:
            raise
    if target(repo, tag) != sha:
        raise RuntimeError(f'{tag}: remote target verification failed')
    print(f'Published: {tag} -> {sha}')


if __name__ == '__main__':
    publish(os.environ['GITHUB_REPOSITORY'], os.environ['TAG'],
            os.environ['TAG_PREFIX'], os.environ['GITHUB_SHA'])
