---
title: Node.js benchmarks
description: Measured installation and import costs for LM15, Vercel AI SDK, OpenAI, Anthropic, and Google GenAI on Node.js.
---

Measured **2026-09-13**, using **Node.js v22.23.2**, on **AMD Ryzen Threadripper 3960X 24-Core Processor**.
OS: `Linux 6.18.45` (x86_64), host `lambda`.

These results supply the homepage’s **TypeScript** charts. Libraries are loaded as JavaScript through their public **Node ESM entries**. This is not a browser bundle, tree-shaking, TypeScript compilation, request, or model-latency benchmark.

**20 parallel workers, one logical CPU per process, 40 fresh-process samples per library.** Every worker has its own physical core. CPU affinity and the Node version are verified in every sample.

## Results

Time and memory are medians. Installed size and dependencies are fixed properties of each production install.

| Library | npm package | Version | Installed MiB | Dependencies | Import ms | Memory MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Vercel AI SDK | `ai` | `7.0.99` | 24.33 | 13 | 124.90 | 78.46 |
| Google GenAI | `@google/genai` | `2.22.0` | 27.39 | 40 | 135.88 | 79.07 |
| OpenAI | `openai` | `7.15.0` | 16.97 | 0 | 99.96 | 72.66 |
| Anthropic | `@anthropic-ai/sdk` | `0.125.0` | 9.15 | 6 | 55.45 | 61.82 |
| LM15 | `lm15` | `1.0.0-alpha.0` | 3.16 | 0 | 54.76 | 66.11 |

The empty Node process used **47.24 MiB** resident memory. This baseline is **included**, not subtracted, in the table.

## Vercel setup

The Vercel row includes **`ai` plus its OpenAI, Anthropic, and Google adapters**. Installed size and dependency count cover the whole setup. The timed block imports the core and all three adapters sequentially in the same process. Measuring only `ai` would omit the packages that connect it to these providers.

Adapter versions: `@ai-sdk/anthropic@4.0.53`, `@ai-sdk/google@4.0.69`, `@ai-sdk/openai@4.0.66`.

This is a three-provider setup, not the smallest possible Vercel installation. Applications using only one adapter or a bundler can have a smaller footprint. Vercel’s additional framework features are not exercised by this import-only benchmark.

## Method

**Installed size:** Logical bytes of regular files in the production node_modules tree, including the entire SDK, type declarations, source maps, bundled data, npm metadata, and installed transitive dependencies. Excludes symlinks, the shared Node executable, the project lockfile, and the input tarball. No bundling or tree-shaking.

**Dependencies:** Installed npm package instances minus the root SDK. Includes transitive, peer, and optional packages actually installed on this platform; nested duplicate installations count separately. Vercel includes its three explicitly selected provider adapters in this count. Development dependencies are omitted.

**Import time:** Median process.hrtime.bigint time around the listed public ESM imports in a fresh Node process. Vercel imports ai and its OpenAI, Anthropic, and Google adapters sequentially inside the same timed block. Two unmeasured warmups populate OS file caches. Excludes process launch, shutdown, client construction, and provider calls. Persistent Node compile caching is explicitly disabled.

**Memory after import:** Median process.memoryUsage.rss() immediately after the same import, including Node and V8. Empty-process baseline is reported separately, not subtracted.

MiB means 1,048,576 bytes. The time measurement begins immediately before `await import(...)` and ends when it resolves. `process.memoryUsage.rss()` is sampled immediately afterward, before importing the file-reading helper used to verify CPU affinity.

Every library gets a separate fresh npm project. The official clients were resolved from the current npm releases, then their exact versions and integrity hashes were saved in lockfiles. Production dependencies, including installed peer/optional dependencies, are included. Development dependencies are not.

Package lifecycle scripts were disabled equally for all installs. Import probes succeeded under that policy. Any install hooks declared by dependencies are recorded in the raw inventory; this is an import benchmark, not a claim that every optional integration works without its install hook.

LM15 is its **normal npm package**, built on the server from [commit `f991638a5211`](https://github.com/lm15-dev/lm15-ts/tree/f991638a52117a2bafed6459b6f4cd56a0e44955) with `npm run build:typescript` and packaged using `npm pack`. Its declarations, source maps, CommonJS and ESM builds, and documentation are counted. The website's extra Python, Rust, and browser-runtime files are **not** included.

### Entry points

| Library | Import |
| --- | --- |
| Vercel AI SDK | `await import("ai"); await import("@ai-sdk/openai"); await import("@ai-sdk/anthropic"); await import("@ai-sdk/google");` |
| Google GenAI | `await import("@google/genai");` |
| OpenAI | `await import("openai");` |
| Anthropic | `await import("@anthropic-ai/sdk");` |
| LM15 | `await import("lm15");` |

### Sampling and isolation

20 workers on distinct physical cores. Every fresh process is restricted to one logical CPU with taskset; affinity and Node version are verified in the probe. Each worker measures every package 2 times in shuffled order (seed 20260913 + worker index). UV_THREADPOOL_SIZE=1 and common numeric libraries are limited to one thread. Shared caches, memory bandwidth, and power budgets can still affect concurrent workers. No best-run selection or frequency changes.

Imports run in fresh Linux user/network namespaces without external network; temporary HOME and allowlisted environment have no inherited API keys or tokens. Installs use npm registry access, with lifecycle scripts disabled for every package.

Operating-system file caches are warm, but each sample has a new JavaScript module cache and a new V8 process. Persistent Node compile caching is disabled. The server clock speed is not fixed. Shared memory/cache/power contention remains possible, so these numbers describe concurrent **single-core** runs, not multicore acceleration.

The SDKs have different feature coverage and loading strategies. A small import does not guarantee that later client construction or the first request is cheaper. These Node results should not be directly compared with Python timings as if the runtimes and work were identical.

## Variation

The interval covers the middle 50% of samples (25th–75th percentile), not a confidence interval. All samples remain available even though the homepage omits error bars.

| Library | Import ms, middle 50% | Memory MiB, middle 50% |
| --- | ---: | ---: |
| Vercel AI SDK | 123.50–127.04 | 78.25–78.68 |
| Google GenAI | 133.93–137.41 | 77.05–80.34 |
| OpenAI | 97.25–101.42 | 72.24–72.88 |
| Anthropic | 54.54–56.77 | 61.46–62.04 |
| LM15 | 54.09–55.68 | 65.96–66.39 |

## Evidence and reproduction

- [All raw samples and package inventories](/benchmarks/node/20260913T210812Z/results.json)
- [Exact Node benchmark runner](/benchmarks/node/20260913T210812Z/benchmark-node.py)
- [Shared sampling helpers used by that runner](/benchmarks/node/20260913T210812Z/benchmark-python.py)
- [Exact LM15 npm archive](/benchmarks/node/20260913T210812Z/lm15.tgz)
- Vercel AI SDK: [project](/benchmarks/node/20260913T210812Z/locks/vercel/package.json) · [lockfile](/benchmarks/node/20260913T210812Z/locks/vercel/package-lock.json)
- Google GenAI: [project](/benchmarks/node/20260913T210812Z/locks/google/package.json) · [lockfile](/benchmarks/node/20260913T210812Z/locks/google/package-lock.json)
- OpenAI: [project](/benchmarks/node/20260913T210812Z/locks/openai/package.json) · [lockfile](/benchmarks/node/20260913T210812Z/locks/openai/package-lock.json)
- Anthropic: [project](/benchmarks/node/20260913T210812Z/locks/anthropic/package.json) · [lockfile](/benchmarks/node/20260913T210812Z/locks/anthropic/package-lock.json)
- LM15: [project](/benchmarks/node/20260913T210812Z/locks/lm15/package.json) · [lockfile](/benchmarks/node/20260913T210812Z/locks/lm15/package-lock.json)

Replay on the build server from the website repository, with the same Node version installed:

```sh
python3 scripts/benchmark-node.py --lm15-package public/benchmarks/node/20260913T210812Z/lm15.tgz \
  --source-commit f991638a52117a2bafed6459b6f4cd56a0e44955 --workers 20 --runs 40 \
  --lock-dir public/benchmarks/node/20260913T210812Z/locks
```

Requires Linux, Node, npm, Python for orchestration, `taskset`, and permission to create user/network namespaces. Installation needs internet access; measured imports have no external network. No provider keys or paid calls are used.

npm: `10.9.8`. Node: `v22.23.2`. V8: `12.4.254.21-node.56`.

LM15 archive SHA-256: `8454ed5a7581e10cc93c9707f2a7317de43f450b1c367eda0e55390e1dfe8f26`.

Runner SHA-256: `7c69ca9fe1726eebc5ecab202c36add4f73d362fd81cd8b9f8b490d8c69e8a09`. Shared helper SHA-256: `46b3b896f07928b91ef39b48b377dad1c6f663a78a2d7337bde8e822d0d87fb5`.
