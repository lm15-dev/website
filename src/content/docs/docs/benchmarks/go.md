---
title: Go benchmarks
description: Measured program size, clean build time, local request time, and memory for LM15 and Go alternatives.
---

Measured **2026-09-13** on **AMD Ryzen Threadripper 3960X 24-Core Processor**, `Linux 6.18.45`, host `lambda`.

Compiler: `go version go1.26.7 linux/amd64`.

**20 parallel workers, one logical CPU each on separate physical cores.** Each library has **40 fresh-process runtime samples** and **5 clean builds**. No individual build or measured client can use multiple cores.

## Results

| Library | Version | Program MiB | Clean build s | Local request µs | Memory MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| OpenAI | `v3.61.0` | 12.17 | 71.09 | 274.11 | 13.95 |
| Anthropic | `v1.72.0` | 10.32 | 57.90 | 264.33 | 13.27 |
| Google GenAI | `v1.71.0` | 12.92 | 49.35 | 259.86 | 16.72 |
| LM15 | `working-tree snapshot` | 8.32 | 31.25 | 209.17 | 10.21 |

## Workload

A small program creates a client, sends a non-streaming user message (`Say hello.`) with a 32-token output limit, receives a recorded response, and checks that the returned text is exactly `Hello.`. The response reports three input tokens and two output tokens. Each SDK uses its public client API; no custom serialization replaces its normal request path.

Each fresh process performs **20 warmup requests**, then **200 timed requests**. Its sample is the average time per completed request in that timed block. The chart shows the median of those process averages—not a single-request percentile.

The fixture server checks the prompt, output limit, non-streaming mode, and total request count. A failed build, wrong response, failed request, or wrong CPU assignment stops publication rather than silently excluding that SDK.

### What “Local request” means

A private Python HTTP server returns fixed, provider-shaped JSON over loopback. It and the client share the assigned single CPU. Timing includes the SDK’s encoding, local HTTP transport, fixture handling, response parsing, and text extraction. It is **not pure serialization time**, and it does not measure model generation or internet latency. Client construction, fixture setup, warmup, and process shutdown are outside the timed block.

Every probe has its own Linux network namespace, with only loopback enabled. No provider endpoints are reachable. Credentials are dummy strings, HOME is temporary, and inherited API keys are not passed to clients.

OpenAI and LM15 use Chat Completions; Anthropic uses Messages; Google uses Generate Content. Their wire formats differ, but the prompt, output limit, and returned text are equivalent. Each response uses that provider’s normal JSON shape.

**LM15 Go is an unreleased working-tree snapshot**, not the old Git commit or a published release. No changes were committed to the Go SDK repository for this benchmark. The exact snapshot is retained on the build server; its archive hash and per-file hashes are recorded in the raw results. The unfinished SDK source is not redistributed with the website.

Go snapshot SHA-256: `c56f39932efb8de9350e9c528186c446ddd02d687328385ecbc7ca516d65462a`. Base commit (not the measured source): `82cfef9609e8ff14edc7cac037563a7f8d8e8ade`.

## Build and memory rules

Program size includes the linked SDK, runtime, and small timer/reporting scaffold. It does **not** include the external Python fixture server. Programs contain the same logical task, but unused code removal and native feature coverage differ between SDKs.

Go builds use `CGO_ENABLED=0`, `GOMAXPROCS=1`, `-p=1`, `-trimpath`, `-buildvcs=false`, and `-ldflags="-s -w"`. Each measured build has a fresh `GOCACHE`, including fresh compilation of standard-library packages. Module downloads are already cached.

Each build and every child compiler inherits one-CPU affinity from `taskset`. Runtime clients also report their CPU affinity, which is verified. Dependency downloads, tool installation, and unmeasured harness validation happen before measurement. Clean builds have no compiled-output cache; shared filesystem caches are not flushed.

Memory is the client’s `/proc/self/status` resident memory after all requests. It includes its runtime and retained allocations. Garbage collection is not forced, and this is not peak memory or a heap-only measurement. The Python fixture process is excluded from the memory value.

Workers share caches, memory bandwidth, storage, and server power budgets. Frequencies are not fixed. These results describe concurrent single-core work, not a perfectly idle isolated core. Libraries with broader features are not necessarily interchangeable; smaller size does not establish equal coverage or correctness.

## Variation

Intervals cover the middle 50% of observations (25th–75th percentiles), not confidence intervals. Error bars are intentionally omitted on the homepage.

| Library | Build s, middle 50% | Local request µs, middle 50% | Memory MiB, middle 50% |
| --- | ---: | ---: | ---: |
| OpenAI | 70.09–71.13 | 269.80–276.82 | 13.86–14.08 |
| Anthropic | 57.73–58.83 | 260.91–267.98 | 13.07–13.34 |
| Google GenAI | 48.67–50.54 | 253.82–262.12 | 16.63–16.78 |
| LM15 | 31.01–32.46 | 206.46–211.16 | 10.21–10.22 |

## Comparator sources

- [OpenAI](https://github.com/openai/openai-go) — `v3.61.0`
- [Anthropic](https://github.com/anthropics/anthropic-sdk-go) — `v1.72.0`
- [Google GenAI](https://github.com/googleapis/go-genai) — `v1.71.0`
- [LM15](https://github.com/lm15-dev/lm15-go) — `working-tree snapshot`

## Evidence and reproduction

- [All measurements and source fingerprints](/benchmarks/native/20260913T222757Z/results.json)
- [Benchmark coordinator](/benchmarks/native/20260913T222757Z/runner.py)
- [Client-case definitions](/benchmarks/native/20260913T222757Z/cases.py)
- [Fixture server and validation](/benchmarks/native/20260913T222757Z/probe.py)
- OpenAI: [source](/benchmarks/native/20260913T222757Z/harnesses/go/openai/main.go) · [module](/benchmarks/native/20260913T222757Z/harnesses/go/openai/go.mod)
- Anthropic: [source](/benchmarks/native/20260913T222757Z/harnesses/go/anthropic/main.go) · [module](/benchmarks/native/20260913T222757Z/harnesses/go/anthropic/go.mod)
- Google GenAI: [source](/benchmarks/native/20260913T222757Z/harnesses/go/google/main.go) · [module](/benchmarks/native/20260913T222757Z/harnesses/go/google/go.mod)
- LM15: [source](/benchmarks/native/20260913T222757Z/harnesses/go/lm15/main.go) · [module](/benchmarks/native/20260913T222757Z/harnesses/go/lm15/go.mod)

Run the coordinator through `rcargo run` from `website/benchmarks/native/`. Use a fresh server work directory and the exact input snapshots recorded with the run. See the repository’s `benchmarks/native/README.md` for the workflow. Reproducing the LM15 Go row requires the retained working-tree snapshot; checking out its base commit is not equivalent.
