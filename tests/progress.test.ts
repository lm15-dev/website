import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWithProgress, megabytes } from "../src/playground/runtimes/progress.ts";

test("a download is measured against the build's real size, and the bytes pass through untouched", async () => {
  const chunks = [new Uint8Array(400_000), new Uint8Array(400_000), new Uint8Array(200_000)];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } }), { headers: { "content-type": "application/wasm", "content-length": "123" } });
  try {
    const seen: Array<[string | undefined, number | undefined]> = [];
    const response = await fetchWithProgress("https://example.test/x.wasm", "Downloading X", 1_000_000, (p) => seen.push([p.detail, p.fraction]));
    assert.equal(response.headers.get("content-type"), "application/wasm", "the headers survive, so instantiateStreaming still accepts it");
    assert.equal((await response.arrayBuffer()).byteLength, 1_000_000);
    assert.deepEqual(seen, [["0 of 1.0 MB", 0], ["0.4 MB of 1.0 MB", 0.4], ["0.8 MB of 1.0 MB", 0.8], ["1.0 MB of 1.0 MB", 1]]);
    // Without a known size there is no fraction: the bar is indeterminate, never a guess against the compressed Content-Length.
    const loose: Array<number | undefined> = [];
    await (await fetchWithProgress("https://example.test/y", "Downloading Y", undefined, (p) => loose.push(p.fraction))).arrayBuffer();
    assert.ok(loose.length > 0 && loose.every((f) => f === undefined));
    globalThis.fetch = async () => new Response("no", { status: 503 });
    await assert.rejects(fetchWithProgress("https://example.test/z", "Downloading Z", 1, () => {}), /Downloading Z: HTTP 503/);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(megabytes(16_744_917), "17 MB");
  assert.equal(megabytes(1_304_462), "1.3 MB");
});
