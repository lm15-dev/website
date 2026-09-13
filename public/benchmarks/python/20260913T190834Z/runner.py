#!/usr/bin/env python3
"""Measure Python SDK installation and import costs without provider calls (Linux).

Run on the build server, not the laptop:
python3 scripts/benchmark-python.py --python 3.13.13 --workers 20 --runs 40
Replay: add --lock-dir public/benchmarks/python/<run>/locks
Fresh virtualenvs are retained under /tmp/lm15-python-benchmarks for inspection.
Results enter the website only after all timing samples finish.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import shutil
import statistics
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CLIENTS = [
    ("litellm", "LiteLLM", "litellm", "import litellm"),
    ("google", "Google GenAI", "google-genai", "from google import genai"),
    ("openai", "OpenAI", "openai", "import openai"),
    ("anthropic", "Anthropic", "anthropic", "import anthropic"),
    ("lm15", "LM15", "lm15", "import lm15"),
]

# No inherited provider keys, tokens, proxy credentials, or Python import paths.
def environment(home: Path) -> dict[str, str]:
    env = {key: os.environ[key] for key in (
        "PATH", "NIX_LD", "NIX_LD_LIBRARY_PATH", "LD_LIBRARY_PATH", "SSL_CERT_FILE",
    ) if key in os.environ}
    env.update({
        "HOME": str(home), "XDG_CACHE_HOME": str(home / ".cache"),
        "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
        "LITELLM_LOCAL_MODEL_COST_MAP": "True", "LITELLM_LOG": "ERROR",
        "DO_NOT_TRACK": "1", "HF_HUB_OFFLINE": "1",
        "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1", "VECLIB_MAXIMUM_THREADS": "1",
        "TOKENIZERS_PARALLELISM": "false",
    })
    return env


def run(command: list[str], env: dict[str, str], *, timeout: int = 600) -> str:
    result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"Command failed: {command[0]}\n{result.stderr[-5000:]}\n{result.stdout[-1000:]}")
    return result.stdout


METADATA = """
import importlib.metadata as m, json, sys, sysconfig
print(json.dumps({
    'python': sys.version,
    'site': sysconfig.get_paths()['purelib'],
    'distributions': sorted([
        {'name': d.metadata['Name'], 'version': d.version}
        for d in m.distributions()
    ], key=lambda d: d['name'].lower()),
}))
"""

# Time only the public import. Read RSS before importing the reporting modules.
# -I isolates site/user/PYTHONPATH configuration; every sample is a new process.
PROBE = """
import time
cpu_start = time.process_time_ns()
start = time.perf_counter_ns()
{statement}
elapsed = time.perf_counter_ns() - start
cpu_elapsed = time.process_time_ns() - cpu_start
rss_kib = None
for line in open('/proc/self/status'):
    if line.startswith('VmRSS:'):
        rss_kib = int(line.split()[1])
        break
if rss_kib is None:
    raise RuntimeError('VmRSS unavailable')
import json, resource, os
print('LM15_BENCHMARK=' + json.dumps({{
    'cpu_affinity': sorted(os.sched_getaffinity(0)),
    'import_ms': elapsed / 1000000,
    'import_cpu_ms': cpu_elapsed / 1000000,
    'rss_mib': rss_kib / 1024,
    'peak_rss_mib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
}}), flush=True)
"""


def size_files(site: Path) -> dict[str, int]:
    # Logical bytes, not allocated filesystem blocks or uv cache hardlink accounting.
    return {
        str(path.relative_to(site)): path.stat().st_size
        for path in site.rglob('*')
        if path.is_file() and not path.is_symlink() and path.suffix != '.pyc'
    }


def summary(values: list[float]) -> dict[str, float]:
    ordered = sorted(values)
    def percentile(p: float) -> float:
        position = (len(ordered) - 1) * p
        low = int(position)
        high = min(low + 1, len(ordered) - 1)
        return ordered[low] + (ordered[high] - ordered[low]) * (position - low)
    return {
        'median': statistics.median(values), 'min': min(values), 'max': max(values),
        'p25': percentile(.25), 'p75': percentile(.75),
    }


def measure(py: Path, statement: str, env: dict[str, str], cpu: int) -> dict:
    # Affinity is inherited by every thread; imports cannot use several CPUs.
    output = run(['taskset', '--cpu-list', str(cpu), 'unshare', '--user', '--map-root-user', '--net', str(py), '-I', '-c', PROBE.format(statement=statement)], env, timeout=120)
    records = [line.removeprefix('LM15_BENCHMARK=') for line in output.splitlines() if line.startswith('LM15_BENCHMARK=')]
    if len(records) != 1:
        raise RuntimeError('Import probe did not emit exactly one measurement')
    record = json.loads(records[0])
    if record['cpu_affinity'] != [cpu]:
        raise RuntimeError(f'Probe escaped its assigned CPU {cpu}')
    return record


def physical_cpus(env: dict[str, str]) -> list[int]:
    allowed = os.sched_getaffinity(0)
    cores = {}
    for line in run(['lscpu', '-p=CPU,CORE,SOCKET,ONLINE'], env).splitlines():
        if line.startswith('#'):
            continue
        cpu, core, socket, online = line.split(',')
        if online == 'Y' and int(cpu) in allowed:
            cores.setdefault((int(socket), int(core)), int(cpu))
    return list(cores.values())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', default='3.13.13')
    parser.add_argument('--runs', type=int, default=40)
    parser.add_argument('--workers', type=int, default=20)
    parser.add_argument('--lock-dir', type=Path)
    args = parser.parse_args()
    if args.runs < 5 or args.workers < 1 or args.runs % args.workers:
        parser.error('Use at least five runs, with runs a multiple of the positive worker count')
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    scratch = Path(tempfile.gettempdir()) / 'lm15-python-benchmarks' / stamp
    output = scratch / 'results'
    home = scratch / 'home'
    home.mkdir(parents=True)
    (output / 'locks').mkdir(parents=True)
    runner_source = Path(__file__).read_bytes()
    (output / 'runner.py').write_bytes(runner_source)
    env = environment(home)
    available = physical_cpus(env)
    if args.workers > len(available):
        parser.error(f'Requested {args.workers} workers but only {len(available)} distinct physical cores are available')
    cpus = available[-args.workers:] # Leave the low-numbered system cores free when possible.
    print(f'{args.workers} workers on distinct physical cores: {cpus}; one logical CPU per process', flush=True)
    # Never fall back to imports that can reach the network.
    run(['unshare', '--user', '--map-root-user', '--net', 'true'], env)
    lookup_env = {**env, 'UV_PYTHON_INSTALL_DIR': os.environ.get('UV_PYTHON_INSTALL_DIR', str(Path.home() / '.local/share/uv/python'))}
    interpreter = run(['uv', '--no-config', 'python', 'find', args.python], lookup_env).strip()
    # The exact published wheel used by the website; not an editable source install.
    runtime = ROOT / 'node_modules/lm15/runtime'
    wheels = list(runtime.glob('lm15-*-py3-none-any.whl'))
    if len(wheels) != 1:
        raise RuntimeError('Run npm ci first to install the pinned LM15 wheel')
    wheel = wheels[0]
    pins = json.loads((runtime / 'sources.json').read_text())
    cpu = next((line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')), platform.machine())
    result = {
        'schema_version': 1,
        'runner_sha256': hashlib.sha256(runner_source).hexdigest(),
        'started_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'os': f'{platform.system()} {platform.release()}',
        'architecture': platform.machine(), 'cpu': cpu,
        'logical_cpus': os.cpu_count(), 'load_at_start': os.getloadavg(),
        'host': platform.node(), 'workers': args.workers, 'worker_cpus': cpus,
        'uv': run(['uv', '--version'], env).strip(),
        'samples_per_client': args.runs, 'warmups_per_client': 2,
        'method': {
            'size': 'Sum of installed regular file lengths in site-packages, minus files already present in an empty venv; excludes .pyc and the shared interpreter. Includes package metadata, bundled data, and all required dependency packages. Optional extras are not installed.',
            'dependencies': 'Number of installed Python distributions excluding the root SDK and anything present in an empty venv; includes transitive runtime dependencies.',
            'startup': 'Median perf_counter_ns time of the public module import in a fresh isolated Python process. Two unmeasured warmups populate .pyc and OS page caches. Excludes interpreter launch, process shutdown, and client construction. No disk-cache flush.',
            'memory': 'Median VmRSS immediately after the same import, including the Python interpreter. Baseline is reported separately and is not subtracted.',
            'network': 'Each probe runs in a new Linux user/network namespace with no external network. HOME is temporary and the environment contains no inherited credentials. LiteLLM uses its bundled model cost map via LITELLM_LOCAL_MODEL_COST_MAP=True.',
            'order': f'{args.workers} parallel workers on distinct physical cores, one logical CPU per subprocess enforced by taskset and verified inside every probe. Each worker runs every library {args.runs // args.workers} times, in independently shuffled order (seed 20260913 + worker index). Common numeric/thread pools are limited to one thread. No fastest-run selection, governor change, or machine-wide cache clearing. Shared memory bandwidth, caches, and power budgets still allow cross-worker interference; these are concurrent single-core measurements.',
        },
        'lm15': {'source_commit': pins['python'], 'wheel': wheel.name, 'wheel_sha256': hashlib.sha256(wheel.read_bytes()).hexdigest()},
        'packages': {},
    }
    environments: dict[str, Path] = {}
    statements = {'baseline': 'pass'}
    baseline_files: dict[str, int] = {}
    baseline_packages: set[str] = set()
    for key, label, package, statement in [('baseline', 'Empty Python', '', 'pass'), *CLIENTS]:
        venv = scratch / key
        print(f'Preparing {label}…', flush=True)
        run(['uv', '--no-config', 'venv', '--python', interpreter, str(venv)], env)
        py = venv / 'bin/python'
        if package:
            target = str(wheel) if key == 'lm15' else package
            command = ['uv', '--no-config', 'pip', 'install', '--python', str(py), '--only-binary', ':all:', '--link-mode', 'copy', target]
            if args.lock_dir:
                command += ['--constraint', str(args.lock_dir.resolve() / f'{key}.txt')]
            run(command, env)
        info = json.loads(run([str(py), '-I', '-c', METADATA], env))
        if key == 'baseline':
            result['python'] = info['python']
        elif info['python'] != result['python']:
            raise RuntimeError('Interpreters differ between clients')
        files = size_files(Path(info['site']))
        names = {item['name'].lower().replace('_', '-') for item in info['distributions']}
        if key == 'baseline':
            baseline_files = files
            baseline_packages = names
        added = {name: size for name, size in files.items() if name not in baseline_files}
        versions = {item['name'].lower().replace('_', '-'): item['version'] for item in info['distributions']}
        record = {
            'label': label, 'package': package,
            'version': versions.get(package), 'import_statement': statement,
            'installed_bytes': sum(added.values()),
            'dependencies': len(names - baseline_packages - {package}),
            'distributions': info['distributions'],
            'samples': [],
        }
        (output / 'locks' / f'{key}.txt').write_text(''.join(f"{item['name']}=={item['version']}\n" for item in info['distributions']))
        result['packages'][key] = record
        environments[key] = py
        statements[key] = statement
        print(f"  {record['version'] or 'baseline'} · {record['installed_bytes'] / 2**20:.2f} MiB · {record['dependencies']} dependencies", flush=True)

    print('Warming import caches…', flush=True)
    for key, py in environments.items():
        for _ in range(2):
            measure(py, statements[key], env, cpus[0])

    def collect_worker(index: int, cpu: int) -> list[tuple[str, dict]]:
        rng = random.Random(20260913 + index)
        samples = []
        for iteration in range(args.runs // args.workers):
            keys = list(environments)
            rng.shuffle(keys)
            for key in keys:
                sample = measure(environments[key], statements[key], env, cpu)
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
    for record in result['packages'].values():
        record['summary'] = {metric: summary([sample[metric] for sample in record['samples']]) for metric in ['import_ms', 'import_cpu_ms', 'rss_mib', 'peak_rss_mib']}
    result['finished_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
    result['load_at_end'] = os.getloadavg()
    (output / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    (output / 'results.partial.json').unlink(missing_ok=True)
    published = ROOT / 'public/benchmarks/python' / stamp
    shutil.copytree(output, published)
    print(f'\nResults: {published.relative_to(ROOT)}/results.json', flush=True)
    for key, label, _, _ in CLIENTS:
        record = result['packages'][key]
        print(f"{label:14} {record['version']:12} {record['installed_bytes']/2**20:8.2f} MiB  {record['dependencies']:3} deps  {record['summary']['import_ms']['median']:8.2f} ms  {record['summary']['rss_mib']['median']:8.2f} MiB RSS")


if __name__ == '__main__':
    main()
