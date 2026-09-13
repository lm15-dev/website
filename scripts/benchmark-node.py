#!/usr/bin/env python3
"""Node.js SDK benchmarks. Run on 192.168.2.24, never on the laptop.

python3 scripts/benchmark-node.py --lm15-package input/lm15.tgz \
    --source-commit <full SHA> --workers 20 --runs 40
Use --lock-dir public/benchmarks/node/<run>/locks to replay exact npm resolutions.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import random
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HELPER = Path(__file__).with_name('benchmark-python.py')
spec = importlib.util.spec_from_file_location('benchmark_common', HELPER)
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
CLIENTS = [
    ('vercel', 'Vercel AI SDK', 'ai'),
    ('google', 'Google GenAI', '@google/genai'),
    ('openai', 'OpenAI', 'openai'),
    ('anthropic', 'Anthropic', '@anthropic-ai/sdk'),
    ('lm15', 'LM15', 'lm15'),
]
# Vercel's core delegates provider access to separately installed adapters.
EXTRA_PACKAGES = {'vercel': ['@ai-sdk/openai', '@ai-sdk/anthropic', '@ai-sdk/google']}

PROBE = r"""
const cpuStart = process.cpuUsage();
const start = process.hrtime.bigint();
__IMPORT__
const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
const cpu = process.cpuUsage(cpuStart);
const rss = process.memoryUsage.rss() / 2 ** 20;
const { readFileSync } = await import('node:fs');
const affinity = readFileSync('/proc/self/status', 'utf8').match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];
console.log('LM15_BENCHMARK=' + JSON.stringify({
  import_ms: elapsed,
  import_cpu_ms: (cpu.user + cpu.system) / 1000,
  rss_mib: rss,
  cpu_affinity: affinity,
  node: process.version,
}));
"""


def execute(command: list[str], env: dict[str, str], *, cwd: Path = ROOT, timeout: int = 600) -> str:
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed:\n{result.stderr[-5000:]}\n{result.stdout[-2000:]}')
    return result.stdout


def package_inventory(node_modules: Path) -> list[dict]:
    """Count actual installed package instances, not fixture package.json files."""
    records = []
    def walk(directory: Path) -> None:
        if not directory.is_dir():
            return
        for entry in sorted(directory.iterdir()):
            if entry.name.startswith('.') or not entry.is_dir() or entry.is_symlink():
                continue
            candidates = sorted(entry.iterdir()) if entry.name.startswith('@') else [entry]
            for package in candidates:
                manifest = package / 'package.json'
                if not manifest.is_file():
                    continue
                metadata = json.loads(manifest.read_text())
                records.append({
                    'path': str(package.relative_to(node_modules)),
                    'name': metadata['name'], 'version': metadata['version'],
                    'install_scripts': {key: value for key, value in metadata.get('scripts', {}).items() if key in ('preinstall', 'install', 'postinstall')},
                })
                walk(package / 'node_modules')
    walk(node_modules)
    return records


def measure(node: str, probe: Path, env: dict[str, str], cpu: int, version: str) -> dict:
    output = execute(['taskset', '--cpu-list', str(cpu), 'unshare', '--user', '--map-root-user', '--net', node, str(probe)], env, timeout=120)
    lines = [line.removeprefix('LM15_BENCHMARK=') for line in output.splitlines() if line.startswith('LM15_BENCHMARK=')]
    if len(lines) != 1:
        raise RuntimeError('Probe did not emit exactly one result')
    sample = json.loads(lines[0])
    if sample['cpu_affinity'] != str(cpu) or sample['node'] != version:
        raise RuntimeError('Probe escaped its assigned CPU or used a different Node version')
    sample['cpu_affinity'] = [cpu]
    return sample


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lm15-package', type=Path, required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--workers', type=int, default=20)
    parser.add_argument('--runs', type=int, default=40)
    parser.add_argument('--lock-dir', type=Path)
    args = parser.parse_args()
    if args.runs < 5 or args.workers < 1 or args.runs % args.workers:
        parser.error('Runs must be at least five and a multiple of the positive worker count')
    if len(args.source_commit) != 40 or any(char not in '0123456789abcdef' for char in args.source_commit):
        parser.error('Source commit must be a full lowercase Git SHA')
    archive = args.lm15_package.resolve()
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    scratch = Path(tempfile.gettempdir()) / 'lm15-node-benchmarks' / stamp
    output = scratch / 'results'
    home = scratch / 'home'
    home.mkdir(parents=True)
    (output / 'locks').mkdir(parents=True)
    runner_source, helper_source = Path(__file__).read_bytes(), HELPER.read_bytes()
    (output / 'benchmark-node.py').write_bytes(runner_source)
    (output / 'benchmark-python.py').write_bytes(helper_source)
    shutil.copyfile(archive, output / 'lm15.tgz')
    env = common.environment(home)
    env.update({'NODE_DISABLE_COMPILE_CACHE': '1', 'UV_THREADPOOL_SIZE': '1', 'NPM_CONFIG_UPDATE_NOTIFIER': 'false'})
    available = common.physical_cpus(env)
    if args.workers > len(available):
        parser.error(f'{args.workers} workers requested, but only {len(available)} physical cores are available')
    cpus = available[-args.workers:]
    print(f'{args.workers} workers, one logical CPU each, distinct physical cores: {cpus}', flush=True)
    execute(['unshare', '--user', '--map-root-user', '--net', 'true'], env)
    node = shutil.which('node', path=env['PATH'])
    if not node:
        raise RuntimeError('Node is not available')
    runtime = json.loads(execute([node, '-p', 'JSON.stringify({version:process.version,versions:process.versions,arch:process.arch})'], env))
    cpu = next((line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')), platform.machine())
    result = {
        'schema_version': 1, 'language': 'node', 'started_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'host': platform.node(), 'os': f'{platform.system()} {platform.release()}',
        'architecture': platform.machine(), 'cpu': cpu, 'logical_cpus': os.cpu_count(),
        'node': runtime, 'npm': execute(['npm', '--version'], env).strip(),
        'workers': args.workers, 'worker_cpus': cpus, 'samples_per_client': args.runs,
        'warmups_per_client': 2, 'load_at_start': os.getloadavg(),
        'runner_sha256': hashlib.sha256(runner_source).hexdigest(),
        'helper_sha256': hashlib.sha256(helper_source).hexdigest(),
        'lm15': {'source_commit': args.source_commit, 'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest()},
        'method': {
            'size': 'Logical bytes of regular files in the production node_modules tree, including the entire SDK, type declarations, source maps, bundled data, npm metadata, and installed transitive dependencies. Excludes symlinks, the shared Node executable, the project lockfile, and the input tarball. No bundling or tree-shaking.',
            'dependencies': 'Installed npm package instances minus the root SDK. Includes transitive, peer, and optional packages actually installed on this platform; nested duplicate installations count separately. Vercel includes its three explicitly selected provider adapters in this count. Development dependencies are omitted.',
            'startup': 'Median process.hrtime.bigint time around the listed public ESM imports in a fresh Node process. Vercel imports ai and its OpenAI, Anthropic, and Google adapters sequentially inside the same timed block. Two unmeasured warmups populate OS file caches. Excludes process launch, shutdown, client construction, and provider calls. Persistent Node compile caching is explicitly disabled.',
            'memory': 'Median process.memoryUsage.rss() immediately after the same import, including Node and V8. Empty-process baseline is reported separately, not subtracted.',
            'network': 'Imports run in fresh Linux user/network namespaces without external network; temporary HOME and allowlisted environment have no inherited API keys or tokens. Installs use npm registry access, with lifecycle scripts disabled for every package.',
            'order': f'{args.workers} workers on distinct physical cores. Every fresh process is restricted to one logical CPU with taskset; affinity and Node version are verified in the probe. Each worker measures every package {args.runs // args.workers} times in shuffled order (seed 20260913 + worker index). UV_THREADPOOL_SIZE=1 and common numeric libraries are limited to one thread. Shared caches, memory bandwidth, and power budgets can still affect concurrent workers. No best-run selection or frequency changes.',
        },
        'packages': {},
    }
    probes = {}
    for key, label, package in [('baseline', 'Empty Node', ''), *CLIENTS]:
        project = scratch / key
        project.mkdir()
        print(f'Preparing {label}…', flush=True)
        if key == 'lm15':
            shutil.copyfile(archive, project / 'lm15.tgz')
        if args.lock_dir and package:
            for name in ['package.json', 'package-lock.json']:
                shutil.copyfile(args.lock_dir.resolve() / key / name, project / name)
            command = ['npm', 'ci']
        else:
            (project / 'package.json').write_text(json.dumps({'name': f'bench-{key}', 'version': '0.0.0', 'private': True, 'type': 'module'}))
            command = ['npm', 'install', '--save-exact', 'file:lm15.tgz' if key == 'lm15' else package, *EXTRA_PACKAGES.get(key, [])]
        if package:
            execute(command + ['--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], env, cwd=project)
        tree = project / 'node_modules'
        packages = package_inventory(tree)
        root_package = next((item for item in packages if item['path'] == package), None)
        if package and not root_package:
            raise RuntimeError(f'Missing installed SDK: {package}')
        files = [path for path in tree.rglob('*') if path.is_file() and not path.is_symlink()] if tree.exists() else []
        imports = [package, *EXTRA_PACKAGES.get(key, [])] if package else []
        statement = '\n'.join(f'await import({json.dumps(name)});' for name in imports) if imports else 'void 0;'
        probe = project / 'probe.mjs'
        probe.write_text(PROBE.replace('__IMPORT__', statement))
        probes[key] = probe
        record = {
            'label': label, 'package': package, 'version': root_package['version'] if root_package else None,
            'additional_roots': [item for item in packages if item['path'] in EXTRA_PACKAGES.get(key, [])],
            'import_statement': statement, 'installed_bytes': sum(path.stat().st_size for path in files),
            'dependencies': len(packages) - (1 if package else 0), 'distributions': packages, 'samples': [],
        }
        result['packages'][key] = record
        if package:
            locked = output / 'locks' / key
            locked.mkdir()
            for name in ['package.json', 'package-lock.json']:
                shutil.copyfile(project / name, locked / name)
        print(f"  {record['version'] or 'baseline'} · {record['installed_bytes']/2**20:.2f} MiB · {record['dependencies']} dependencies", flush=True)
    for key, probe in probes.items():
        for _ in range(2):
            measure(node, probe, env, cpus[0], runtime['version'])

    def collect_worker(index: int, cpu: int) -> list[tuple[str, dict]]:
        rng = random.Random(20260913 + index)
        samples = []
        for iteration in range(args.runs // args.workers):
            keys = list(probes)
            rng.shuffle(keys)
            for key in keys:
                sample = measure(node, probes[key], env, cpu, runtime['version'])
                sample.update({'worker': index, 'round': iteration + 1})
                samples.append((key, sample))
        return samples

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(collect_worker, index, cpu) for index, cpu in enumerate(cpus)]
        for finished, future in enumerate(as_completed(futures), 1):
            for key, sample in future.result():
                result['packages'][key]['samples'].append(sample)
            print(f'Worker {finished}/{args.workers} finished', flush=True)
            (output / 'results.partial.json').write_text(json.dumps(result, indent=2) + '\n')
    for package in result['packages'].values():
        package['summary'] = {metric: common.summary([sample[metric] for sample in package['samples']]) for metric in ['import_ms', 'import_cpu_ms', 'rss_mib']}
    result.update({'finished_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'load_at_end': os.getloadavg()})
    (output / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    (output / 'results.partial.json').unlink(missing_ok=True)
    published = ROOT / 'public/benchmarks/node' / stamp
    shutil.copytree(output, published)
    print(f'\nResults: {published.relative_to(ROOT)}/results.json', flush=True)
    for key, label, _ in CLIENTS:
        p = result['packages'][key]
        print(f"{label:14} {p['version']:12} {p['installed_bytes']/2**20:8.2f} MiB  {p['dependencies']:3} deps  {p['summary']['import_ms']['median']:8.2f} ms  {p['summary']['rss_mib']['median']:8.2f} MiB RSS")


if __name__ == '__main__':
    main()
