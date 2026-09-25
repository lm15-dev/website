/**
 * Judge mode's code panel is executable documentation, like the chat's
 * (provider_examples.test.ts). For every provider, in each state shape:
 *
 * - the JavaScript text type-checks against the built package, runs,
 *   sends one request, and it is the page's own request;
 * - the Python text runs under Pyodide and builds the same bytes as
 *   JavaScript;
 * - Rust builds each canonical request and parses the actual prepared reply;
 *   Rust and Go displayed source use their real SDK complete methods.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { choice, score, utf8Decode, yesNo } from "@lm15/lm15/browser";
import { CONNECTIONS } from "../src/playground/connections.ts";
import { EXAMPLE_API_KEY, createClient, keyless, type Connection } from "../src/playground/experience.ts";
import { EXAMPLE_NOTE, EXAMPLE_SPEC, judgeGo, judgeJavascript, judgePython, judgeRequest, judgeRust, verdictOf, type JudgeSpec, type StateValue } from "../src/playground/judge.ts";
import { judgeProgram, withKey } from "../src/playground/runtimes/python.ts";
import { RustCodec } from "../src/playground/runtimes/rust.ts";
import { readFileSync } from "node:fs";
import { Request as RequestNs, Response as CanonicalResponse } from "@lm15/lm15/browser";
// Browser examples must use FetchTransport: lm15/node installs a native transport
// that bypasses mocked global fetch. Fail closed before constructing any clients.
globalThis.fetch = async () => { throw new Error("Unintercepted network in Judge example test"); };
import { ensureWheel, ensureRustWasm } from "./support/runtimes.ts";
import { JUDGED_TEXT, judgeReplyFor } from "./support/replies.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The example's question plus two more (the prepared replies answer all three), over a state of each shape. */
const THREE: JudgeSpec = { ...EXAMPLE_SPEC, properties: { quality: score("How good is this wine, according to the note?", { faulty: "Faulty or unpleasant", simple: "Simple and sound", good: "Good, well made", excellent: "Excellent, complex and structured", profound: "Profound, exceptional" }), style: choice("What is the dominant style described?", { fruit: "Fruit-forward", oak: "Oak-driven", mineral: "Mineral, savoury" }), ageing: yesNo("Does the note say the wine will improve with age?") } };
const SHAPES: Array<{ spec: JudgeSpec; value: StateValue }> = [
  { spec: THREE, value: EXAMPLE_NOTE },
  { spec: THREE, value: 'Quotes " and a newline\n</script> are text, not executable code.' },
  { spec: { ...THREE, shape: "fields" }, value: { note: EXAMPLE_NOTE, price_eur: 48, tags: null } },
  { spec: { ...THREE, shape: "conversation" }, value: [{ role: "user", content: "Something for ten years?" }, { role: "assistant", content: `The 2019 Pauillac: ${EXAMPLE_NOTE}` }] },
];
const cases = CONNECTIONS.flatMap((choice) => SHAPES.map(({ spec, value }) => ({
  spec, value,
  connection: { provider: choice.id, model: choice.model || "custom-model", endpoint: "http://localhost:1234/v1" } satisfies Connection,
  key: keyless(choice.id) ? "unused" : EXAMPLE_API_KEY,
})));
const wheel = ensureWheel();

/** The page's request for the state, and its bytes through the JavaScript runtime's client. */
async function expected(c: (typeof cases)[number], value: StateValue) {
  const request = judgeRequest(c.connection, c.spec, value);
  const built = await createClient(c.connection, c.key).buildRequest(request, false);
  return { request, method: built.method, url: built.url, body: utf8Decode(built.body), headers: Object.fromEntries(built.headers.map(([k, v]) => [k.toLowerCase(), v])) };
}

test(`JavaScript: all ${cases.length} judge variants type-check, execute one call, and the call is the page's request`, { timeout: 120_000 }, async (t) => {
  assert.equal(cases.length, CONNECTIONS.length * 4);
  const sources = cases.map((c) => judgeJavascript(c.connection, c.spec, c.value).text);
  const files = new Map(sources.map((source, i) => [resolve(root, `src/playground/__judge_${i}.ts`), source]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ["lib.es2023.d.ts", "lib.dom.d.ts"] };
  const host = ts.createCompilerHost(options);
  const [read, exists, source] = [host.readFile, host.fileExists, host.getSourceFile];
  host.readFile = (f) => files.get(f) ?? read(f);
  host.fileExists = (f) => files.has(f) || exists(f);
  host.getSourceFile = (f, l, e, fresh) => (files.has(f) ? ts.createSourceFile(f, files.get(f)!, ts.ScriptTarget.ES2023, true) : source(f, l, e, fresh));
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([...files.keys()], options, host));
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => "\n" }));

  let calls: Array<{ url: string; body: string }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: new TextDecoder().decode(init.body as Uint8Array<ArrayBuffer>) });
    return judgeReplyFor(url, Object.keys(THREE.properties));
  });
  t.mock.method(console, "log", () => {});
  const entry = import.meta.resolve("@lm15/lm15/browser");
  for (const [i, c] of cases.entries()) {
    calls = [];
    const url = `data:text/javascript,${encodeURIComponent(`// variant ${i}\n` + sources[i]!.replace('"@lm15/lm15/browser"', JSON.stringify(entry)))}`;
    await import(url);
    assert.equal(calls.length, 1, `${c.connection.provider} ${c.spec.shape}: one request`);
    const want = await expected(c, c.value);
    assert.equal(calls[0]!.url, want.url);
    assert.equal(calls[0]!.body, want.body, `${c.connection.provider} ${c.spec.shape}: the JavaScript text and the page build the same bytes`);
  }
});

test(`Python under Pyodide: all ${cases.length} judge variants execute the program the page runs and build the same bytes as JavaScript`, { timeout: 600_000 }, async () => {
  const { loadPyodide } = await import("pyodide");
  let calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  (globalThis as { fetch: typeof fetch }).fetch = async (url, init) => {
    calls.push({ url: String(url), body: new TextDecoder().decode(init?.body as Uint8Array), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return judgeReplyFor(String(url), Object.keys(THREE.properties));
  };
  const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
  await py.loadPackage(pathToFileURL((wheel as { path: string }).path).href, { messageCallback: () => {} });
  for (const c of cases) {
    // The shown program, whole: it runs, one call.
    const shown = withKey(judgePython(c.connection, c.spec, c.value).text, c.key, c.connection);
    calls = [];
    try { await py.runPythonAsync(shown); }
    catch (e) { assert.fail(`${c.connection.provider} ${c.spec.shape}: the Python text failed under Pyodide:\n${String((e as Error).message).split("\n").slice(-6).join("\n")}\n---\n${shown}`); }
    assert.equal(calls.length, 1, `${c.connection.provider} ${c.spec.shape}: one request`);
    const want = await expected(c, c.value);
    assert.equal(calls[0]!.url, want.url, c.connection.provider);
    assert.equal(calls[0]!.body, want.body, `${c.connection.provider} ${c.spec.shape}: Python and JavaScript build the same bytes`);
    assert.deepEqual(Object.fromEntries(Object.entries(calls[0]!.headers).filter(([key]) => key !== "accept-encoding")), want.headers, `${c.connection.provider}: the same provider headers (Python transport adds Accept-Encoding: identity)`);
    // The program the page executes: the same bytes, and a Response the page can read.
    calls = [];
    const out = String(await py.runPythonAsync(withKey(judgeProgram(c.connection, want.request, { spec: c.spec, value: c.value }), c.key, c.connection)));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body, want.body, `${c.connection.provider} ${c.spec.shape}: the executed program builds the page's bytes`);
    const { Response } = await import("@lm15/lm15/browser");
    const verdict = verdictOf(Response.fromJSON(JSON.parse(out)), { ms: 0, provider: c.connection.provider, model: c.connection.model, runtime: "Python" });
    assert.deepEqual(verdict.data, JSON.parse(JUDGED_TEXT), `${c.connection.provider}: the pick comes back through Python`);
    if (c.connection.provider === "typesafe") assert.equal(verdict.method, "provider_classification");
    // A chat wire records what it could not take: the probabilities, or — Z.AI, whose wire has no json_schema — the response format itself, in which case the questions never reached the model.
    else assert.ok(verdict.adaptations.some((a) => (a.field === "config.probabilities" || a.field === "config.response_format") && a.action === "dropped"), `${c.connection.provider}: the dropped probabilities or format are recorded`);
  }
});

test("on Jev the wire is the docs' request: the state verbatim, a transcript as the caller's messages array; on a chat wire the same set is a data part as JSON text", async () => {
  const typesafe: Connection = { provider: "typesafe", model: "jev-latest", endpoint: "" };
  const state = async (spec: JudgeSpec, value: StateValue) => (JSON.parse(utf8Decode((await createClient(typesafe, "k").buildRequest(judgeRequest(typesafe, spec, value), false)).body)) as { state: unknown; questions: Record<string, unknown> });
  // The default: the docs' quick start, a string and the questions.
  assert.equal((await state(EXAMPLE_SPEC, "A note.")).state, "A note.");
  const fields: JudgeSpec = { ...EXAMPLE_SPEC, shape: "fields" };
  assert.deepEqual((await state(fields, { note: "A note.", price_eur: 48 })).state, { note: "A note.", price_eur: 48 });
  const turns: StateValue = [{ role: "user", content: "Red?" }, { role: "assistant", content: "This one." }];
  assert.deepEqual((await state({ ...EXAMPLE_SPEC, shape: "conversation" }, turns)).state, { messages: [{ role: "user", content: "Red?" }, { role: "assistant", content: "This one." }] });
  // The code says the same: no system= anywhere (there is no instructions box), the state written out.
  assert.match(judgeJavascript(typesafe, EXAMPLE_SPEC, "A note.").text, /messages: \[Message\.user\(state\)\],/, "the default code is the quick start: the text is the state");
  assert.doesNotMatch(judgeJavascript(typesafe, EXAMPLE_SPEC, "A note.").text, /system:/);
  assert.match(judgePython(typesafe, fields, { note: "n", price_eur: 1 }).text, /Message\.user\(data\(state\)\)/);
  assert.match(judgePython(typesafe, { ...EXAMPLE_SPEC, shape: "conversation" }, turns).text, /\{"role": "user", "content": "Red\?"\},\n\s+\{"role": "assistant", "content": "This one\."\},/, "a Jev transcript is plain objects, one turn per line, not Message.user calls");
  assert.match(judgePython(typesafe, { ...EXAMPLE_SPEC, shape: "conversation" }, turns).text, /Message\.user\(data\(\{"messages": state\}\)\)/);
  const openai: Connection = { provider: "openai", model: "gpt-4.1-mini", endpoint: "" };
  assert.doesNotMatch(judgeJavascript(openai, EXAMPLE_SPEC, "A note.").text, /system:/);
  assert.match(judgeJavascript(openai, { ...EXAMPLE_SPEC, shape: "conversation" }, turns).text, /Message\.user\("Red\?"\),\n  Message\.assistant\("This one\."\),/);
  const chatBody = JSON.parse(utf8Decode((await createClient(openai, "k").buildRequest(judgeRequest(openai, fields, { note: "A note.", price_eur: 48 }), false)).body)) as { input: Array<{ content: Array<{ text: string }> }> };
  assert.equal(chatBody.input[0]!.content[0]!.text, '{"note":"A note.","price_eur":48}', "D3: a data part is its compact JSON on a text wire");
});

test("Rust: Judge builds and parses prepared replies for every provider and shape", async () => {
  const rust = await RustCodec.load(readFileSync(ensureRustWasm().path));
  for (const c of cases) {
    const want = await expected(c, c.value);
    const conn = { provider: c.connection.provider === "custom" ? "openai-chat" : c.connection.provider, apiKey: c.key, ...(c.connection.provider === "custom" ? { baseUrl: c.connection.endpoint } : {}) };
    const canonical = RequestNs.toJSON(want.request);
    const built = rust.buildRequest(conn, canonical, false);
    assert.deepEqual(built.body, JSON.parse(want.body), `${c.connection.provider} ${c.spec.shape}`);
    const reply = judgeReplyFor(want.url, Object.keys(THREE.properties));
    const parsed = rust.parseResponse(conn, canonical, reply.status, await reply.text(), [...reply.headers], true);
    const response = CanonicalResponse.fromJSON(parsed.canonical_response as Parameters<typeof CanonicalResponse.fromJSON>[0]);
    assert.deepEqual(verdictOf(response, { ms: 0, provider: c.connection.provider, model: c.connection.model, runtime: "Rust" }).data, JSON.parse(JUDGED_TEXT));
    assert.ok(judgeRust(c.connection, c.spec, c.value).text.includes("lm.complete(&request).await?"));
    assert.ok(judgeGo(c.connection, c.spec, c.value).text.includes("lm.Complete(ctx, request)"));
  }
});
