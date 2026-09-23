/**
 * Explicit check, not part of `npm test` (it needs every language's toolchain):
 * run the docs' examples, as shown, in every language.
 *
 *   npm run test:docs-examples
 *   LM15_DOCS_LANGUAGES=python,go npm run test:docs-examples
 *
 * Each program is the page's code with one change: the model is
 * `ollama:test-model`, which every SDK sends to 127.0.0.1:11434. There, a
 * stand-in server (scripts/docs-fixture-server.py) answers "Probably wood mice."
 * and records the request. Programs run in a network namespace with no route
 * out, so nothing reaches a real provider and no key is needed.
 *
 * Checked: every program runs and prints the answer, and every language sends
 * the same request body as Python for the same program.
 *
 * SDKs: Python from the wheel and TypeScript from the build the website pins
 * (node_modules/lm15); Rust and Go at the commits pinned in
 * node_modules/lm15/runtime/sources.json, extracted from the sibling checkouts'
 * history (LM15_RS_DIR, LM15_GO_DIR) whatever they have checked out;
 * R and Julia from their checkouts (LM15_R_DIR, LM15_JL_DIR) through Nix.
 * R runs with its real router but its fake transport: its curl transport fails
 * in its own dev shell (`headerfunction` unsupported), a bug to fix in lm15-r.
 * Its requests are checked all the same, from what the fake transport recorded.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { exampleSource, LANGUAGES, type Language } from '../src/components/home-example/examples.ts';
import { TOUR, tourPrograms, type TourProgram } from '../src/data/tour-examples.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE = join(ROOT, 'scripts/docs-fixture-server.py');
const CACHE = join(homedir(), '.cache/lm15-docs-examples');
const REPLY = 'Probably wood mice.';
const sdk = (variable: string, name: string) => resolve(process.env[variable] ?? join(ROOT, '..', name));
const pins = JSON.parse(readFileSync(join(ROOT, 'node_modules/lm15/runtime/sources.json'), 'utf8')) as Record<string, string>;
const wanted = new Set((process.env['LM15_DOCS_LANGUAGES'] ?? LANGUAGES.map(l => l.id).join(',')).split(','));

type Program = TourProgram;
/** Everything the docs run: the first request, and the Overview's tour. */
function programs(language: Language): Program[] {
  return [{ name: 'first-request', source: exampleSource(language, 'ollama', 'test-model'), streams: false }, ...tourPrograms(language, 'ollama', 'test-model')];
}

/** Run `command` beside the stand-in server, in a namespace with only loopback. Returns stdout and the request bodies it received. */
function sealed(command: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): { stdout: string; bodies: unknown[] } {
  const log = join(mkdtempSync(join(tmpdir(), 'lm15-docs-log-')), 'requests.jsonl');
  const script = 'ip link set lo up; python3 "$0" "$1" & P=$!; for i in $(seq 50); do (echo > /dev/tcp/127.0.0.1/11434) 2>/dev/null && break; sleep 0.1; done; shift; "$@"; R=$?; kill $P; exit $R';
  const run = spawnSync('unshare', ['-rn', 'bash', '-c', script, FIXTURE, log, ...command], { cwd, env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, `${command.join(' ')} failed:\n${run.stdout}\n${run.stderr}`);
  const bodies = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  return { stdout: run.stdout, bodies };
}

const have = (tool: string) => spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0;
const results = new Map<Language, Map<string, unknown[]>>();

function record(language: Language, p: Program, stdout: string, bodies: unknown[]): void {
  const name = p.name, requests = p.requests ?? 1;
  for (const expected of p.expect ?? [REPLY]) assert.ok(stdout.includes(expected), `${language} ${name}: "${expected}" was not printed:\n${stdout}`);
  assert.equal(bodies.length, requests, `${language} ${name}: expected ${requests} request(s), saw ${bodies.length}`);
  if (!results.has(language)) results.set(language, new Map());
  results.get(language)!.set(name, bodies);
}

/** The SDK at the commit the website pins, extracted from the checkout's history into the cache (once per commit). */
function pinned(language: string, checkout: string, pin: string | undefined): string {
  assert.ok(pin, `${language}: no pinned commit in sources.json`);
  const dir = join(CACHE, `${language}-sdk-${pin.slice(0, 12)}`);
  if (!existsSync(join(dir, '.complete'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('sh', ['-c', `git -C "$0" archive "$1" | tar -x -C "$2"`, checkout, pin, dir]);
    writeFileSync(join(dir, '.complete'), pin + '\n');
  }
  return dir;
}

const runners: Record<Language, (t: import('node:test').TestContext) => void> = {
  python(t) {
    if (!have('python3')) return t.skip('python3 not found');
    const wheel = readdirSync(join(ROOT, 'node_modules/lm15/runtime')).find(name => name.endsWith('.whl'));
    assert.ok(wheel, 'the pinned Python wheel');
    const dir = mkdtempSync(join(tmpdir(), 'lm15-docs-py-'));
    execFileSync('python3', ['-m', 'zipfile', '-e', join(ROOT, 'node_modules/lm15/runtime', wheel), join(dir, 'site')]);
    for (const p of programs('python')) {
      writeFileSync(join(dir, `${p.name}.py`), p.source + '\n');
      const out = sealed(['python3', `${p.name}.py`], dir, { ...process.env, PYTHONPATH: join(dir, 'site') });
      record('python', p, out.stdout, out.bodies);
    }
  },
  typescript() {
    // Inside the website, so `import "lm15"` resolves to the pinned build.
    const dir = mkdtempSync(join(ROOT, '.docs-run-'));
    try {
      const list = programs('typescript');
      for (const p of list) writeFileSync(join(dir, `${p.name}.ts`), p.source + '\n');
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext', strict: true, noEmit: true, skipLibCheck: true, types: ['node'] }, files: list.map(p => `${p.name}.ts`) }));
      execFileSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(dir, 'tsconfig.json')], { stdio: 'pipe' });
      for (const p of list) {
        const out = sealed([process.execPath, '--experimental-strip-types', '--no-warnings', `${p.name}.ts`], dir);
        record('typescript', p, out.stdout, out.bodies);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
  rust(t) {
    if (!have('rcargo') && !have('cargo')) return t.skip('neither rcargo nor cargo found');
    const lm15 = pinned('rust', sdk('LM15_RS_DIR', 'lm15-rs'), pins['rust']);
    const dir = join(CACHE, 'rust');
    mkdirSync(join(dir, 'src/bin'), { recursive: true });
    for (const name of readdirSync(join(dir, 'src/bin'))) rmSync(join(dir, 'src/bin', name));
    writeFileSync(join(dir, 'Cargo.toml'), `[package]\nname = "docs-examples"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[dependencies]\nlm15 = { path = ${JSON.stringify(lm15)} }\ntokio = { version = "1", features = ["macros", "rt-multi-thread"] }\nfutures-util = "0.3"\nserde_json = "1"\n`);
    const list = programs('rust');
    for (const p of list) writeFileSync(join(dir, 'src/bin', `${p.name.replace(/-/g, '_')}.rs`), p.source + '\n');
    execFileSync(have('rcargo') ? 'rcargo' : 'cargo', ['build', '--release', '--quiet'], { cwd: dir, stdio: 'pipe', timeout: 1_200_000 });
    for (const p of list) {
      const out = sealed([join(dir, 'target/release', p.name.replace(/-/g, '_'))], dir);
      record('rust', p, out.stdout, out.bodies);
    }
  },
  go(t) {
    if (!have('go')) return t.skip('go not found');
    const lm15 = pinned('go', sdk('LM15_GO_DIR', 'lm15-go'), pins['go']);
    const dir = mkdtempSync(join(tmpdir(), 'lm15-docs-go-'));
    writeFileSync(join(dir, 'go.mod'), `module example.test/docs\n\ngo 1.26\n\nrequire github.com/lm15-dev/lm15-go v0.0.0\nreplace github.com/lm15-dev/lm15-go => ${lm15}\n`);
    for (const p of programs('go')) {
      mkdirSync(join(dir, p.name));
      writeFileSync(join(dir, p.name, 'main.go'), p.source + '\n');
      execFileSync('go', ['build', '-mod=mod', '-o', join(dir, `${p.name}.bin`), `./${p.name}`], { cwd: dir, stdio: 'pipe', timeout: 300_000 });
      const out = sealed([join(dir, `${p.name}.bin`)], dir);
      record('go', p, out.stdout, out.bodies);
    }
  },
  r(t) {
    if (!have('nix')) return t.skip('nix not found');
    const lm15 = sdk('LM15_R_DIR', 'lm15-r');
    const lib = join(CACHE, 'r-lib');
    mkdirSync(lib, { recursive: true });
    const nix = (script: string) => execFileSync('nix', ['develop', lm15, '-c', 'bash', '-c', script], { cwd: lm15, encoding: 'utf8', timeout: 1_500_000 });
    nix(`R CMD INSTALL --no-test-load --library=${JSON.stringify(lib)} . > /dev/null 2>&1`);
    const dir = mkdtempSync(join(tmpdir(), 'lm15-docs-r-'));
    const replies = `
.docs_reply <- '{"id":"chatcmpl-docs","object":"chat.completion","created":0,"model":"test-model","choices":[{"index":0,"message":{"role":"assistant","content":"${REPLY}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}'
.docs_call <- '{"id":"chatcmpl-docs","object":"chat.completion","created":0,"model":"test-model","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_docs_1","type":"function","function":{"name":"search_sightings","arguments":"{\\\\"query\\\\": \\\\"oak grove\\\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}'
.docs_structured <- jsonlite::toJSON(list(id = "chatcmpl-docs", object = "chat.completion", created = 0L, model = "test-model", choices = list(list(index = 0L, message = list(role = "assistant", content = ${JSON.stringify(JSON.stringify(TOUR.extract.fixtureAnswer))}), finish_reason = "stop")), usage = list(prompt_tokens = 12L, completion_tokens = 5L, total_tokens = 17L)), auto_unbox = TRUE)
.docs_chunk <- function(delta, finish = "null", extra = "") paste0('data: {"id":"chatcmpl-docs","object":"chat.completion.chunk","created":0,"model":"test-model","choices":', delta, extra, '}\\n\\n')
.docs_sse <- c(
  .docs_chunk('[{"index":0,"delta":{"role":"assistant","content":"Probably "},"finish_reason":null}]'),
  .docs_chunk('[{"index":0,"delta":{"content":"wood "},"finish_reason":null}]'),
  .docs_chunk('[{"index":0,"delta":{"content":"mice."},"finish_reason":null}]'),
  .docs_chunk('[{"index":0,"delta":{},"finish_reason":"stop"}]'),
  .docs_chunk('[]', extra = ',"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}'),
  "data: [DONE]\\n\\n")`;
    for (const p of programs('r')) {
      const reply = p.streams
        ? 'list(status = 200L, headers = list(`content-type` = "text/event-stream"), chunks = as.list(.docs_sse))'
        : 'list(status = 200L, headers = list(`content-type` = "application/json"), body = .docs_reply)';
      // The page's code, with only the router's transport swapped; the recorded request goes to a file.
      const source = p.source.replace('new_router()', 'new_router(transport = .docs_transport)');
      assert.notEqual(source, p.source, `r ${p.name}: no router to give the fake transport`);
      writeFileSync(join(dir, `${p.name}.R`), source + '\n');
      const call = 'list(status = 200L, headers = list(`content-type` = "application/json"), body = .docs_call)';
      const answer = p.structured ? 'list(status = 200L, headers = list(`content-type` = "application/json"), body = .docs_structured)' : reply;
      const replyList = [...(p.toolCall ? [call] : []), ...Array((p.requests ?? 1) - (p.toolCall ? 1 : 0)).fill(answer)].join(', ');
      writeFileSync(join(dir, `run-${p.name}.R`), `${replies}\n.docs_transport <- lm15::fake_transport(list(${replyList}))\nsource(${JSON.stringify(join(dir, `${p.name}.R`))}, print.eval = TRUE)\nfor (w in attr(.docs_transport, "requests")()) cat(rawToChar(w$body), "\\n", file = ${JSON.stringify(join(dir, `${p.name}.jsonl`))}, append = TRUE, sep = "")\n`);
      const stdout = nix(`R_LIBS=${JSON.stringify(lib)} Rscript --no-save ${JSON.stringify(join(dir, `run-${p.name}.R`))} 2>/dev/null`);
      const bodies = readFileSync(join(dir, `${p.name}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      record('r', p, stdout, bodies);
    }
  },
  julia(t) {
    if (!have('nix')) return t.skip('nix not found');
    const lm15 = sdk('LM15_JL_DIR', 'lm15-jl');
    const project = join(CACHE, 'julia');
    mkdirSync(project, { recursive: true });
    const julia = (args: string[]) => ['nix', 'shell', 'nixpkgs#julia-bin', '-c', 'julia', `--project=${project}`, ...args];
    const [cmd, ...args] = julia(['-e', `using Pkg; Pkg.develop(path=${JSON.stringify(lm15)}); Pkg.instantiate(); using LM15`]);
    execFileSync(cmd!, args, { stdio: 'pipe', timeout: 1_500_000 });
    const dir = mkdtempSync(join(tmpdir(), 'lm15-docs-jl-'));
    for (const p of programs('julia')) {
      writeFileSync(join(dir, `${p.name}.jl`), p.source + '\n');
      // Nix resolves julia outside the namespace; the program runs inside it.
      const bin = execFileSync('nix', ['shell', 'nixpkgs#julia-bin', '-c', 'sh', '-c', 'command -v julia'], { encoding: 'utf8' }).trim();
      const out = sealed([bin, `--project=${project}`, `${p.name}.jl`], dir);
      record('julia', p, out.stdout, out.bodies);
    }
  },
};

for (const { id } of LANGUAGES) {
  test(`docs examples run in ${id}`, { timeout: 2_400_000, skip: !wanted.has(id) && 'not in LM15_DOCS_LANGUAGES' }, t => runners[id](t));
}

/**
 * A tool result is the program's own JSON: each language's encoder spaces and
 * orders keys its own way (Python `", "`, Go sorted keys), and LM15 sends it
 * verbatim. Tool results are compared as data; everything else byte for byte.
 */
function withToolResultsAsData(bodies: unknown[]): unknown[] {
  return (bodies as { messages?: { role: string; content?: unknown }[] }[]).map(body => ({
    ...body,
    messages: body.messages?.map(m => {
      if (m.role !== 'tool' || typeof m.content !== 'string') return m;
      try { return { ...m, content: JSON.parse(m.content) }; } catch { return m; }
    }),
  }));
}

test('every language sends the same request as Python', t => {
  const reference = results.get('python');
  if (!reference) return t.skip('Python did not run');
  for (const [language, bodies] of results) {
    for (const [name, sent] of bodies) assert.deepEqual(withToolResultsAsData(sent), withToolResultsAsData(reference.get(name)!), `${language} ${name}`);
  }
});
