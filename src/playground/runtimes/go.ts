/** The actual lm15-go SDK and its net/http transport, compiled with GOOS=js GOARCH=wasm. */
import { Request as RequestNs, Response, parseJson, stringifyJson } from "lm15/browser";
import { isJudgeRequest } from "../judge.ts";
import { connectionOf, RustCodecError, wireOf, type RustFailure, type WireRequest, type CanonicalEvent } from "./rust.ts";
import type { Runtime } from "./index.ts";

interface GoBridge {
  call(op: string, input: string, signal?: AbortSignal, onEvent?: (event: string) => void): Promise<string>;
}
interface GoProgram {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}
const globals = globalThis as typeof globalThis & { Go?: new () => GoProgram; lm15Go?: GoBridge };
const EXEC_URL = new URL("../../vendor/go/wasm_exec.js", import.meta.url).href;
const WASM_URL = new URL("../../vendor/go/lm15-go.wasm", import.meta.url).href;
let bridge: GoBridge | undefined;
let loading: Promise<GoBridge> | undefined;
let running = false;
let scriptLoading: Promise<void> | undefined;

function loadScript(): Promise<void> {
  if (globals.Go) return Promise.resolve();
  return scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = EXEC_URL; script.async = true;
    const timer = setTimeout(() => finish(new Error("Go support script timed out")), 30_000);
    const finish = (error?: Error) => {
      clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error) { script.remove(); scriptLoading = undefined; reject(error); }
      else resolve();
    };
    script.onload = () => finish(globals.Go ? undefined : new Error("Go support script did not expose Go"));
    script.onerror = () => finish(new Error("Could not load Go support script"));
    document.head.append(script);
  });
}

async function boot(report: (status: string) => void): Promise<GoBridge> {
  if (bridge) return bridge;
  return loading ??= (async () => {
    report("Loading the Go SDK (WebAssembly)…");
    await loadScript();
    // A parked Go scheduler owns its globals until it exits. Never launch a second one on a timeout.
    if (running) throw new Error("Go is still starting; reload the page before retrying");
    const program = new globals.Go!();
    const response = await fetch(WASM_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Go WebAssembly: HTTP ${response.status}`);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), program.importObject);
    delete globals.lm15Go;
    running = true;
    let exit: Error | undefined;
    void program.run(instance).then(() => { exit = new Error("Go program exited"); }, (error: unknown) => { exit = error instanceof Error ? error : new Error(String(error)); }).finally(() => {
      running = false; bridge = undefined; loading = undefined; delete globals.lm15Go;
    });
    const deadline = Date.now() + 30_000;
    while (!globals.lm15Go) {
      if (exit) throw exit;
      if (Date.now() >= deadline) throw new Error("Go SDK readiness timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (exit) throw exit;
    const ready = globals.lm15Go;
    const version = await call<{ version: string }>(ready, "version", {});
    bridge = ready;
    report(`Go ready: lm15-go ${version.version} (wasm)`);
    return ready;
  })().catch((error) => { loading = undefined; throw error; });
}

async function call<T>(go: GoBridge, op: string, input: unknown, signal?: AbortSignal, onEvent?: (event: string) => void): Promise<T> {
  signal?.throwIfAborted();
  const reply = parseJson(await go.call(op, stringifyJson(input), signal, onEvent)) as unknown as { error?: RustFailure };
  signal?.throwIfAborted();
  if (reply.error) throw new RustCodecError(reply.error);
  return reply as T;
}

export const goRuntime: Runtime = {
  id: "go", label: "Go",
  claim: "lm15-go compiled to WebAssembly builds and sends requests through Go's browser HTTP transport.",
  loaded: () => bridge !== undefined,
  load: async (report) => void (await boot(report)),
  async wire(connection, key, request) {
    const go = await boot(() => {});
    const conn = connectionOf(connection, key);
    return wireOf(await call<WireRequest>(go, "build_request", { provider: conn.provider, api_key: conn.apiKey, base_url: conn.baseUrl, canonical_request: RequestNs.toJSON(request), stream: !isJudgeRequest(request) }));
  },
  async stream(connection, key, request, signal, onText) {
    const go = await boot(() => {});
    const conn = connectionOf(connection, key);
    const result = await call<{ canonical_response: Parameters<typeof Response.fromJSON>[0] }>(go, "stream", { provider: conn.provider, api_key: conn.apiKey, base_url: conn.baseUrl, canonical_request: RequestNs.toJSON(request) }, signal, (text) => {
      if (signal.aborted) return;
      const event = parseJson(text) as unknown as CanonicalEvent;
      const delta = event["delta"] as { type?: string; text?: string } | undefined;
      if (event.type === "delta" && delta?.type === "text" && delta.text) onText(delta.text);
    });
    return Response.fromJSON(result.canonical_response);
  },
  async judge(connection, key, request, signal) {
    const go = await boot(() => {});
    const conn = connectionOf(connection, key);
    const result = await call<{ canonical_response: Parameters<typeof Response.fromJSON>[0] }>(go, "complete", { provider: conn.provider, api_key: conn.apiKey, base_url: conn.baseUrl, canonical_request: RequestNs.toJSON(request) }, signal);
    return Response.fromJSON(result.canonical_response);
  },
};
