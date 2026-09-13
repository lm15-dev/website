#!/usr/bin/env python3
"""Snapshot the two LM15 implementations without modifying either repository."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
inputs = ROOT / 'inputs'
inputs.mkdir(exist_ok=True)
metadata = {}
rust = PROJECT / 'lm15-rs'
revision = subprocess.check_output(['git', '-C', str(rust), 'rev-parse', 'HEAD'], text=True).strip()
if subprocess.check_output(['git', '-C', str(rust), 'status', '--porcelain'], text=True).strip():
    raise SystemExit('Rust source is dirty; record a deliberate source snapshot rather than claiming its HEAD')
archive = subprocess.check_output(['git', '-C', str(rust), 'archive', '--format=tar', revision])
compressed = gzip.compress(archive, mtime=0)
(inputs / 'rust.tar.gz').write_bytes(compressed)
metadata['rust'] = {'kind': 'git', 'commit': revision, 'archive_sha256': hashlib.sha256(compressed).hexdigest()}

go = PROJECT / 'lm15-go'
base = subprocess.check_output(['git', '-C', str(go), 'rev-parse', 'HEAD'], text=True).strip()
files = sorted(path for path in go.rglob('*') if path.is_file() and not path.is_symlink()
    and '.git' not in path.parts and (path.suffix == '.go' or path.name in ['go.mod', 'go.sum', 'LICENSE', 'CONTRACT_PIN']))
buffer = io.BytesIO()
manifest = {}
with tarfile.open(fileobj=buffer, mode='w') as tar:
    for path in files:
        name = str(path.relative_to(go))
        content = path.read_bytes()
        item = tarfile.TarInfo(name)
        item.size = len(content)
        item.mode = 0o644
        tar.addfile(item, io.BytesIO(content))
        manifest[name] = hashlib.sha256(content).hexdigest()
compressed = gzip.compress(buffer.getvalue(), mtime=0)
(inputs / 'go.tar.gz').write_bytes(compressed)
metadata['go'] = {'kind': 'working-tree', 'base_commit': base, 'archive_sha256': hashlib.sha256(compressed).hexdigest(), 'files': manifest}
(inputs / 'sources.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('Recorded Rust commit and exact, uncommitted Go source snapshot; neither SDK changed.')
