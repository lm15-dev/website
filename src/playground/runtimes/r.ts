/**
 * lm15 for R, running in webR (R compiled to WebAssembly). The package and
 * its imports come from the pinned runtime package (lm15-r's own webR build:
 * scripts/vendor-r.mjs). R builds every request and reads every reply with
 * lm15's own code; the page's fetch sends them, through the package's browser
 * bridge (inst/browser/lm15.mjs), as the Rust and Go runtimes do.
 */
import { Request as RequestNs, Response, parseJson, stringifyJson } from "@lm15/lm15/browser";
import { ANTHROPIC_BROWSER_HEADER, type Connection, type Wire } from "../experience.ts";
import { isJudgeRequest } from "../judge.ts";
import { connectionOf } from "./rust.ts";
import type { Runtime } from "./index.ts";
import { fetchWithProgress, fileSizes, paint, type Report } from "./progress.ts";

interface WebR {
  init(): Promise<void>;
  installPackages(packages: string[], options: { repos: string; quiet?: boolean }): Promise<void>;
  evalRString(code: string): Promise<string>;
}
interface WireRequest { method: string; url: string; headers: Record<string, string>; body_b64: string }
interface Bridge {
  buildJSON(request: string, options: { stream: boolean }): Promise<WireRequest>;
  completeJSON(request: string, options: { signal: AbortSignal }): Promise<string>;
  streamJSON(request: string, options: { signal: AbortSignal; onResponse: (response: string) => void }): AsyncIterable<string>;
}
interface BridgeModule { Lm15WebR: new (webR: WebR, options: Record<string, unknown>) => Bridge }

const BASE = new URL("../../vendor/r/", import.meta.url).href;
let session: { webR: WebR; bridge: BridgeModule } | undefined;
let loading: Promise<{ webR: WebR; bridge: BridgeModule }> | undefined;

/** An error the R package raised: its contract class and the full message R formats (context, request id, retry advice). */
export class RError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;
  constructor(detail: { code?: string; message?: string; display?: string; errorClass?: string; status?: number; request_id?: string }) {
    super(detail.display ?? detail.message ?? "lm15 for R failed");
    this.code = detail.code ?? "provider";
    this.name = detail.errorClass ?? "LM15Error";
    if (detail.status !== undefined) this.status = detail.status;
    if (detail.request_id !== undefined) this.requestId = detail.request_id;
  }
}

async function boot(report: Report): Promise<{ webR: WebR; bridge: BridgeModule }> {
  if (session) return session;
  return loading ??= (async () => {
    report({ phase: "Loading R", detail: "webR" });
    const [{ WebR }, bridge] = await Promise.all([
      import(/* @vite-ignore */ `${BASE}runtime/webr.mjs`) as Promise<{ WebR: new (options: Record<string, unknown>) => WebR }>,
      import(/* @vite-ignore */ `${BASE}lm15.mjs`) as Promise<BridgeModule>,
    ]);
    // R itself is the large file: fetch it first with progress, so webR finds it in the HTTP cache.
    const sizes = await fileSizes();
    await (await fetchWithProgress(`${BASE}runtime/R.wasm`, "Downloading R", sizes["r/runtime/R.wasm"], report, { signal: AbortSignal.timeout(180_000) })).arrayBuffer();
    report({ phase: "Starting R", detail: "webR" });
    await paint();
    const webR = new WebR({ baseUrl: `${BASE}runtime/`, interactive: false });
    await webR.init();
    report({ phase: "Installing lm15 for R" });
    await paint();
    await webR.installPackages(["lm15"], { repos: `${BASE}repo`, quiet: true });
    const version = await webR.evalRString('as.character(utils::packageVersion("lm15"))');
    session = { webR, bridge };
    report({ phase: `R ready: lm15 ${version} (webR)`, fraction: 1 });
    return session;
  })().catch((error) => { loading = undefined; throw error; });
}

/** The bridge for one connection. The page's fetch adds what a page must send (Anthropic's opt-in header), as for Rust and Go. */
function client(r: { webR: WebR; bridge: BridgeModule }, connection: Connection, key: string | undefined): Bridge {
  const conn = connectionOf(connection, key);
  const pageFetch = (url: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (connection.provider === "anthropic") headers.set(ANTHROPIC_BROWSER_HEADER[0], ANTHROPIC_BROWSER_HEADER[1]);
    return globalThis.fetch(url, { ...init, headers });
  };
  return new r.bridge.Lm15WebR(r.webR, { provider: conn.provider, apiKey: conn.apiKey, ...(conn.baseUrl !== undefined ? { baseUrl: conn.baseUrl } : {}), fetch: pageFetch });
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string" && !(error instanceof DOMException)) throw new RError(error as { code: string; message?: string });
    throw error;
  }
}

const canonical = (request: Parameters<typeof RequestNs.toJSON>[0]): string => stringifyJson(RequestNs.toJSON(request));
const responseOf = (text: string) => Response.fromJSON(parseJson(text) as Parameters<typeof Response.fromJSON>[0]);

export const rRuntime: Runtime = {
  id: "r", label: "R",
  claim: "lm15 for R, running in webR (R compiled to WebAssembly), builds the request and reads the reply; this page does the fetch.",
  loaded: () => session !== undefined,
  load: async (report) => void (await boot(report)),
  async wire(connection, key, request): Promise<Wire> {
    const r = await boot(() => {});
    const built = await guarded(() => client(r, connection, key).buildJSON(canonical(request), { stream: !isJudgeRequest(request) }));
    const body = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(built.body_b64), (c) => c.charCodeAt(0)));
    return { method: built.method, url: built.url, headers: Object.entries(built.headers), body };
  },
  async stream(connection, key, request, signal, onText) {
    const r = await boot(() => {});
    let final: string | undefined;
    await guarded(async () => {
      for await (const text of client(r, connection, key).streamJSON(canonical(request), { signal, onResponse: (response) => { final = response; } })) {
        if (signal.aborted) break;
        const event = parseJson(text) as unknown as { type?: string; delta?: { type?: string; text?: string } };
        if (event.type === "delta" && event.delta?.type === "text" && event.delta.text) onText(event.delta.text);
      }
    });
    signal.throwIfAborted();
    if (final === undefined) throw new RError({ code: "stream_assembly", message: "The stream ended without a final response." });
    return responseOf(final);
  },
  async judge(connection, key, request, signal) {
    const r = await boot(() => {});
    return responseOf(await guarded(() => client(r, connection, key).completeJSON(canonical(request), { signal })));
  },
};
