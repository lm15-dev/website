#!/usr/bin/env python3
"""Publish a completed native server run to the Rust and Go homepage charts."""
import datetime as dt
import json
import math
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
ORDERS={'rust':['async-openai','genai','rig','lm15'],'go':['openai','anthropic','google','lm15']}

def main():
    path=Path(sys.argv[1]).resolve()
    relative=path.relative_to(ROOT/'public')
    data=json.loads(path.read_text())
    date=dt.datetime.fromisoformat(data['finished_at']).date().isoformat()
    url='/'+str(relative.parent)
    suites={}
    for language,order in ORDERS.items():
        records=[data['cases'][f'{language}/{key}'] for key in order]
        for record in records:
            if len(record['samples'])!=data['runtime_samples'] or len(record['builds'])!=data['build_samples']: raise ValueError('Incomplete run')
            for sample in record['samples']:
                if sample['cpu_affinity']!=str(data['worker_cpus'][sample['worker']]): raise ValueError('Incorrect CPU assignment')
                if sample['fixture']['errors'] or sample['fixture']['requests']!=data['iterations']+20: raise ValueError('Incorrect workload')
                if not all(math.isfinite(sample[key]) and sample[key]>0 for key in ['request_us','rss_mib']): raise ValueError('Invalid measurement')
        definitions=[
            ('binary','Program size','MiB','binary_bytes',2**20,'Size of the stripped release executable containing the client example and measurement scaffold.'),
            ('build','Clean build','s','build_s',1,'Median single-core clean build. Downloaded dependencies are cached, but compiled outputs are not.'),
            ('request','Local request','µs','request_us',1,'Median of process-average non-streaming request times against a private loopback fixture server. Includes local HTTP and fixture overhead, not external provider latency.'),
            ('memory','Memory after requests','MiB','rss_mib',1,'Median client process resident memory after repeated requests. Includes the language runtime; excludes the separate fixture server.'),
        ]
        suites[language]={
            'status':'measured','measuredAt':date,
            'environment':f"{data['toolchains']['rustc' if language=='rust' else 'go']} · {data['cpu']} · single-core processes on {data['workers']} workers",
            'sourceUrl':f'/docs/benchmarks/{language}/',
            'metrics':[{'id':key,'label':label,'unit':unit,'description':description,'values':[
                {'id':record['id'],'label':record['label'],'value':record['summary'][stat]['median']/scale,
                 **({'spread':{'low':record['summary'][stat]['p25']/scale,'high':record['summary'][stat]['p75']/scale}} if stat!='binary_bytes' else {})}
                for record in records
            ]} for key,label,unit,stat,scale,description in definitions],
        }
        title='Rust' if language=='rust' else 'Go'
        lines=[
            '---',f'title: {title} benchmarks',f'description: Measured program size, clean build time, local request time, and memory for LM15 and {title} alternatives.','---','',
            f"Measured **{date}** on **{data['cpu']}**, `{data['os']}`, host `{data['host']}`.",'',
            f"Compiler: `{data['toolchains']['rustc' if language=='rust' else 'go']}`.",'',
            f"**{data['workers']} parallel workers, one logical CPU each on separate physical cores.** Each library has **{data['runtime_samples']} fresh-process runtime samples** and **{data['build_samples']} clean builds**. No individual build or measured client can use multiple cores.",'',
            '## Results','',
            '| Library | Version | Program MiB | Clean build s | Local request µs | Memory MiB |',
            '| --- | --- | ---: | ---: | ---: | ---: |',
        ]
        for record in records:
            s=record['summary']
            lines.append(f"| {record['label']} | `{record['version']}` | {s['binary_bytes']['median']/2**20:.2f} | {s['build_s']['median']:.2f} | {s['request_us']['median']:.2f} | {s['rss_mib']['median']:.2f} |")
        lines+=['','## Workload','',
            'A small program creates a client, sends a non-streaming user message (`Say hello.`) with a 32-token output limit, receives a recorded response, and checks that the returned text is exactly `Hello.`. The response reports three input tokens and two output tokens. Each SDK uses its public client API; no custom serialization replaces its normal request path.','',
            f"Each fresh process performs **20 warmup requests**, then **{data['iterations']} timed requests**. Its sample is the average time per completed request in that timed block. The chart shows the median of those process averages—not a single-request percentile.",'',
            'The fixture server checks the prompt, output limit, non-streaming mode, and total request count. A failed build, wrong response, failed request, or wrong CPU assignment stops publication rather than silently excluding that SDK.','',
            '### What “Local request” means','',
            'A private Python HTTP server returns fixed, provider-shaped JSON over loopback. It and the client share the assigned single CPU. Timing includes the SDK’s encoding, local HTTP transport, fixture handling, response parsing, and text extraction. It is **not pure serialization time**, and it does not measure model generation or internet latency. Client construction, fixture setup, warmup, and process shutdown are outside the timed block.','',
            'Every probe has its own Linux network namespace, with only loopback enabled. No provider endpoints are reachable. Credentials are dummy strings, HOME is temporary, and inherited API keys are not passed to clients.','',
        ]
        if language=='rust':
            lines+=['All four Rust clients use OpenAI-compatible Chat Completions. Rig uses its completion-model API, not an agent loop. genai uses an explicit OpenAI model target. The default native client features are retained; `async-openai` additionally enables its required `chat-completion` feature.','',
                f"LM15 is built from [Rust commit `{data['sources']['rust']['commit'][:12]}`](https://github.com/lm15-dev/lm15-rs/tree/{data['sources']['rust']['commit']}).",'']
        else:
            lines+=['OpenAI and LM15 use Chat Completions; Anthropic uses Messages; Google uses Generate Content. Their wire formats differ, but the prompt, output limit, and returned text are equivalent. Each response uses that provider’s normal JSON shape.','',
                '**LM15 Go is an unreleased working-tree snapshot**, not the old Git commit or a published release. No changes were committed to the Go SDK repository for this benchmark. The exact snapshot is retained on the build server; its archive hash and per-file hashes are recorded in the raw results. The unfinished SDK source is not redistributed with the website.', '',
                f"Go snapshot SHA-256: `{data['sources']['go']['archive_sha256']}`. Base commit (not the measured source): `{data['sources']['go']['base_commit']}`.",'']
        lines+=['## Build and memory rules','',
            'Program size includes the linked SDK, runtime, and small timer/reporting scaffold. It does **not** include the external Python fixture server. Programs contain the same logical task, but unused code removal and native feature coverage differ between SDKs.','']
        if language=='rust':
            lines+=['Rust builds use the release profile with `opt-level=3`, `codegen-units=1`, no LTO, no debug information, and stripped symbols. Every measured build has a new empty target directory and runs `cargo build --release --locked --offline --jobs 1`. The installed Rust standard library is not rebuilt. All Rust work is initiated through `rcargo run` on the build-server coordinator.','']
        else:
            lines+=['Go builds use `CGO_ENABLED=0`, `GOMAXPROCS=1`, `-p=1`, `-trimpath`, `-buildvcs=false`, and `-ldflags="-s -w"`. Each measured build has a fresh `GOCACHE`, including fresh compilation of standard-library packages. Module downloads are already cached.','']
        lines+=['Each build and every child compiler inherits one-CPU affinity from `taskset`. Runtime clients also report their CPU affinity, which is verified. Dependency downloads, tool installation, and unmeasured harness validation happen before measurement. Clean builds have no compiled-output cache; shared filesystem caches are not flushed.','',
            'Memory is the client’s `/proc/self/status` resident memory after all requests. It includes its runtime and retained allocations. Garbage collection is not forced, and this is not peak memory or a heap-only measurement. The Python fixture process is excluded from the memory value.','',
            'Workers share caches, memory bandwidth, storage, and server power budgets. Frequencies are not fixed. These results describe concurrent single-core work, not a perfectly idle isolated core. Libraries with broader features are not necessarily interchangeable; smaller size does not establish equal coverage or correctness.','',
            '## Variation','',
            'Intervals cover the middle 50% of observations (25th–75th percentiles), not confidence intervals. Error bars are intentionally omitted on the homepage.','',
            '| Library | Build s, middle 50% | Local request µs, middle 50% | Memory MiB, middle 50% |',
            '| --- | ---: | ---: | ---: |',
        ]
        for record in records:
            s=record['summary']; line=f"| {record['label']}"
            for key in ['build_s','request_us','rss_mib']: line+=f" | {s[key]['p25']:.2f}–{s[key]['p75']:.2f}"
            lines.append(line+' |')
        lines+=['','## Comparator sources','']
        for record in records: lines.append(f"- [{record['label']}]({record['source']}) — `{record['version']}`")
        lines+=['','## Evidence and reproduction','',
            f'- [All measurements and source fingerprints]({url}/results.json)',
            f'- [Benchmark coordinator]({url}/runner.py)',
            f'- [Client-case definitions]({url}/cases.py)',
            f'- [Fixture server and validation]({url}/probe.py)',
        ]
        for record in records:
            base=f"{url}/harnesses/{language}/{record['id']}"
            if language=='rust': links=f'[source]({base}/src/main.rs) · [manifest]({base}/Cargo.toml) · [lockfile]({base}/Cargo.lock)'
            else: links=f'[source]({base}/main.go) · [module]({base}/go.mod)'
            lines.append(f"- {record['label']}: {links}")
        lm15_row=('Reproducing the LM15 Go row requires the retained working-tree snapshot; checking out its base commit is not equivalent.'
                  if language=='go' else 'The LM15 row is built from the Rust commit linked above.')
        lines+=['','Run the coordinator through `rcargo run` from `website/benchmarks/native/`. Use a fresh server work directory and the exact input snapshots recorded with the run. See the repository’s `benchmarks/native/README.md` for the workflow. '+lm15_row,'']
        report=ROOT/f'src/content/docs/docs/benchmarks/{language}.md'; report.parent.mkdir(parents=True,exist_ok=True); report.write_text('\n'.join(lines))
    text="// Measured server data. Regenerate with scripts/publish-native-benchmarks.py.\nimport type { BenchmarkSuite } from './benchmarks';\n\n"
    for language,suite in suites.items(): text+=f'export const {language.upper()}_BENCHMARKS = '+json.dumps(suite,indent=2,ensure_ascii=False)+' satisfies BenchmarkSuite;\n\n'
    (ROOT/'src/data/native-benchmarks.ts').write_text(text)
    print('Generated Rust and Go chart data and reports.')

if __name__=='__main__': main()
