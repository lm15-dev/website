---
title: Rust benchmarks
description: Measured program size, clean build time, local request time, and memory for LM15 and Rust alternatives.
---

Measured **2026-09-13** on **AMD Ryzen Threadripper 3960X 24-Core Processor**, `Linux 6.18.45`, host `lambda`.

Compiler: `rustc 1.97.1 (8bab26f4f 2026-07-14) (built from a source tarball)`.

**20 parallel workers, one logical CPU each on separate physical cores.** Each library has **40 fresh-process runtime samples** and **5 clean builds**. No individual build or measured client can use multiple cores.

## Results

| Library | Version | Program MiB | Clean build s | Local request µs | Memory MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| async-openai | `0.42.0` | 5.51 | 260.20 | 188.94 | 4.99 |
| genai | `0.6.5` | 8.02 | 323.83 | 203.53 | 6.72 |
| Rig | `0.42.0` | 6.49 | 386.72 | 199.50 | 6.01 |
| LM15 | `0.5.0` | 6.89 | 281.10 | 198.71 | 5.71 |

## Workload

A small program creates a client, sends a non-streaming user message (`Say hello.`) with a 32-token output limit, receives a recorded response, and checks that the returned text is exactly `Hello.`. The response reports three input tokens and two output tokens. Each SDK uses its public client API; no custom serialization replaces its normal request path.

Each fresh process performs **20 warmup requests**, then **200 timed requests**. Its sample is the average time per completed request in that timed block. The chart shows the median of those process averages—not a single-request percentile.

The fixture server checks the prompt, output limit, non-streaming mode, and total request count. A failed build, wrong response, failed request, or wrong CPU assignment stops publication rather than silently excluding that SDK.

### What “Local request” means

A private Python HTTP server returns fixed, provider-shaped JSON over loopback. It and the client share the assigned single CPU. Timing includes the SDK’s encoding, local HTTP transport, fixture handling, response parsing, and text extraction. It is **not pure serialization time**, and it does not measure model generation or internet latency. Client construction, fixture setup, warmup, and process shutdown are outside the timed block.

Every probe has its own Linux network namespace, with only loopback enabled. No provider endpoints are reachable. Credentials are dummy strings, HOME is temporary, and inherited API keys are not passed to clients.

All four Rust clients use OpenAI-compatible Chat Completions. Rig uses its completion-model API, not an agent loop. genai uses an explicit OpenAI model target. The default native client features are retained; `async-openai` additionally enables its required `chat-completion` feature.

LM15 is built from [Rust commit `62dcbff9afa2`](https://github.com/lm15-dev/lm15-rs/tree/62dcbff9afa2688f68fd2c22f7e7f93dcba14377).

## Build and memory rules

Program size includes the linked SDK, runtime, and small timer/reporting scaffold. It does **not** include the external Python fixture server. Programs contain the same logical task, but unused code removal and native feature coverage differ between SDKs.

Rust builds use the release profile with `opt-level=3`, `codegen-units=1`, no LTO, no debug information, and stripped symbols. Every measured build has a new empty target directory and runs `cargo build --release --locked --offline --jobs 1`. The installed Rust standard library is not rebuilt. All Rust work is initiated through `rcargo run` on the build-server coordinator.

Each build and every child compiler inherits one-CPU affinity from `taskset`. Runtime clients also report their CPU affinity, which is verified. Dependency downloads, tool installation, and unmeasured harness validation happen before measurement. Clean builds have no compiled-output cache; shared filesystem caches are not flushed.

Memory is the client’s `/proc/self/status` resident memory after all requests. It includes its runtime and retained allocations. Garbage collection is not forced, and this is not peak memory or a heap-only measurement. The Python fixture process is excluded from the memory value.

Workers share caches, memory bandwidth, storage, and server power budgets. Frequencies are not fixed. These results describe concurrent single-core work, not a perfectly idle isolated core. Libraries with broader features are not necessarily interchangeable; smaller size does not establish equal coverage or correctness.

## Variation

Intervals cover the middle 50% of observations (25th–75th percentiles), not confidence intervals. Error bars are intentionally omitted on the homepage.

| Library | Build s, middle 50% | Local request µs, middle 50% | Memory MiB, middle 50% |
| --- | ---: | ---: | ---: |
| async-openai | 253.83–264.54 | 188.13–190.90 | 4.97–5.04 |
| genai | 321.91–328.00 | 201.29–205.31 | 6.60–6.83 |
| Rig | 376.21–390.16 | 198.09–201.43 | 5.98–6.15 |
| LM15 | 277.95–286.44 | 197.32–201.39 | 5.65–5.77 |

## Comparator sources

- [async-openai](https://github.com/64bit/async-openai) — `0.42.0`
- [genai](https://github.com/jeremychone/rust-genai) — `0.6.5`
- [Rig](https://github.com/0xPlaygrounds/rig) — `0.42.0`
- [LM15](https://github.com/lm15-dev/lm15-rs) — `0.5.0`

## Evidence and reproduction

- [All measurements and source fingerprints](/benchmarks/native/20260913T222757Z/results.json)
- [Benchmark coordinator](/benchmarks/native/20260913T222757Z/runner.py)
- [Client-case definitions](/benchmarks/native/20260913T222757Z/cases.py)
- [Fixture server and validation](/benchmarks/native/20260913T222757Z/probe.py)
- async-openai: [source](/benchmarks/native/20260913T222757Z/harnesses/rust/async-openai/src/main.rs) · [manifest](/benchmarks/native/20260913T222757Z/harnesses/rust/async-openai/Cargo.toml) · [lockfile](/benchmarks/native/20260913T222757Z/harnesses/rust/async-openai/Cargo.lock)
- genai: [source](/benchmarks/native/20260913T222757Z/harnesses/rust/genai/src/main.rs) · [manifest](/benchmarks/native/20260913T222757Z/harnesses/rust/genai/Cargo.toml) · [lockfile](/benchmarks/native/20260913T222757Z/harnesses/rust/genai/Cargo.lock)
- Rig: [source](/benchmarks/native/20260913T222757Z/harnesses/rust/rig/src/main.rs) · [manifest](/benchmarks/native/20260913T222757Z/harnesses/rust/rig/Cargo.toml) · [lockfile](/benchmarks/native/20260913T222757Z/harnesses/rust/rig/Cargo.lock)
- LM15: [source](/benchmarks/native/20260913T222757Z/harnesses/rust/lm15/src/main.rs) · [manifest](/benchmarks/native/20260913T222757Z/harnesses/rust/lm15/Cargo.toml) · [lockfile](/benchmarks/native/20260913T222757Z/harnesses/rust/lm15/Cargo.lock)

Run the coordinator through `rcargo run` from `website/benchmarks/native/`. Use a fresh server work directory and the exact input snapshots recorded with the run. See the repository’s `benchmarks/native/README.md` for the workflow. The LM15 row is built from the Rust commit linked above.
