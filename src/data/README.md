# Homepage visual data

Python uses measured data in `python-benchmarks.ts`; TypeScript uses Node.js
measurements in `node-benchmarks.ts`; Rust and Go use `native-benchmarks.ts`.
All come from server runs linked by their reports. R and Julia still use
**invented design fixtures**, labeled as demo data.

Run `scripts/benchmark-python.py` on **192.168.2.24**, not the laptop. Its default
20 workers use distinct physical cores, with each benchmark process restricted
to one logical CPU. Forty runs give two samples per library per worker.
Copy the completed report folder back, then run
`python3 scripts/publish-python-benchmarks.py public/benchmarks/python/<run>/results.json`
to regenerate the Python chart data and documentation. The script and full
dependency versions used for each run are archived with the results.

For Node, copy `benchmark-node.py`, `benchmark-python.py` (shared helpers), and
`prepare-node-benchmark.sh` into a fresh server folder's `scripts/` directory.
Run `bash scripts/prepare-node-benchmark.sh <lm15-ts-commit>` there. It builds
and packs the normal SDK, then uses the same 20-worker/40-sample arrangement.
Copy back the completed `public/benchmarks/node/<run>/` folder and run
`python3 scripts/publish-node-benchmarks.py public/benchmarks/node/<run>/results.json`.
Node lockfiles and the exact LM15 archive are included for replay. Vercel's row
installs and imports `ai` plus `@ai-sdk/openai`, `@ai-sdk/anthropic`, and
`@ai-sdk/google`; adapter versions are listed in the report. The website's larger,
combined runtime package must not be used for npm SDK footprint comparisons.

For Rust and Go, follow `benchmarks/native/README.md`. Those runs use 5 clean
single-core builds and 40 runtime processes per SDK. A private loopback server
checks equivalent requests and recorded replies. The native charts show program
size, clean build time, local request time, and client memory—not import costs.
The LM15 Go result uses an explicitly recorded, unreleased source snapshot.

Replace each `BENCHMARKS[language]` independently. A measured suite requires:

- `status: 'measured'`
- `measuredAt`: measurement date
- `environment`: runtime, machine, and relevant build settings
- `sourceUrl`: a report recording package versions, workload, and methodology
- `metrics`: chart titles, units, descriptions, and client values

Each client has a stable `id`, a display `label`, and a numeric `value`.
`id: 'lm15'` receives the brand color. Use `null` for missing measurements;
zero is displayed as zero. Values in a single chart must use the same unit and
workload. An optional `spread: { low, high }` holds the 25th and 75th percentiles
for timing and memory. These intervals remain in tooltips and reports; the
homepage intentionally omits error bars. Every chart starts at zero and scales
to its largest displayed value.
The current four metrics assume that lower is better.

The language tabs update these charts automatically. Provider/model selections
do not change them: these are local SDK costs, not model response speeds.
Python's comparisons include LiteLLM; Node includes Vercel with three provider
adapters. Rust compares async-openai, genai, and Rig; Go compares the official
OpenAI, Anthropic, and Google clients. Only R and Julia retain generic labels.

`request-flow.ts` contains the separate conceptual diagram. Keep its input and
output types honest: generation, realtime, and job APIs are separate from the
core chat `Request`/`Response` path. Its groups are revealed by ordinary scrolling.
