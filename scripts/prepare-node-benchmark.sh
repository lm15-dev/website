#!/usr/bin/env bash
# Run inside the isolated benchmark folder on the build server.
set -euo pipefail
revision="${1:?Pass the full lm15-ts commit SHA}"
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
mkdir -p input source
# Refuse to reuse a source tree that might contain unrelated work.
[[ ! -e source/lm15-ts ]] || { echo 'Use a fresh benchmark folder' >&2; exit 1; }
git clone --quiet --no-checkout https://github.com/lm15-dev/lm15-ts.git source/lm15-ts
git -C source/lm15-ts checkout --quiet --detach "$revision"
(
  cd source/lm15-ts
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build:typescript
  git diff --exit-code -- src
  npm pack --ignore-scripts --json --pack-destination "$root/input" > "$root/input/pack.json"
)
node --input-type=module <<'JS'
import { readFileSync, copyFileSync } from 'node:fs';
const [{ filename }] = JSON.parse(readFileSync('input/pack.json', 'utf8'));
copyFileSync(`input/${filename}`, 'input/lm15.tgz');
JS
python3 scripts/benchmark-node.py --lm15-package input/lm15.tgz --source-commit "$revision" --workers 20 --runs 40
