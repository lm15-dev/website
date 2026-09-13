# Native SDK comparisons

Rust: `async-openai`, `genai`, Rig, and LM15. Go: the official OpenAI, Anthropic,
and Google GenAI clients, and LM15. Sources and versions are recorded with each run.

## Run on the server

Do not compile or run benchmark workloads on the laptop. This coordinator is
launched through `rcargo`; its Rust launcher runs the Python coordinator on
192.168.2.24. The coordinator pins every compiler and client process to one CPU.

From this folder:

```sh
python3 snapshot.py
RCARGO_JOBS=1 rcargo run -- \
  --workdir /home/maxime/benchmarks/lm15-native/NEW-RUN \
  --prepare-only
RCARGO_JOBS=1 rcargo run -- \
  --workdir /home/maxime/benchmarks/lm15-native/NEW-RUN
```

The first command only snapshots source files. Rust must be clean and is
identified by its Git commit. Go is currently an uncommitted implementation;
its exact file contents are snapshotted and hashed, without committing or
modifying that SDK. `inputs/` is ignored by Git but synchronized by rcargo.
Keep those archives on the server if the Go result needs to be reproduced.
Do not label the old Go Git commit as the measured source.

A fresh work directory is required when source snapshots change. To replay a
published run, use its archived `runner.py`, `cases.py`, and `probe.py`, restore
its exact input archives, and copy its `harnesses/rust/` and `harnesses/go/`
folders into the new server work directory before launching. Existing Cargo
lockfiles and Go module files are reused rather than resolving new releases.
Use the compiler versions recorded in that report.

Preparation resolves and locks comparator dependencies, compiles the tiny client examples,
and verifies actual requests and responses against the fixture server. This
is not a broad SDK test suite. API or fixture failures stop publication.

The default full run performs:

- 5 clean, single-core builds per library; downloaded sources remain cached.
- 40 fresh client processes per library, using 20 separate physical cores.
- 20 warmup requests followed by 200 timed requests in each process.
- Full reply and request-count checks, and recorded CPU affinity.

Compilers run offline in private network namespaces. Runtime probes enable
only their private loopback interface. Each fixture server shares its client's
single CPU. No external provider can be called and no real key is loaded.

## What the four charts mean

- **Program size:** the stripped release executable, including the small client
  and measurement scaffold, not the Python fixture server.
- **Clean build:** no compiled dependency outputs are reused. Rust gets a new
  target directory; Go gets a new build cache, including its standard library.
- **Local request:** encoding, loopback HTTP, fixture handling, parsing, and
  extracting the text. This is not pure codec speed or internet/model latency.
- **Memory:** client process resident memory after repeated calls, including
  runtime and retained allocations. No forced garbage collection; not peak RSS.

Rust uses optimization level 3, one codegen unit, no LTO, stripped symbols, and
its default native features. Go uses `CGO_ENABLED=0`, `GOMAXPROCS=1`, `-p=1`,
`-trimpath`, and stripped symbols. Forty runtime samples are balanced across
cores. Concurrent workers still share storage, caches, and power budgets.

## Publish a completed run

Copy only `<server-workdir>/results/` into
`website/public/benchmarks/native/<run>/`, then from `website/` run:

```sh
python3 scripts/publish-native-benchmarks.py \
  public/benchmarks/native/<run>/results.json
```

This creates typed Rust/Go chart data and two documentation pages. Raw samples,
source fingerprints, benchmark harnesses, fixtures, and dependency lockfiles
remain available. The unfinished LM15 Go implementation is not published in
that evidence folder; its exact snapshot stays on the server.
