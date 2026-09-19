/**
 * The Python runtime: lm15-python under Pyodide (CPython compiled to
 * WebAssembly), with `lm15.transports.FetchTransport` carrying the wire
 * over this page's `fetch`. What runs is the Python text the code panel
 * shows, with the placeholder key replaced by the real one at execution
 * — never in the panel, never in a URL, never persisted by Pyodide.
 *
 * Pyodide is 13 MB (cached by the browser after the first load) and the
 * lm15 wheel 0.5 MB; both are served by this site, no CDN.
 */

import { Message, Response, type Request } from "lm15/browser";
import { EXAMPLE_API_KEY, examplePython, keyless, streams, type Connection, type Settings, type Wire } from "../experience.ts";
import { isJudgeRequest, judgePython, specOfRequest, type JudgeSource } from "../judge.ts";
import type { Runtime } from "./index.ts";
import { translatePythonError as translate } from "../error-display.ts";

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(options: { write?: (buffer: Uint8Array) => number; batched?: (line: string) => void }): void;
  loadPackage(name: string, options?: { messageCallback?: (m: string) => void }): Promise<unknown>;
  globals: { get(name: string): unknown; delete(name: string): void };
}

// Relative to the built module: works locally and under a versioned static release.
const INDEX_URL = new URL("../../vendor/pyodide/", import.meta.url).href;
const WHEEL_URL = new URL("../../vendor/python/lm15.whl", import.meta.url).href;
let pyodide: Pyodide | undefined;
let loading: Promise<Pyodide> | undefined;
let bootAttempts = 0;

async function boot(report: (status: string) => void): Promise<Pyodide> {
  if (pyodide) return pyodide;
  loading ??= (async () => {
    report("Loading Pyodide (13 MB, cached after the first time)…");
    // Browsers can cache a failed module import. A retry needs a fresh module URL.
    const retry = bootAttempts++ === 0 ? "" : `?retry=${bootAttempts}`;
    const module = (await import(/* @vite-ignore */ `${INDEX_URL}pyodide.mjs${retry}`)) as { loadPyodide(options: { indexURL: string }): Promise<Pyodide> };
    const py = await module.loadPyodide({ indexURL: INDEX_URL });
    report("Installing lm15 for Python…");
    await py.loadPackage(WHEEL_URL, { messageCallback: () => {} });
    const version = String(await py.runPythonAsync("import lm15, sys; f'lm15 {lm15.__version__} on Python {sys.version.split()[0]}'"));
    report(`Python ready: ${version}`);
    pyodide = py;
    return py;
  })().catch((error) => { loading = undefined; throw error; });
  return loading;
}

/** The displayed source with the key in place of the placeholder: what actually executes. */
export function withKey(source: string, key: string | undefined, connection: Connection): string {
  if (keyless(connection.provider)) return source;
  if (!key) throw new Error("Add this provider's API key in Settings first.");
  const slot = `\n    api_key=${JSON.stringify(EXAMPLE_API_KEY)},`;
  if (!source.includes(slot)) throw new Error("The Python example is missing its API key field.");
  return source.replace(slot, `\n    api_key=${JSON.stringify(key)},`);
}

/** The transcript and prompt the request carries, as the generator expects them. */
function split(request: Request): { messages: Message[]; prompt: string } {
  const all = [...request.messages];
  const last = all.pop()!;
  const prompt = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  return { messages: all, prompt };
}
function splitArgs(request: Request): [Message[], string] { const { messages, prompt } = split(request); return [messages, prompt]; }

/** The judge program up to its loop, then the loop body once with `x = inputs[0]`, stopping before the call. */
function unrollOne(source: string): string {
  const [head, body] = source.split("\nfor x in inputs:\n");
  const built = body!.split("\n    response = await lm.complete(request)")[0]!;
  return `${head}\nx = inputs[0]\n${built.replace(/^    /gm, "")}`;
}

export const pythonRuntime: Runtime = {
  id: "python",
  label: "Python",
  claim: "lm15-python under Pyodide (real CPython in WebAssembly), the code shown, over this page's fetch.",
  loaded: () => pyodide !== undefined,
  load: async (report) => void (await boot(report)),

  async wire(connection, key, request, source): Promise<Wire> {
    const py = await boot(() => {});
    // The same construction with the sync class (no transport needed) and its
    // build_request: the bytes, no network. Public API only. A judge request
    // is the shown loop's program with this one input; the request is built
    // in the loop body, so the head runs up to it and one iteration is unrolled.
    const judged = isJudgeRequest(request);
    const from = source ?? (judged ? specOfRequest(request) : undefined);
    const shown = from ? judgePython(connection, from.spec, [from.value]) : examplePython(connection, settingsOf(request), ...splitArgs(request));
    const head = (from ? unrollOne(shown) : shown.split(/\n(?:result = AsyncResponseStream|response = await lm\.complete)/)[0]!)
      .replace(/\bAsync(OpenAILM|OpenAIChatLM|AnthropicLM|GeminiLM|TypeSafeLM)\b/g, "$1")
      .replace(/^from lm15\.transports import FetchTransport.*\n/m, "")
      .replace(/^    transport=FetchTransport\(\),\n/m, "");
    const program = `${withKey(head, key, connection)}
import json
_built = lm.build_request(request, stream=${streams(connection) && !judged ? "True" : "False"})
json.dumps({"method": _built.method, "url": _built.url, "headers": list(_built.headers), "body": _built.body.decode("utf-8")})
`;
    return JSON.parse(String(await py.runPythonAsync(program))) as Wire;
  },

  async stream(connection, key, request, signal, onText): Promise<Response> {
    const py = await boot(() => {});
    const { messages, prompt } = split(request);
    const source = examplePython(connection, settingsOf(request), messages, prompt);
    const decoder = new TextDecoder();
    py.setStdout({ write: (bytes) => (onText(decoder.decode(bytes, { stream: true })), bytes.length) });
    const program = `${withKey(source, key, connection)}
import json
from lm15.serde import response_to_dict
json.dumps(response_to_dict(response))
`;
    const abort = () => void py.runPythonAsync("await result.aclose()").catch(() => {});
    signal.addEventListener("abort", abort, { once: true });
    try {
      const out = String(await py.runPythonAsync(program));
      return Response.fromJSON(JSON.parse(out));
    } catch (error) {
      throw translate(error, signal);
    } finally {
      signal.removeEventListener("abort", abort);
      py.setStdout({ batched: () => {} });
    }
  },

  async judge(connection, key, request, signal, source): Promise<Response> {
    const py = await boot(() => {});
    py.setStdout({ batched: () => {} });
    const program = withKey(judgeProgram(connection, request, source), key, connection);
    // Pyodide cannot interrupt a running coroutine from here; an abort is honoured between inputs by the caller, and the reply of a stopped call is dropped.
    try {
      const out = String(await py.runPythonAsync(program));
      if (signal.aborted) throw Object.assign(new Error("stopped"), { name: "TransportError" });
      return Response.fromJSON(JSON.parse(out));
    } catch (error) {
      throw translate(error, signal);
    }
  },
};

/** The settings a Request carries, read back for the generator (the page passes the same object it built the request from). */
function settingsOf(request: Request): Settings {
  const config = request.config ?? {};
  return {
    system: typeof request.system === "string" ? request.system : "",
    temperature: config.temperature ?? null,
    maxTokens: config.maxTokens ?? null,
    reasoning: config.reasoning?.effort ?? ("" as const),
  };
}

/**
 * The Python the page shows for a judge set, with this one input in the
 * `inputs` list, plus the JSON of the loop's last response: the loop body
 * runs unchanged (judge.ts pins that the displayed program and this one
 * differ only in the list).
 */
export function judgeProgram(connection: Connection, request: Request, source?: JudgeSource): string {
  const { spec, value } = source ?? specOfRequest(request);
  return `${judgePython(connection, spec, [value])}
import json
from lm15.serde import response_to_dict
json.dumps(response_to_dict(response))
`;
}

