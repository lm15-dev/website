import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Request as RequestNs, Message, parseJson, stringifyJson } from "@lm15/lm15/browser";
import { rustRuntime, RustCodec } from "../src/playground/runtimes/rust.ts";
import { ensureRustWasm } from "./support/runtimes.ts";

const connection = { provider: "openai", model: "gpt-4.1-mini", endpoint: "" };
const event = (delta: string) => new TextEncoder().encode(`data: ${JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta })}\n\n`);

test("Rust bridge retains raw numbers and typed evidence; close_source and abort cancel/release the real reader", async (t) => {
  const bytes = readFileSync(ensureRustWasm().path);
  const codec = await RustCodec.load(bytes);
  const value = parseJson('{"type":"data","value":{"big":12345678901234567890,"float":1.0}}');
  const roundtrip = codec.call<{ value: unknown }>("serde_roundtrip", { kind: "part", value });
  assert.equal(stringifyJson(roundtrip.value), stringifyJson(value));
  let mode: "stop" | "abort" | "error" = "stop";
  let cancelled = 0;
  let body: ReadableStream<Uint8Array> | undefined;
  let ready: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(".wasm")) return new Response(bytes, { headers: { "content-type": "application/wasm" } });
    // Only the provider is the provider. The runtime also asks for its
    // loading-card size manifest (vendor/sizes.json, since 2026-09-20); an
    // endless provider stream there left the load waiting forever. Missing is
    // a state the loader handles ({} sizes, an indeterminate bar).
    if (!url.startsWith("https://api.openai.com/")) return new Response("not found", { status: 404 });
    if (mode === "error") return new Response('{"error":{"message":"offline rate limit","type":"rate_limit_error"}}', { status: 429, headers: { "content-type": "application/json", "x-request-id": "req-rust-bridge", "retry-after": "2" } });
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (mode === "stop") { controller.enqueue(event("hello 🍷 ST")); controller.enqueue(event("OP never shown")); }
        else controller.enqueue(event("first"));
        ready?.();
        // Deliberately never EOF: cancellation must come from stop matching or the signal.
      },
      cancel() { cancelled++; },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  const request = RequestNs.create({ model: connection.model, messages: [Message.user("test")], config: { stop: ["STOP"] } });
  let text = "";
  const response = await rustRuntime.stream(connection, "dummy", request, new AbortController().signal, (chunk) => { text += chunk; });
  assert.equal(text, "hello 🍷 ", "the held suffix drains through stream_close without leaking the stop");
  assert.equal(response.text, text);
  assert.equal(cancelled, 1);
  assert.equal(body?.locked, false);
  mode = "abort";
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const controller = new AbortController();
  const pending = rustRuntime.stream(connection, "dummy", request, controller.signal, () => {});
  await started; controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, 2);
  assert.equal(body?.locked, false);
  mode = "error";
  await assert.rejects(rustRuntime.judge(connection, "dummy", RequestNs.create({ model: connection.model, messages: [Message.user("test")] }), new AbortController().signal), (error: unknown) => {
    assert.match(String(error), /req-rust-bridge/);
    assert.equal((error as { status: number }).status, 429);
    return true;
  });
});
