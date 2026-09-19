/**
 * Judge mode's code panel is executable documentation, like the chat's
 * (provider_examples.test.ts). For every provider, in each input shape:
 *
 * - the JavaScript text type-checks against the built package, runs,
 *   sends one request per input, and each is the page's own request;
 * - the Python text runs under Pyodide and builds the same bytes as
 *   JavaScript for the input the page would execute it with;
 * - the Rust tab says the pin has no judgments, and the Rust runtime
 *   refuses to judge rather than translate.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { utf8Decode } from "lm15/browser";
import { CONNECTIONS } from "../src/playground/connections.ts";
import { EXAMPLE_API_KEY, RUST_NOT_YET, createClient, keyless, type Connection } from "../src/playground/experience.ts";
import { EXAMPLE_INPUTS, EXAMPLE_INSTRUCTIONS, EXAMPLE_SPEC, judgeJavascript, judgePython, judgeRequest, judgeRust, verdictOf, type InputValue, type JudgeSpec } from "../src/playground/judge.ts";
import { judgeProgram, withKey } from "../src/playground/runtimes/python.ts";
import { rustRuntime } from "../src/playground/runtimes/rust.ts";
import "lm15/node";
import { ensureWheel } from "./support/runtimes.ts";
import { JUDGED_TEXT, judgeReplyFor } from "./support/replies.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The default set (no instructions: the docs' vanilla request), and the same three shapes with instructions added. */
const WITH: JudgeSpec = { ...EXAMPLE_SPEC, instructions: EXAMPLE_INSTRUCTIONS };
const SHAPES: Array<{ spec: JudgeSpec; inputs: InputValue[] }> = [
  { spec: EXAMPLE_SPEC, inputs: [EXAMPLE_INPUTS[0]!, 'Quotes " and a newline\n</script> are text, not executable code.'] },
  { spec: { ...WITH, shape: "fields", fields: [{ name: "note", type: "text" }, { name: "price_eur", type: "number" }] }, inputs: [{ note: EXAMPLE_INPUTS[0]!, price_eur: 48 }, { note: "Thin.", price_eur: null }] },
  { spec: { ...WITH, shape: "conversation" }, inputs: [[{ role: "user", content: "Something for ten years?" }, { role: "assistant", content: `The 2019 Pauillac: ${EXAMPLE_INPUTS[0]}` }]] },
  { spec: WITH, inputs: ["A note, with instructions."] },
];
const cases = CONNECTIONS.flatMap((choice) => SHAPES.map(({ spec, inputs }) => ({
  spec, inputs,
  connection: { provider: choice.id, model: choice.model || "custom-model", endpoint: "http://localhost:1234/v1" } satisfies Connection,
  key: keyless(choice.id) ? "unused" : EXAMPLE_API_KEY,
})));
const wheel = ensureWheel();

/** The page's request for one input, and its bytes through the JavaScript runtime's client. */
async function expected(c: (typeof cases)[number], value: InputValue) {
  const request = judgeRequest(c.connection, c.spec, value);
  const built = await createClient(c.connection, c.key).buildRequest(request, false);
  return { request, method: built.method, url: built.url, body: utf8Decode(built.body), headers: Object.fromEntries(built.headers.map(([k, v]) => [k.toLowerCase(), v])) };
}

test(`JavaScript: all ${cases.length} judge variants type-check, execute one call per input, and each call is the page's request`, { timeout: 120_000 }, async (t) => {
  assert.equal(cases.length, CONNECTIONS.length * 4);
  const sources = cases.map((c) => judgeJavascript(c.connection, c.spec, c.inputs));
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
    return judgeReplyFor(url);
  });
  t.mock.method(console, "log", () => {});
  const entry = import.meta.resolve("lm15/browser");
  for (const [i, c] of cases.entries()) {
    calls = [];
    const url = `data:text/javascript,${encodeURIComponent(`// variant ${i}\n` + sources[i]!.replace('"lm15/browser"', JSON.stringify(entry)))}`;
    await import(url);
    assert.equal(calls.length, c.inputs.length, `${c.connection.provider} ${c.spec.shape}: one request per input`);
    for (const [k, value] of c.inputs.entries()) {
      const want = await expected(c, value);
      assert.equal(calls[k]!.url, want.url);
      assert.equal(calls[k]!.body, want.body, `${c.connection.provider} ${c.spec.shape} input ${k}: the JavaScript text and the page build the same bytes`);
    }
  }
});

test(`Python under Pyodide: all ${cases.length} judge variants execute the program the page runs and build the same bytes as JavaScript`, { timeout: 600_000 }, async () => {
  const { loadPyodide } = await import("pyodide");
  let calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  (globalThis as { fetch: typeof fetch }).fetch = async (url, init) => {
    calls.push({ url: String(url), body: new TextDecoder().decode(init?.body as Uint8Array), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return judgeReplyFor(String(url));
  };
  const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
  await py.loadPackage(pathToFileURL((wheel as { path: string }).path).href, { messageCallback: () => {} });
  for (const c of cases) {
    // The shown program, whole: it runs (every input, in a loop).
    const shown = withKey(judgePython(c.connection, c.spec, c.inputs), c.key, c.connection);
    calls = [];
    try { await py.runPythonAsync(shown); }
    catch (e) { assert.fail(`${c.connection.provider} ${c.spec.shape}: the Python text failed under Pyodide:\n${String((e as Error).message).split("\n").slice(-6).join("\n")}\n---\n${shown}`); }
    assert.equal(calls.length, c.inputs.length, `${c.connection.provider} ${c.spec.shape}: one request per input`);
    for (const [k, value] of c.inputs.entries()) {
      const want = await expected(c, value);
      assert.equal(calls[k]!.url, want.url, c.connection.provider);
      assert.equal(calls[k]!.body, want.body, `${c.connection.provider} ${c.spec.shape} input ${k}: Python and JavaScript build the same bytes`);
      assert.deepEqual(calls[k]!.headers, want.headers, `${c.connection.provider}: the same headers`);
    }
    // The program the page executes for one input: the same bytes, and a Response the page can read.
    calls = [];
    const want = await expected(c, c.inputs[0]!);
    const out = String(await py.runPythonAsync(withKey(judgeProgram(c.connection, want.request, { spec: c.spec, value: c.inputs[0]! }), c.key, c.connection)));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body, want.body, `${c.connection.provider} ${c.spec.shape}: the executed program builds the page's bytes`);
    const { Response } = await import("lm15/browser");
    const verdict = verdictOf(Response.fromJSON(JSON.parse(out)), { ms: 0, provider: c.connection.provider, model: c.connection.model, runtime: "Python" });
    assert.deepEqual(verdict.data, JSON.parse(JUDGED_TEXT), `${c.connection.provider}: the pick comes back through Python`);
    if (c.connection.provider === "typesafe") assert.equal(verdict.method, "provider_classification");
    // A chat wire records what it could not take: the probabilities, or — Z.AI, whose wire has no json_schema — the response format itself, in which case the questions never reached the model.
    else assert.ok(verdict.adaptations.some((a) => (a.field === "config.probabilities" || a.field === "config.response_format") && a.action === "dropped"), `${c.connection.provider}: the dropped probabilities or format are recorded`);
  }
});

test("on Jev the wire is the docs' request: the state is the input verbatim, the instructions a named key, a transcript the caller's messages array; on a chat wire the same set is the system prompt and a data part as JSON text", async () => {
  const typesafe: Connection = { provider: "typesafe", model: "jev-latest", endpoint: "" };
  const state = async (spec: JudgeSpec, value: InputValue) => (JSON.parse(utf8Decode((await createClient(typesafe, "k").buildRequest(judgeRequest(typesafe, spec, value), false)).body)) as { state: unknown; questions: Record<string, unknown> });
  // The default: the docs' quick start, a string and the questions.
  assert.equal((await state(EXAMPLE_SPEC, "A note.")).state, "A note.");
  assert.deepEqual((await state(WITH, "A note.")).state, { instructions: EXAMPLE_INSTRUCTIONS, text: "A note." });
  const fields: JudgeSpec = { ...EXAMPLE_SPEC, shape: "fields", fields: [{ name: "note", type: "text" }, { name: "price_eur", type: "number" }] };
  assert.deepEqual((await state(fields, { note: "A note.", price_eur: 48 })).state, { note: "A note.", price_eur: 48 });
  assert.deepEqual((await state({ ...fields, instructions: EXAMPLE_INSTRUCTIONS }, { note: "A note.", price_eur: 48 })).state, { instructions: EXAMPLE_INSTRUCTIONS, note: "A note.", price_eur: 48 });
  const turns: InputValue = [{ role: "user", content: "Red?" }, { role: "assistant", content: "This one." }];
  assert.deepEqual((await state({ ...EXAMPLE_SPEC, shape: "conversation" }, turns)).state, { messages: [{ role: "user", content: "Red?" }, { role: "assistant", content: "This one." }] });
  assert.deepEqual((await state({ ...WITH, shape: "conversation" }, turns)).state, { instructions: EXAMPLE_INSTRUCTIONS, messages: [{ role: "user", content: "Red?" }, { role: "assistant", content: "This one." }] });
  // A field named like the instructions key has nowhere to go: refused before any wire, named.
  assert.throws(() => judgeRequest(typesafe, { ...fields, instructions: EXAMPLE_INSTRUCTIONS, fields: [{ name: "instructions", type: "text" }] }, { instructions: "x" }), /already named instructions/);
  assert.doesNotThrow(() => judgeRequest(typesafe, { ...fields, fields: [{ name: "instructions", type: "text" }] }, { instructions: "x" }), "no instructions set: the field is the caller's own key");
  // The code says the same: no system= on Jev, the state written out; a chat wire keeps system= and the data part.
  assert.match(judgeJavascript(typesafe, EXAMPLE_SPEC, ["A note."]), /messages: \[Message\.user\(input\)\],/, "the default code is the quick start: the text is the state");
  assert.match(judgeJavascript(typesafe, WITH, ["A note."]), /Message\.user\(\{ type: "data", value: \{ instructions: "These are tasting notes[^"]*", text: input \} \}\)/);
  assert.doesNotMatch(judgeJavascript(typesafe, WITH, ["A note."]), /system:/);
  assert.match(judgePython(typesafe, { ...fields, instructions: EXAMPLE_INSTRUCTIONS }, [{ note: "n", price_eur: 1 }]), /Message\.user\(data\(\{"instructions": "These are tasting notes[^"]*", \*\*x\}\)\)/);
  assert.match(judgePython(typesafe, { ...EXAMPLE_SPEC, shape: "conversation" }, [turns]), /"role": "user",\n\s+"content": "Red\?"/, "a Jev transcript is plain objects, not Message.user calls");
  assert.doesNotMatch(judgePython(typesafe, { ...EXAMPLE_SPEC, shape: "conversation" }, [turns]), /Message\.user\("Red/);
  const openai: Connection = { provider: "openai", model: "gpt-4.1-mini", endpoint: "" };
  assert.match(judgeJavascript(openai, WITH, ["A note."]), /system: "These are tasting notes/);
  assert.doesNotMatch(judgeJavascript(openai, EXAMPLE_SPEC, ["A note."]), /system:/);
  assert.match(judgeJavascript(openai, { ...EXAMPLE_SPEC, shape: "conversation" }, [turns]), /\[Message\.user\("Red\?"\), Message\.assistant\("This one\."\)\]/);
  const chatBody = JSON.parse(utf8Decode((await createClient(openai, "k").buildRequest(judgeRequest(openai, fields, { note: "A note.", price_eur: 48 }), false)).body)) as { input: Array<{ content: Array<{ text: string }> }> };
  assert.equal(chatBody.input[0]!.content[0]!.text, '{"note":"A note.","price_eur":48}', "D3: a data part is its compact JSON on a text wire");
});

test("Rust: the tab names the pin gap and the runtime refuses to judge rather than translate", async () => {
  assert.equal(judgeRust(), RUST_NOT_YET);
  await assert.rejects(rustRuntime.judge(cases[0]!.connection, "k", judgeRequest(cases[0]!.connection, EXAMPLE_SPEC, "x"), new AbortController().signal), (e: unknown) => e instanceof Error && e.name === "UnsupportedFeatureError" && /Rust SDK at this pin/.test(e.message));
});
