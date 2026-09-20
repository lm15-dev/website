import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJson, stringifyJson } from "lm15/browser";
import { LANGUAGES, rustString } from "../src/playground/experience.ts";
import { goExamples } from "./support/go-examples.ts";
import { wireOf, RustCodecError } from "../src/playground/runtimes/rust.ts";
import { compareWires } from "../src/playground/wire.ts";

test("four runtime names, lossless UTF-8 wire bytes, and honest sorted-key comparison", () => {
  assert.equal(rustString("\\back\b\u0000"), '"\\\\back\\u{8}\\u{0}"');
  assert.deepEqual(LANGUAGES.map((x) => x.id), ["javascript", "python", "rust", "go"]);
  const body = stringifyJson(parseJson('{"text":"🍷 café","number":12345678901234567890,"float":1.0}'));
  const wire = wireOf({ method: "POST", url: "https://example.test/api", params: {}, headers: {}, body: null, body_b64: Buffer.from(body).toString("base64") });
  assert.equal(wire.body, body);
  assert.match(compareWires([["JavaScript", { ...wire, body: '{"b":2,"a":1}' }], ["Go", { ...wire, body: '{"a":1,"b":2}' }]]), /Same parsed request.*Body bytes differ in Go/);
  assert.match(compareWires([["Rust", wire], ["Go", wire]]), /Same request body bytes/);
  const error = new RustCodecError({ name: "RateLimitError", code: "rate_limit", message: "retry later (request req-test)", status: 429, http_response: { request_id: "req-test" } });
  assert.match(String(error), /req-test/);
  assert.equal((error as unknown as { status: number }).status, 429);
});

test("Go chat and Judge examples embed exactly the page's canonical requests for every provider and input shape", () => {
  for (const { source, canonical, rust, hasData } of goExamples()) {
    const literals = source.split("    inputs := []string{\n")[1]!.split("    }\n")[0]!.trim().split("\n");
    assert.deepEqual(literals.map((line) => parseJson(JSON.parse(line.trim().replace(/,$/, "")) as string)), canonical);
    if (rust) assert.ok(rust.includes("Config::from_json"));
    if (hasData) assert.ok(rust?.includes("DataPart::new"));
  }
});
