#!/usr/bin/env python3
"""Turn a completed benchmark run into homepage data and a readable evidence page."""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ORDER = ['litellm', 'google', 'openai', 'anthropic', 'lm15']


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/publish-python-benchmarks.py public/benchmarks/python/<run>/results.json')
    path = Path(sys.argv[1]).resolve()
    public_path = path.relative_to(ROOT / 'public')
    data = json.loads(path.read_text())
    if not data.get('finished_at'):
        raise ValueError('Refusing to publish an incomplete run')
    packages = data['packages']
    for key in ORDER:
        package = packages[key]
        if len(package['samples']) != data['samples_per_client']:
            raise ValueError(f'{key}: incomplete samples')
        for sample in package['samples']:
            if sample.get('cpu_affinity') != [data['worker_cpus'][sample['worker']]]:
                raise ValueError(f'{key}: sample did not run on its assigned single CPU')
            if not all(math.isfinite(sample[field]) and sample[field] >= 0 for field in ['import_ms', 'rss_mib']):
                raise ValueError(f'{key}: invalid sample')
    date = dt.datetime.fromisoformat(data['finished_at']).date().isoformat()
    python_version = data['python'].split()[0]
    environment = f"Python {python_version} · {data['os']} · {data['cpu']} · one CPU per process, {data['workers']} parallel workers"
    definitions = [
        ('size', 'Installed size', 'MiB', data['method']['size'], lambda p: p['installed_bytes'] / 2**20),
        ('dependencies', 'Dependencies', '', data['method']['dependencies'], lambda p: p['dependencies']),
        ('startup', 'Import time', 'ms', data['method']['startup'], lambda p: p['summary']['import_ms']['median']),
        ('memory', 'Memory after import', 'MiB', data['method']['memory'], lambda p: p['summary']['rss_mib']['median']),
    ]
    suite = {
        'status': 'measured', 'measuredAt': date, 'environment': environment,
        'sourceUrl': '/docs/benchmarks/python/',
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
    destination = ROOT / 'src/data/python-benchmarks.ts'
    destination.write_text(
        '// Measured data. Regenerate with scripts/publish-python-benchmarks.py.\n'
        "import type { BenchmarkSuite } from './benchmarks';\n\n"
        + 'export const PYTHON_BENCHMARKS = ' + json.dumps(suite, indent=2, ensure_ascii=False)
        + ' satisfies BenchmarkSuite;\n'
    )
    base_url = '/' + str(public_path.parent)
    n = data['samples_per_client']
    lines = [
        '---', 'title: Python benchmarks',
        'description: Measured installed size, dependency count, import time, and memory for LM15 and four Python alternatives.',
        '---', '',
        f'Measured **{date}**, using **Python {python_version}** on **{data["cpu"]}**.',
        f'OS: `{data["os"]}` ({data["architecture"]}), host `{data["host"]}`.', '',
        f"**One logical CPU per process**, enforced and recorded in every sample. {data['workers']} workers use separate physical cores to collect samples in parallel. No individual measurement uses multiple CPUs.", '',
        'These measurements describe **installation and import costs**, not model speed, request latency, feature coverage, or the cost of constructing a client.', '',
        '## Results', '',
        f'Time and memory are medians of **{n} fresh processes per library**. Lower is better for these four measurements.', '',
        '| Library | Version | Installed MiB | Dependencies | Import ms | Memory MiB |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
    ]
    for key in ORDER:
        p = packages[key]
        lines.append(f"| {p['label']} | `{p['version']}` | {p['installed_bytes']/2**20:.2f} | {p['dependencies']} | {p['summary']['import_ms']['median']:.2f} | {p['summary']['rss_mib']['median']:.2f} |")
    baseline = packages['baseline']['summary']
    lines += [
        '', f"The empty interpreter's median resident memory was **{baseline['rss_mib']['median']:.2f} MiB**. It is **included**, not subtracted, in the memory results above.",
        '', '## What was measured', '',
        '**Installed size:** ' + data['method']['size'], '',
        '**Dependencies:** ' + data['method']['dependencies'], '',
        '**Import time:** ' + data['method']['startup'], '',
        '**Memory after import:** ' + data['method']['memory'], '',
        'MiB means 1,048,576 bytes. Installed size is logical file size, not allocated disk blocks. An SDK with compiled dependencies and a pure-Python SDK still use the same counting rule.', '',
        'Each library was installed into its own fresh, unseeded `uv` environment with no optional extras. Competitors came from their current stable PyPI releases; their full resolved dependency versions are saved below. Only binary wheel installs were allowed.', '',
        f"LM15 was installed from `{data['lm15']['wheel']}`, the wheel bundled with the website's pinned runtime package, built from [commit `{data['lm15']['source_commit'][:12]}`](https://github.com/lm15-dev/lm15-python/tree/{data['lm15']['source_commit']}). Its entire installed package is counted—not just its transports or source files.", '',
        '### Imports', '', '| Library | Statement |', '| --- | --- |',
    ]
    for key in ORDER:
        p = packages[key]
        lines.append(f"| {p['label']} | `{p['import_statement']}` |")
    lines += [
        '', '### Repetition and isolation', '',
        data['method']['order'], '', data['method']['network'], '',
        'These are fresh Python processes with **warm filesystem and bytecode caches**, not first-install or cold-disk measurements. CPU frequency was not fixed. Workers share memory bandwidth, caches, and the server power budget, so their timings can differ from a completely idle server. The results describe concurrent single-core runs, not multicore acceleration.', '',
        'The packages do not offer identical features. LiteLLM includes routing and integrations beyond a single provider client. Small size or fast imports do not prove equivalent coverage or correctness.', '',
        '## Spread between runs', '',
        'The chart whiskers and the intervals below cover the middle 50% of samples (25th to 75th percentile). They show observed variation, not a 95% confidence interval. Every individual sample and its CPU assignment is in the raw results. Installed size and dependency count are fixed properties of each installation, so they have no whiskers.', '',
        '| Library | Import ms, middle 50% | Memory MiB, middle 50% |',
        '| --- | ---: | ---: |',
    ]
    for key in ORDER:
        p = packages[key]
        t, m = p['summary']['import_ms'], p['summary']['rss_mib']
        lines.append(f"| {p['label']} | {t['p25']:.2f}–{t['p75']:.2f} | {m['p25']:.2f}–{m['p75']:.2f} |")
    lines += [
        '', '## Evidence and reproduction', '',
        f'- [Raw results and all samples]({base_url}/results.json)',
        f'- [Exact benchmark runner used for this run]({base_url}/runner.py)',
    ]
    for key in ORDER:
        lines.append(f"- [{packages[key]['label']} dependency versions]({base_url}/locks/{key}.txt)")
    lock_path = str(public_path.parent / 'locks')
    lines += [
        '', 'From the website repository, after `npm ci` has installed the pinned LM15 runtime package:', '',
        '```sh', f"python3 scripts/benchmark-python.py --python {python_version} --workers {data['workers']} --runs {n} \\",
        f'  --lock-dir public/{lock_path}', '```', '',
        f"Run this on the build server, not the laptop. It requires Linux, `uv`, `taskset`, {data['workers']} available physical cores, the specified Python interpreter, and permission to create user/network namespaces with `unshare`. The script refuses to assign two workers to sibling threads of one core. Installation needs internet access; measured imports have no external network.", '',
        f"Installer: `{data['uv']}`.", '',
        f"Runner SHA-256: `{data['runner_sha256']}`.", '',
        f"LM15 wheel SHA-256: `{data['lm15']['wheel_sha256']}`.", '',
    ]
    report = ROOT / 'src/content/docs/docs/benchmarks/python.md'
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text('\n'.join(lines))
    print(f'Wrote {destination.relative_to(ROOT)} and {report.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
