import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJson, stringifyJson } from "@lm15/lm15/browser";
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

test("Go and Rust chat and Judge examples are the SDKs' own constructors for every provider and input shape", () => {
  for (const { source, rust, hasData } of goExamples()) {
    assert.doesNotMatch(source, /json\.Unmarshal\(\[\]byte\("\{/, "no request travels as an escaped JSON string");
    assert.match(source, /lm15\.NewRequest\(/);
    if (rust) {
      assert.match(rust, /let questions = judgments\(questions\)\?;/);
      assert.match(source, /lm15\.Judgments\("judgments", true,/);
      assert.doesNotMatch(rust, /serde_json::from_str/, "no request travels as an escaped JSON string");
    }
    if (hasData) { assert.match(rust!, /Part::data\(/); assert.match(source, /lm15\.Data\(/); }
  }
});
