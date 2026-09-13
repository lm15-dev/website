---
title: Python benchmarks
description: Measured installed size, dependency count, import time, and memory for LM15 and four Python alternatives.
---

Measured **2026-09-13**, using **Python 3.13.13** on **AMD Ryzen Threadripper 3960X 24-Core Processor**.
OS: `Linux 6.18.45` (x86_64), host `lambda`.

**One logical CPU per process**, enforced and recorded in every sample. 20 workers use separate physical cores to collect samples in parallel. No individual measurement uses multiple CPUs.

These measurements describe **installation and import costs**, not model speed, request latency, feature coverage, or the cost of constructing a client.

## Results

Time and memory are medians of **40 fresh processes per library**. Lower is better for these four measurements.

| Library | Version | Installed MiB | Dependencies | Import ms | Memory MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| LiteLLM | `1.100.1` | 158.72 | 54 | 1740.05 | 195.37 |
| Google GenAI | `2.23.0` | 32.83 | 24 | 303.35 | 48.23 |
| OpenAI | `3.13.0` | 16.65 | 13 | 520.48 | 58.23 |
| Anthropic | `1.5.0` | 13.28 | 14 | 437.58 | 55.29 |
| LM15 | `1.0.0rc1` | 1.22 | 0 | 115.22 | 28.17 |

The empty interpreter's median resident memory was **11.86 MiB**. It is **included**, not subtracted, in the memory results above.

## What was measured

**Installed size:** Sum of installed regular file lengths in site-packages, minus files already present in an empty venv; excludes .pyc and the shared interpreter. Includes package metadata, bundled data, and all required dependency packages. Optional extras are not installed.

**Dependencies:** Number of installed Python distributions excluding the root SDK and anything present in an empty venv; includes transitive runtime dependencies.

**Import time:** Median perf_counter_ns time of the public module import in a fresh isolated Python process. Two unmeasured warmups populate .pyc and OS page caches. Excludes interpreter launch, process shutdown, and client construction. No disk-cache flush.

**Memory after import:** Median VmRSS immediately after the same import, including the Python interpreter. Baseline is reported separately and is not subtracted.

MiB means 1,048,576 bytes. Installed size is logical file size, not allocated disk blocks. An SDK with compiled dependencies and a pure-Python SDK still use the same counting rule.

Each library was installed into its own fresh, unseeded `uv` environment with no optional extras. Competitors came from their current stable PyPI releases; their full resolved dependency versions are saved below. Only binary wheel installs were allowed.

LM15 was installed from `lm15-1.0.0rc1-py3-none-any.whl`, the wheel bundled with the website's pinned runtime package, built from [commit `3bbbd3ee1bab`](https://github.com/lm15-dev/lm15-python/tree/3bbbd3ee1bab40a1a61cc74db120c4a8eb7eb22b). Its entire installed package is counted—not just its transports or source files.

### Imports

| Library | Statement |
| --- | --- |
| LiteLLM | `import litellm` |
| Google GenAI | `from google import genai` |
| OpenAI | `import openai` |
| Anthropic | `import anthropic` |
| LM15 | `import lm15` |

### Repetition and isolation

20 parallel workers on distinct physical cores, one logical CPU per subprocess enforced by taskset and verified inside every probe. Each worker runs every library 2 times, in independently shuffled order (seed 20260913 + worker index). Common numeric/thread pools are limited to one thread. No fastest-run selection, governor change, or machine-wide cache clearing. Shared memory bandwidth, caches, and power budgets still allow cross-worker interference; these are concurrent single-core measurements.

Each probe runs in a new Linux user/network namespace with no external network. HOME is temporary and the environment contains no inherited credentials. LiteLLM uses its bundled model cost map via LITELLM_LOCAL_MODEL_COST_MAP=True.

These are fresh Python processes with **warm filesystem and bytecode caches**, not first-install or cold-disk measurements. CPU frequency was not fixed. Workers share memory bandwidth, caches, and the server power budget, so their timings can differ from a completely idle server. The results describe concurrent single-core runs, not multicore acceleration.

The packages do not offer identical features. LiteLLM includes routing and integrations beyond a single provider client. Small size or fast imports do not prove equivalent coverage or correctness.

## Spread between runs

The chart whiskers and the intervals below cover the middle 50% of samples (25th to 75th percentile). They show observed variation, not a 95% confidence interval. Every individual sample and its CPU assignment is in the raw results. Installed size and dependency count are fixed properties of each installation, so they have no whiskers.

| Library | Import ms, middle 50% | Memory MiB, middle 50% |
| --- | ---: | ---: |
| LiteLLM | 1712.79–1764.31 | 195.32–195.38 |
| Google GenAI | 297.83–309.41 | 48.23–48.27 |
| OpenAI | 510.38–530.40 | 58.22–58.26 |
| Anthropic | 429.36–444.10 | 55.27–55.32 |
| LM15 | 113.38–117.39 | 28.16–28.18 |

## Evidence and reproduction

- [Raw results and all samples](/benchmarks/python/20260913T190834Z/results.json)
- [Exact benchmark runner used for this run](/benchmarks/python/20260913T190834Z/runner.py)
- [LiteLLM dependency versions](/benchmarks/python/20260913T190834Z/locks/litellm.txt)
- [Google GenAI dependency versions](/benchmarks/python/20260913T190834Z/locks/google.txt)
- [OpenAI dependency versions](/benchmarks/python/20260913T190834Z/locks/openai.txt)
- [Anthropic dependency versions](/benchmarks/python/20260913T190834Z/locks/anthropic.txt)
- [LM15 dependency versions](/benchmarks/python/20260913T190834Z/locks/lm15.txt)

From the website repository, after `npm ci` has installed the pinned LM15 runtime package:

```sh
python3 scripts/benchmark-python.py --python 3.13.13 --workers 20 --runs 40 \
  --lock-dir public/benchmarks/python/20260913T190834Z/locks
```

Run this on the build server, not the laptop. It requires Linux, `uv`, `taskset`, 20 available physical cores, the specified Python interpreter, and permission to create user/network namespaces with `unshare`. The script refuses to assign two workers to sibling threads of one core. Installation needs internet access; measured imports have no external network.

Installer: `uv 0.12.5 (x86_64-unknown-linux-gnu)`.

Runner SHA-256: `46b3b896f07928b91ef39b48b377dad1c6f663a78a2d7337bde8e822d0d87fb5`.

LM15 wheel SHA-256: `ed35ba2d9d3ec517482941eb3c2e905912983c5755122d09a4e6d4f0053a3d3a`.
