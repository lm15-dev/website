#!/usr/bin/env python3
"""Publish a completed server Node.js benchmark run to the TypeScript charts."""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ORDER = ['vercel', 'google', 'openai', 'anthropic', 'lm15']


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/publish-node-benchmarks.py public/benchmarks/node/<run>/results.json')
    path = Path(sys.argv[1]).resolve()
    public_path = path.relative_to(ROOT / 'public')
    data = json.loads(path.read_text())
    if data.get('language') != 'node' or not data.get('finished_at'):
        raise ValueError('Expected a completed Node.js run')
    packages = data['packages']
    for key in ORDER:
        record = packages[key]
        if len(record['samples']) != data['samples_per_client']:
            raise ValueError(f'{key}: missing samples')
        for sample in record['samples']:
            if sample['cpu_affinity'] != [data['worker_cpus'][sample['worker']]] or sample['node'] != data['node']['version']:
                raise ValueError(f'{key}: inconsistent runtime or CPU assignment')
            if not all(math.isfinite(sample[metric]) and sample[metric] >= 0 for metric in ['import_ms', 'rss_mib']):
                raise ValueError(f'{key}: invalid measurement')
    date = dt.datetime.fromisoformat(data['finished_at']).date().isoformat()
    definitions = [
        ('size', 'Installed size', 'MiB', data['method']['size'], lambda p: p['installed_bytes'] / 2**20),
        ('dependencies', 'Dependencies', '', data['method']['dependencies'], lambda p: p['dependencies']),
        ('startup', 'Import time', 'ms', data['method']['startup'], lambda p: p['summary']['import_ms']['median']),
        ('memory', 'Memory after import', 'MiB', data['method']['memory'], lambda p: p['summary']['rss_mib']['median']),
    ]
    suite = {
        'status': 'measured', 'measuredAt': date,
        'environment': f"Node.js {data['node']['version']} · {data['os']} · {data['cpu']} · one CPU per process, {data['workers']} workers",
        'sourceUrl': '/docs/benchmarks/node/',
        'metrics': [{
            'id': key, 'label': label, 'unit': unit, 'description': description,
            'values': [{
                'id': client, 'label': packages[client]['label'], 'value': measure(packages[client]),
                **({'spread': {
                    'low': packages[client]['summary']['import_ms' if key == 'startup' else 'rss_mib']['p25'],
                    'high': packages[client]['summary']['import_ms' if key == 'startup' else 'rss_mib']['p75'],
                }} if key in ('startup', 'memory') else {}),
            } for client in ORDER],
        } for key, label, unit, description, measure in definitions],
    }
    target = ROOT / 'src/data/node-benchmarks.ts'
    target.write_text(
        '// Measured data. Regenerate with scripts/publish-node-benchmarks.py.\n'
        "import type { BenchmarkSuite } from './benchmarks';\n\n"
        + 'export const NODE_BENCHMARKS = ' + json.dumps(suite, indent=2, ensure_ascii=False)
        + ' satisfies BenchmarkSuite;\n'
    )
    base_url = '/' + str(public_path.parent)
    n = data['samples_per_client']
    lines = [
        '---', 'title: Node.js benchmarks',
        'description: Measured installation and import costs for LM15, Vercel AI SDK, OpenAI, Anthropic, and Google GenAI on Node.js.',
        '---', '',
        f"Measured **{date}**, using **Node.js {data['node']['version']}**, on **{data['cpu']}**.",
        f"OS: `{data['os']}` ({data['architecture']}), host `{data['host']}`.", '',
        'These results supply the homepage’s **TypeScript** charts. Libraries are loaded as JavaScript through their public **Node ESM entries**. This is not a browser bundle, tree-shaking, TypeScript compilation, request, or model-latency benchmark.', '',
        f"**{data['workers']} parallel workers, one logical CPU per process, {n} fresh-process samples per library.** Every worker has its own physical core. CPU affinity and the Node version are verified in every sample.", '',
        '## Results', '',
        'Time and memory are medians. Installed size and dependencies are fixed properties of each production install.', '',
        '| Library | npm package | Version | Installed MiB | Dependencies | Import ms | Memory MiB |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    ]
    for key in ORDER:
        p = packages[key]
        lines.append(f"| {p['label']} | `{p['package']}` | `{p['version']}` | {p['installed_bytes']/2**20:.2f} | {p['dependencies']} | {p['summary']['import_ms']['median']:.2f} | {p['summary']['rss_mib']['median']:.2f} |")
    baseline = packages['baseline']['summary']['rss_mib']['median']
    lines += [
        '', f"The empty Node process used **{baseline:.2f} MiB** resident memory. This baseline is **included**, not subtracted, in the table.", '',
        '## Vercel setup', '',
        'The Vercel row includes **`ai` plus its OpenAI, Anthropic, and Google adapters**. Installed size and dependency count cover the whole setup. The timed block imports the core and all three adapters sequentially in the same process. Measuring only `ai` would omit the packages that connect it to these providers.', '',
        'Adapter versions: ' + ', '.join(f"`{item['name']}@{item['version']}`" for item in packages['vercel']['additional_roots']) + '.', '',
        'This is a three-provider setup, not the smallest possible Vercel installation. Applications using only one adapter or a bundler can have a smaller footprint. Vercel’s additional framework features are not exercised by this import-only benchmark.', '',
        '## Method', '',
        '**Installed size:** ' + data['method']['size'], '',
        '**Dependencies:** ' + data['method']['dependencies'], '',
        '**Import time:** ' + data['method']['startup'], '',
        '**Memory after import:** ' + data['method']['memory'], '',
        'MiB means 1,048,576 bytes. The time measurement begins immediately before `await import(...)` and ends when it resolves. `process.memoryUsage.rss()` is sampled immediately afterward, before importing the file-reading helper used to verify CPU affinity.', '',
        'Every library gets a separate fresh npm project. The official clients were resolved from the current npm releases, then their exact versions and integrity hashes were saved in lockfiles. Production dependencies, including installed peer/optional dependencies, are included. Development dependencies are not.', '',
        'Package lifecycle scripts were disabled equally for all installs. Import probes succeeded under that policy. Any install hooks declared by dependencies are recorded in the raw inventory; this is an import benchmark, not a claim that every optional integration works without its install hook.', '',
        f"LM15 is its **normal npm package**, built on the server from [commit `{data['lm15']['source_commit'][:12]}`](https://github.com/lm15-dev/lm15-ts/tree/{data['lm15']['source_commit']}) with `npm run build:typescript` and packaged using `npm pack`. Its declarations, source maps, CommonJS and ESM builds, and documentation are counted. The website's extra Python, Rust, and browser-runtime files are **not** included.", '',
        '### Entry points', '', '| Library | Import |', '| --- | --- |',
    ]
    for key in ORDER:
        p = packages[key]
        statement = p['import_statement'].replace('\n', ' ')
        lines.append(f"| {p['label']} | `{statement}` |")
    lines += [
        '', '### Sampling and isolation', '', data['method']['order'], '', data['method']['network'], '',
        'Operating-system file caches are warm, but each sample has a new JavaScript module cache and a new V8 process. Persistent Node compile caching is disabled. The server clock speed is not fixed. Shared memory/cache/power contention remains possible, so these numbers describe concurrent **single-core** runs, not multicore acceleration.', '',
        'The SDKs have different feature coverage and loading strategies. A small import does not guarantee that later client construction or the first request is cheaper. These Node results should not be directly compared with Python timings as if the runtimes and work were identical.', '',
        '## Variation', '',
        'The interval covers the middle 50% of samples (25th–75th percentile), not a confidence interval. All samples remain available even though the homepage omits error bars.', '',
        '| Library | Import ms, middle 50% | Memory MiB, middle 50% |', '| --- | ---: | ---: |',
    ]
    for key in ORDER:
        p = packages[key]
        t, m = p['summary']['import_ms'], p['summary']['rss_mib']
        lines.append(f"| {p['label']} | {t['p25']:.2f}–{t['p75']:.2f} | {m['p25']:.2f}–{m['p75']:.2f} |")
    lines += [
        '', '## Evidence and reproduction', '',
        f'- [All raw samples and package inventories]({base_url}/results.json)',
        f'- [Exact Node benchmark runner]({base_url}/benchmark-node.py)',
        f'- [Shared sampling helpers used by that runner]({base_url}/benchmark-python.py)',
        f'- [Exact LM15 npm archive]({base_url}/lm15.tgz)',
    ]
    for key in ORDER:
        lines.append(f"- {packages[key]['label']}: [project]({base_url}/locks/{key}/package.json) · [lockfile]({base_url}/locks/{key}/package-lock.json)")
    lines += [
        '', 'Replay on the build server from the website repository, with the same Node version installed:', '',
        '```sh',
        f'python3 scripts/benchmark-node.py --lm15-package public/{public_path.parent}/lm15.tgz \\',
        f"  --source-commit {data['lm15']['source_commit']} --workers {data['workers']} --runs {n} \\",
        f'  --lock-dir public/{public_path.parent}/locks', '```', '',
        'Requires Linux, Node, npm, Python for orchestration, `taskset`, and permission to create user/network namespaces. Installation needs internet access; measured imports have no external network. No provider keys or paid calls are used.', '',
        f"npm: `{data['npm']}`. Node: `{data['node']['version']}`. V8: `{data['node']['versions']['v8']}`.", '',
        f"LM15 archive SHA-256: `{data['lm15']['archive_sha256']}`.", '',
        f"Runner SHA-256: `{data['runner_sha256']}`. Shared helper SHA-256: `{data['helper_sha256']}`.", '',
    ]
    report = ROOT / 'src/content/docs/docs/benchmarks/node.md'
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text('\n'.join(lines))
    print(f'Wrote {target.relative_to(ROOT)} and {report.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
