/**
 * The playground's code panel is executable documentation in three
 * languages. For every provider, with and without a replayed transcript
 * (including thinking parts and continuation state), with default and
 * full settings (system prompt, temperature, reasoning):
 *
 * - the JavaScript text type-checks against the built package, runs, and
 *   builds the same request as the page's own builder;
 * - the Python text runs under Pyodide (Node-hosted), through
 *   lm15-python's FetchTransport, and builds the same bytes as JavaScript;
 * - the Rust runtime (lm15-rs compiled to wasm) builds the same bytes;
 * - the Rust text is what `examples/rust/src/main.rs` holds; check that
 *   project with `rcargo check --locked` (`npm run rust:snippets`
 *   regenerates the file; this test refuses drift).
 *
 * The SDKs come from the pinned runtime package. Website tests use those
 * artifacts without rebuilding the language ports.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { Message, Request as RequestNs, UnsupportedFeatureError, continuationState, thinking, utf8Decode } from "lm15/browser";
import { CONNECTIONS } from "../src/playground/connections.ts";
import { DEFAULT_SETTINGS, EXAMPLE_API_KEY, rustPinGap, buildRequest, createClient, exampleConversation, exampleJavascript, examplePython, exampleRust, fuzzyScore, judgmentsOnly, keyless, slashCommand, streams, type Connection, type Settings } from "../src/playground/experience.ts";
import { RustCodec } from "../src/playground/runtimes/rust.ts";
import { withKey } from "../src/playground/runtimes/python.ts";
import "lm15/node";
import { ensureWheel, ensureRustWasm } from "./support/runtimes.ts";
import { replyFor } from "./support/replies.ts";
import { renderRustExamples, rustExamplesPath } from "../scripts/rust-snippets.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prompt = 'Quotes " and a newline\n</script> are text, not executable code.';
const history = [
  Message.user("Earlier question"),
  Message.assistant([thinking("Earlier hidden reasoning", { continuation: [continuationState("anthropic", "thinking_signature", { signature: "opaque-replay-signature" })] }), "Earlier answer"]),
];
const FULL: Settings = { ...DEFAULT_SETTINGS, system: "Answer briefly.", temperature: 0.2, maxTokens: 64, reasoning: "low" };
/** Chat cases: every provider that chats. TypeSafe judges only; judge_examples.test.ts covers it with the rest in Judge mode. */
const cases = CONNECTIONS.filter((choice) => !judgmentsOnly(choice.id)).flatMap((choice) =>
  ([[], history, exampleConversation()] as Message[][]).flatMap((messages) =>
    [DEFAULT_SETTINGS, FULL].map((settings) => ({
      messages,
      settings,
      connection: { provider: choice.id, model: choice.model || "custom-model", endpoint: "http://localhost:1234/v1" } satisfies Connection,
      key: keyless(choice.id) ? "unused" : EXAMPLE_API_KEY,
    })),
  ),
);
const rustCases = cases;
const wheel = ensureWheel();
const wasm = ensureRustWasm();

test("Python key injection changes only the credential field, never example text", () => {
  for (const provider of ["openai", "custom"]) {
    const connection: Connection = { provider, model: "test", endpoint: "http://localhost:1234/v1" };
    const source = examplePython(connection, DEFAULT_SETTINGS, exampleConversation(), EXAMPLE_API_KEY);
    const program = withKey(source, "real-test-key", connection);
    assert.ok(program.includes(`Message.user(${JSON.stringify(EXAMPLE_API_KEY)})`));
    if (provider === "custom") assert.equal(program, source);
    else {
      assert.ok(program.includes('api_key="real-test-key"'));
      assert.throws(() => withKey(source, undefined, connection), /API key/);
      assert.throws(() => withKey("unexpected source", "real-test-key", connection), /missing its API key field/);
    }
  }
});

test("fuzzy selection ranks exact names first and rejects unordered matches; slash commands stay distinct", () => {
  assert.ok(fuzzyScore("openai", "openai") > fuzzyScore("openai", "openai-chat"));
  assert.ok(fuzzyScore("gpt4mini", "gpt-4.1-mini") > -Infinity);
  assert.equal(fuzzyScore("xyz", "openai"), -Infinity);
  assert.deepEqual(slashCommand("/provider ant"), { kind: "provider", query: "ant" });
  assert.deepEqual(slashCommand("/model gpt4mini"), { kind: "model", query: "gpt4mini" });
  assert.deepEqual(slashCommand("/"), { kind: "commands", query: "" });
  assert.equal(slashCommand("Explain /model to me"), undefined);
});

/** The page's own request for a case, and its bytes through the JavaScript runtime's client — or the typed refusal (ollama has no reasoning field). */
async function expected(c: (typeof cases)[number]) {
  const request = buildRequest(c.connection, c.settings, c.messages, prompt);
  try {
    const built = await createClient(c.connection, c.key).buildRequest(request, streams(c.connection));
    return { request, refused: undefined, method: built.method, url: built.url, body: utf8Decode(built.body), headers: Object.fromEntries(built.headers.map(([k, v]) => [k.toLowerCase(), v])) };
  } catch (e) {
    if (!(e instanceof UnsupportedFeatureError)) throw e;
    return { request, refused: e, method: "", url: "", body: "", headers: {} };
  }
}

test(`JavaScript: all ${cases.length} variants type-check, execute, and build the page's request`, { timeout: 120_000 }, async (t) => {
  assert.equal(cases.length, 66);
  const sources = cases.map((c) => exampleJavascript(c.connection, c.settings, c.messages, prompt).replace("console.log(text)", "void text"));
  const files = new Map(sources.map((source, i) => [resolve(root, `src/playground/__example_${i}.ts`), source]));
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
    return replyFor(url);
  });
  const entry = import.meta.resolve('lm15/browser');
  for (const [i, c] of cases.entries()) {
    calls = [];
    const want = await expected(c);
    const url = `data:text/javascript,${encodeURIComponent(`// variant ${i}\n` + sources[i]!.replace('"lm15/browser"', JSON.stringify(entry)) + "\nexport { request, response };")}`;
    if (want.refused) {
      await assert.rejects(import(url), (e: unknown) => e instanceof Error && e.name === "UnsupportedFeatureError", `${c.connection.provider}: the JavaScript text refuses as the page does`);
      assert.equal(calls.length, 0);
      continue;
    }
    const module = await import(url);
    assert.equal(calls.length, 1, `${c.connection.provider}: one request`);
    assert.equal(calls[0]!.url, want.url);
    assert.equal(calls[0]!.body, want.body, `${c.connection.provider}: the JavaScript text and the page build the same bytes`);
    assert.equal(module.response.finishReason, "stop");
    if (c.messages === history) assert.match(sources[i]!, /"continuation": \[/, "the transcript is replayed with its continuation state");
  }
});

test(`Python under Pyodide: all ${cases.length} variants execute and build the same bytes as JavaScript`, { timeout: 600_000 }, async () => {
  const { loadPyodide } = await import("pyodide");
  let calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  (globalThis as { fetch: typeof fetch }).fetch = async (url, init) => {
    calls.push({ url: String(url), body: new TextDecoder().decode(init?.body as Uint8Array), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return replyFor(String(url));
  };
  const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
  await py.loadPackage(pathToFileURL((wheel as { path: string }).path).href, { messageCallback: () => {} });
  for (const c of cases) {
    calls = [];
    const want = await expected(c);
    const source = examplePython(c.connection, c.settings, c.messages, prompt).replace(JSON.stringify(EXAMPLE_API_KEY), JSON.stringify(c.key));
    let out: string;
    try {
      out = String(await py.runPythonAsync(`${source}\nimport json\nfrom lm15.serde import response_to_dict\njson.dumps(response_to_dict(response))`));
    } catch (e) {
      const tail = String((e as Error).message).split("\n").slice(-6).join("\n");
      if (want.refused) {
        assert.match(tail, /UnsupportedFeatureError/, `${c.connection.provider}: Python refuses as JavaScript does`);
        assert.equal(calls.length, 0);
        continue;
      }
      assert.fail(`${c.connection.provider}: the Python text failed under Pyodide:\n${tail}\n---\n${source}`);
    }
    assert.equal(want.refused, undefined, `${c.connection.provider}: JavaScript refused but Python did not`);
    assert.equal(calls.length, 1, `${c.connection.provider}: one request`);
    assert.equal(calls[0]!.url, want.url, c.connection.provider);
    assert.equal(calls[0]!.body, want.body, `${c.connection.provider}: Python and JavaScript build the same bytes`);
    assert.deepEqual(calls[0]!.headers, want.headers, `${c.connection.provider}: the same headers`);
    assert.equal((JSON.parse(out) as { finish_reason: string }).finish_reason, "stop");
  }
});

test(`Rust under wasm: all ${rustCases.length} chat variants build the same bytes as JavaScript`, { timeout: 120_000 }, async () => {
  const rust = await RustCodec.load(readFileSync((wasm as { path: string }).path));
  let namedGaps = 0;
  for (const c of rustCases) {
    const want = await expected(c);
    const codecConnection = c.connection.provider === "custom" ? { provider: "openai-chat", apiKey: c.key, baseUrl: c.connection.endpoint } : { provider: c.connection.provider, apiKey: c.key };
    const gap = rustPinGap(c.connection, want.request);
    if (gap) {
      // The Rust pin predates MAP-13: the page names the difference instead of calling it a bug, and this test pins that it is the only kind of difference.
      namedGaps++;
      let rustBody: unknown;
      try { rustBody = rust.buildRequest(codecConnection, RequestNs.toJSON(want.request), true).body; } catch (e) { rustBody = `refused: ${(e as Error).name}`; }
      assert.notDeepEqual(rustBody, want.body ? JSON.parse(want.body) : undefined, `${c.connection.provider}: the named gap is real (${gap})`);
      continue;
    }
    if (want.refused) {
      assert.throws(() => rust.buildRequest(codecConnection, RequestNs.toJSON(want.request), true), (e: unknown) => e instanceof Error && e.name === "UnsupportedFeatureError", `${c.connection.provider}: Rust refuses as JavaScript does`);
      continue;
    }
    const built = rust.buildRequest(codecConnection, RequestNs.toJSON(want.request), true);
    const url = new URL(built.url);
    for (const [k, v] of Object.entries(built.params)) url.searchParams.set(k, v);
    assert.equal(url.href, want.url, c.connection.provider);
    assert.deepEqual(built.body, JSON.parse(want.body), `${c.connection.provider}: Rust and JavaScript build the same body`);
  }
  assert.equal(namedGaps, 6, "the named Rust-pin gaps: Anthropic without max_tokens (3 transcripts × default settings), Ollama with reasoning (3 transcripts × FULL)");
});

test("Rust: standalone examples match the generator and the pinned SDK imports", () => {
  const rendered = renderRustExamples();
  assert.ok(existsSync(rustExamplesPath), `${rustExamplesPath} is missing; run npm run rust:snippets`);
  assert.equal(readFileSync(rustExamplesPath, "utf-8"), rendered, "the Rust snippets drifted; run npm run rust:snippets and rcargo check --locked in examples/rust");
  for (const c of rustCases.filter((x) => (x.settings === FULL) === x.messages.length > 0)) {
    assert.ok(rendered.includes(exampleRust(c.connection, c.settings, c.messages, prompt).split("\n")[1]!), c.connection.provider);
  }
});

test("a transcript parsed off the wire (RawNumber lexemes in an opaque payload) renders and builds in every language", {}, async () => {
  const { parseJson } = await import("lm15/browser");
  // What a JavaScript turn leaves in the transcript: numbers from the provider's body are RawNumber, not Number.
  const fromWire = Message.fromJSON(parseJson('{"role":"assistant","parts":[{"type":"text","text":"Earlier answer","continuation":[{"provider":"openai","kind":"reasoning_item","data":{"n":1.0,"big":12345678901234567890}}]}]}') as never);
  const transcript = [Message.user("Earlier question"), fromWire];
  const connection: Connection = { provider: "openai", model: "gpt-4.1-mini", endpoint: "" };
  for (const render of [exampleJavascript, examplePython, exampleRust]) {
    const text = render(connection, DEFAULT_SETTINGS, transcript, prompt);
    assert.match(text, /12345678901234567890/, `${render.name}: the wire's lexeme survives, not a rounded Number`);
    assert.match(text, /1\.0/, `${render.name}: 1.0 stays 1.0`);
  }
  const rust = await RustCodec.load(readFileSync((wasm as { path: string }).path));
  const request = buildRequest(connection, DEFAULT_SETTINGS, transcript, prompt);
  const want = await createClient(connection, "k").buildRequest(request, true);
  const built = rust.buildRequest({ provider: "openai", apiKey: "k" }, RequestNs.toJSON(request), true);
  assert.deepEqual(built.body, JSON.parse(utf8Decode(want.body)), "the Rust codec builds the same body from a wire-parsed transcript");
});

test("the relay: off by default, per provider, remembered only on request; the SDK sees it as a baseUrl", async () => {
  const relay = await import("../src/playground/relay.ts");
  assert.equal(relay.relayAvailable(), true);
  assert.equal(relay.RELAY_URL, "https://lm15-relay.mrive052.workers.dev");
  assert.equal(relay.relayBaseUrl("typesafe", "https://lm15-relay.example.workers.dev"), "https://lm15-relay.example.workers.dev/api.typesafe.ai");
  assert.equal(relay.relayBaseUrl("openai", "https://r.example/"), "https://r.example/api.openai.com/v1");
  assert.equal(relay.looksBrowserBlocked(Object.assign(new Error("Failed to fetch"), { name: "TransportError" })), true);
  assert.equal(relay.looksBrowserBlocked(Object.assign(new Error("NetworkError when attempting to fetch resource."), { name: "TransportError" })), true);
  assert.equal(relay.looksBrowserBlocked(Object.assign(new Error("POST https://api.typesafe.ai/v1/systemone: request failed"), { name: "TransportError", cause: new TypeError("Failed to fetch") })), true);
  assert.equal(relay.looksBrowserBlocked(Object.assign(new Error("HTTP 401"), { name: "AuthError" })), false);
  assert.equal(relay.looksBrowserBlocked(new Error("Add this provider's API key in Settings first.")), false);
});
