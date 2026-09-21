/**
 * Judge mode's rules (src/playground/judge.ts), with no DOM and no
 * network: the question form is a faithful view over the schema, the
 * request over the state is the SDK's, and the answer is echoed the way
 * each language prints it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpResponse, Response, choice, judgmentsInSchema, score, stringifyJson, utf8Decode, yesNo } from "lm15/browser";
import { createClient, type Connection } from "../src/playground/experience.ts";
import { EXAMPLE_NOTE, EXAMPLE_SPEC, distribution, expectedLevel, freeName, judgeGo, judgeJavascript, judgePython, judgeRequest, judgeRust, parseProperties, parseStateObject, pickLabel, questionOf, readQuestions, specOfRequest, verdictOf, withQuestion, withoutQuestion, writeQuestion, type JudgeSpec, type Question } from "../src/playground/judge.ts";
import { judgeProgram } from "../src/playground/runtimes/python.ts";
import { replyFor } from "./support/replies.ts";

const typesafe: Connection = { provider: "typesafe", model: "jev-latest", endpoint: "" };
/** The example's one question plus two more: what the tests below need to see every sugar. */
const THREE: JudgeSpec = { ...EXAMPLE_SPEC, properties: { ...EXAMPLE_SPEC.properties, style: choice("What is the dominant style described?", { fruit: "Fruit-forward", oak: "Oak-driven", mineral: "Mineral, savoury" }), ageing: yesNo("Does the note say the wine will improve with age?") } };
const openai: Connection = { provider: "openai", model: "gpt-4.1-mini", endpoint: "" };

test("the form reads what the SDK reads and writes what the SDK writes: every sugar shape round-trips exactly", () => {
  const shapes: Record<string, unknown> = {
    yes: yesNo("Will it age?"),
    plain: choice("Style?", ["fruit", "oak"]),
    described: choice("Style?", { fruit: "Fruit-forward", oak: null }),
    titled: score("How good?", { poor: "", good: "" }),
    titledDescribed: score("How good?", { poor: "Poor", good: "Good" }),
    descriptions: score("How good?", ["Poor", "Good"]),
  };
  for (const [name, prop] of Object.entries(shapes)) {
    const found = judgmentsInSchema({ type: "object", properties: { [name]: prop } }).get(name)!;
    const back = writeQuestion(questionOf(found));
    assert.equal(stringifyJson(back), stringifyJson(prop as never), `${name}: the form re-emits the property byte for byte`);
  }
  // A level with a description but no title has no sugar spelling; the form writes the branch itself and the SDK still reads it.
  const mixed: Question = { name: "q", kind: "score", question: "How?", options: [{ key: "", description: "Poor" }, { key: "good", description: "" }] };
  const prop = writeQuestion(mixed);
  assert.deepEqual(prop, { type: "integer", description: "How?", anyOf: [{ const: 0, description: "Poor" }, { const: 1, title: "good" }] });
  assert.equal(judgmentsInSchema({ type: "object", properties: { q: prop } }).get("q")!.kind, "ordered");
  // A property the form cannot show is kept verbatim and named.
  const { questions, opaque } = readQuestions({ ...THREE.properties, city: { type: "string" } });
  assert.deepEqual(questions.map((q) => q.name), ["quality", "style", "ageing"]);
  assert.deepEqual(opaque, ["city"]);
});

test("editing keeps the other questions and their order; names never collide; a blank question falls back to its name", () => {
  const properties = THREE.properties;
  const renamed = withQuestion(properties, "style", { name: "kind", kind: "choice", question: "", options: [{ key: "a", description: "" }] });
  assert.deepEqual(Object.keys(renamed), ["quality", "kind", "ageing"]);
  assert.equal((renamed["kind"] as { description: string }).description, "kind", "no question text: the name is the instruction (what Jev sees)");
  assert.deepEqual(Object.keys(withoutQuestion(properties, "quality")), ["style", "ageing"]);
  assert.deepEqual(Object.keys(withQuestion(properties, undefined, { name: "flag", kind: "yesNo", question: "?", options: [] })), ["quality", "style", "ageing", "flag"]);
  assert.equal(freeName(properties, "style"), "style_2");
  assert.equal(freeName({ ...properties, style_2: {} }, "style"), "style_3");
  assert.throws(() => parseProperties("{}"), /at least one property/);
  assert.throws(() => parseProperties('{"city": {"type": "string"}}'), /No property declares a judgment/);
  assert.throws(() => parseProperties("nope"), /JSON object of properties/);
});

test("one request over the state, in its shape: a text, a data part, or the transcript; on Jev the state goes verbatim", async () => {
  const bare = judgeRequest(typesafe, EXAMPLE_SPEC, EXAMPLE_NOTE);
  assert.equal(bare.system, undefined, "Jev has no system prompt, and the page has no instructions box");
  assert.deepEqual(bare.messages.map((m) => m.parts[0]!.type), ["text"], "the quick start: the text is the state");
  assert.equal(bare.config?.responseFormat?.type, "json_schema");
  assert.equal(bare.config?.probabilities, "if_available");
  const fields: JudgeSpec = { ...EXAMPLE_SPEC, shape: "fields" };
  const object = judgeRequest(typesafe, fields, { note: "Ripe.", price_eur: 48 });
  assert.deepEqual(object.messages[0]!.parts[0], { type: "data", value: { note: "Ripe.", price_eur: 48 } });
  const convo = judgeRequest(typesafe, { ...EXAMPLE_SPEC, shape: "conversation" }, [{ role: "user", content: "Red?" }, { role: "assistant", content: "Ripe." }]);
  assert.deepEqual(convo.messages.map((m) => m.role), ["user"], "one user part on Jev; the transcript is inside it");
  assert.deepEqual(judgeRequest(openai, { ...EXAMPLE_SPEC, shape: "conversation" }, [{ role: "user", content: "Red?" }, { role: "assistant", content: "Ripe." }]).messages.map((m) => m.role), ["user", "assistant"]);
  // On the Jev wire (2026-09-19 D1): the state is the value verbatim; a transcript the caller's own array.
  const state = async (request: typeof bare) => (JSON.parse(utf8Decode((await createClient(typesafe, "k").buildRequest(request, false)).body)) as { state: unknown }).state;
  assert.deepEqual(await state(bare), EXAMPLE_NOTE);
  assert.deepEqual(await state(object), { note: "Ripe.", price_eur: 48 });
  assert.deepEqual(await state(convo), { messages: [{ role: "user", content: "Red?" }, { role: "assistant", content: "Ripe." }] });
  // A runtime that re-renders its program without the source reads the spec and the state back off a chat-wire request, for every shape.
  for (const [spec, value] of [[EXAMPLE_SPEC, "Thin."], [fields, { note: "Ripe.", price_eur: 48 }], [{ ...EXAMPLE_SPEC, shape: "conversation" } as JudgeSpec, [{ role: "user", content: "Red?" }, { role: "assistant", content: "Ripe." }]]] as const) {
    const back = specOfRequest(judgeRequest(openai, spec, value));
    assert.equal(back.spec.shape, spec.shape);
    assert.deepEqual(back.spec.properties, spec.properties);
    assert.deepEqual(back.value, value);
  }
  assert.throws(() => parseStateObject("[1]"), /JSON object/);
  assert.throws(() => parseStateObject("{"), /JSON object/);
  assert.deepEqual(parseStateObject('{"a": 1}'), { a: 1 });
});

test("the Python that executes is the Python shown, plus the JSON of its response", () => {
  const shown = judgePython(openai, EXAMPLE_SPEC, "Thin.").text;
  const executed = judgeProgram(openai, judgeRequest(openai, EXAMPLE_SPEC, "Thin."));
  assert.equal(executed.split("\nimport json\n")[0], shown);
  assert.match(executed, /json\.dumps\(response_to_dict\(response\)\)/);
});

test("the code spells the questions with the SDK's sugar when the sugar reproduces them, and verbatim otherwise", () => {
  const js = judgeJavascript(typesafe, THREE, EXAMPLE_NOTE).text;
  assert.match(js, /import \{ adapterFor, Message, Request, judgments, choice, score, yesNo \} from "lm15\/browser";/);
  // Long option lists go one per line; short ones stay inline.
  assert.match(js, /quality: score\("How good is this wine, according to the note\?", \{\n    faulty: "Faulty or unpleasant",\n    simple: "Simple and sound",/);
  assert.match(js, /style: choice\("What is the dominant style described\?", \{\n    fruit: "Fruit-forward",\n    oak: "Oak-driven",\n    mineral: "Mineral, savoury",\n  \}\)/);
  assert.match(judgeJavascript(openai, { ...EXAMPLE_SPEC, properties: { ok: choice("Ok?", ["yes", "no"]) } }, "t").text, /ok: choice\("Ok\?", \["yes", "no"\]\)/);
  assert.match(js, /ageing: yesNo\("Does the note say the wine will improve with age\?"\)/);
  assert.match(js, /const state = "Ripe blackberry[^"]*";\n\nconst request = Request\.create\(\{\n  model,\n  messages: \[Message\.user\(state\)\],/, "the Jev code is the quick start: one call, the text as the state");
  assert.doesNotMatch(js, /for \(|inputs/, "one state, no loop");
  assert.match(judgeJavascript(openai, EXAMPLE_SPEC, EXAMPLE_NOTE).text, /messages: \[Message\.user\(state\)\]/);
  const py = judgePython(typesafe, THREE, EXAMPLE_NOTE).text;
  assert.match(py, /^from lm15 import AsyncTypeSafeLM, Config, Message, Request, choice, judgments, score, yes_no$/m, "no data() in the default: the text is the state");
  assert.match(py, /style=choice\("What is the dominant style described\?", \{\n        "fruit": "Fruit-forward",\n        "oak": "Oak-driven",\n        "mineral": "Mineral, savoury",\n    \}\)/);
  assert.match(py, /ageing=yes_no\(/);
  // Fields: a data part, and `data` imported in Python.
  const fields: JudgeSpec = { ...EXAMPLE_SPEC, shape: "fields" };
  assert.match(judgeJavascript(openai, fields, { note: "x" }).text, /Message\.user\(\{ type: "data", value: state \}\)/);
  assert.match(judgePython(openai, fields, { note: "x" }).text, /^from lm15 import .*\bdata\b.*$/m);
  assert.match(judgePython(openai, fields, { note: "x" }).text, /Message\.user\(data\(state\)\)/);
  // Conversation: the state is the message list on a chat wire, the `messages` array of the state on Jev.
  const convo: JudgeSpec = { ...EXAMPLE_SPEC, shape: "conversation" };
  const turns = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] as const;
  assert.match(judgeJavascript(openai, convo, turns).text, /const state = \[\n  Message\.user\("a"\),\n  Message\.assistant\("b"\),\n\];[\s\S]*messages: state,/);
  assert.match(judgeJavascript(typesafe, convo, turns).text, /messages: \[Message\.user\(\{ type: "data", value: \{ messages: state \} \}\)\]/);
  // A property outside the sugar is written as it is, in each language's literal.
  const raw: JudgeSpec = { ...EXAMPLE_SPEC, properties: { mood: { type: "string", enum: ["up", "down"], description: "Mood?", "x-note": true } } };
  assert.match(judgeJavascript(openai, raw, "t").text, /mood: \{\n    type: "string",\n    enum: \[\n      "up",\n      "down",\n    \],\n    description: "Mood\?",\n    "x-note": true,\n  \},/);
  assert.match(judgePython(openai, raw, "t").text, /mood=\{\n        "type": "string",[\s\S]*"x-note": True,\n    \},/);
  assert.doesNotMatch(judgeJavascript(openai, raw, "t").text, /, choice|, score|, yesNo/);
  // The answer, once there is one, is echoed under the program the way each language prints it.
  const echo = { data: { quality: 3, ok: true }, probabilities: { quality: { faulty: 0, good: 0.123456 } }, adaptations: [{ field: "config.probabilities", action: "dropped" }] };
  assert.match(judgeJavascript(openai, EXAMPLE_SPEC, "t", echo).text, /console\.log\(response\.data\); \/\/ the picked key per judgment\n\/\/ → \{ quality: 3, ok: true \}\nconsole\.log\(response\.probabilities\);[^\n]*\n\/\/ → \{ quality: \{ faulty: 0, good: 0\.123 \} \}\n/);
  assert.match(judgePython(openai, EXAMPLE_SPEC, "t", echo).text, /print\(response\.data\)  # the picked key per judgment\n# → \{ 'quality': 3, 'ok': True \}\n/);
  assert.match(judgeGo(openai, EXAMPLE_SPEC, "t", echo).text, /fmt\.Println\(response\.Data\(\)\)[^\n]*\n    \/\/ → \{ "quality": 3, "ok": true \}\n/);
  assert.match(judgeRust(openai, EXAMPLE_SPEC, "t", echo).text, /println!\("\{:\?\}", response\.adaptations\);[^\n]*\n\/\/ → \[\{ "field": "config\.probabilities", "action": "dropped" \}\]$/);
  assert.doesNotMatch(judgeJavascript(openai, EXAMPLE_SPEC, "t").text, /\/\/ →/, "nothing is echoed before a call");
});

test("a verdict keeps the pick, the distribution where measured, the method and the adaptations; labels read as a person would", async () => {
  const request = judgeRequest(typesafe, THREE, "A ripe, long wine.");
  const jev = createClient(typesafe, "k").parseResponse(request, new HttpResponse({ status: 200, body: new TextEncoder().encode(await replyFor("https://api.typesafe.ai/v1/systemone").text()) }));
  const verdict = verdictOf(jev, { ms: 12, provider: "typesafe", model: "jev-latest", runtime: "JavaScript" });
  assert.deepEqual(verdict.data, { quality: 3, style: "fruit", ageing: true });
  assert.equal(verdict.method, "provider_classification");
  const found = judgmentsInSchema({ type: "object", properties: THREE.properties });
  const quality = found.get("quality")!, style = found.get("style")!, ageing = found.get("ageing")!;
  assert.deepEqual(distribution(quality, verdict)!.map((d) => [d.label, d.p]), [["faulty", 0], ["simple", 0], ["good", 0.1], ["excellent", 0.8], ["profound", 0.1]]);
  assert.ok(Math.abs(expectedLevel(quality, verdict)! - 3) < 1e-9);
  assert.equal(pickLabel(quality, 3), "excellent");
  assert.equal(pickLabel(ageing, true), "yes");
  assert.deepEqual(distribution(ageing, verdict)!.map((d) => d.label), ["yes", "no"]);
  assert.equal(pickLabel(style, "fruit"), "fruit");
  // A chat wire's answer: the pick only, the dropped probabilities recorded.
  const chatText = Response.fromJSON({ model: "m", message: { role: "assistant", parts: [{ type: "data", value: { quality: 2, style: "oak", ageing: false } }] }, finish_reason: "stop", adaptations: [{ field: "config.probabilities", action: "dropped", reason: "no distribution on this wire" }] } as never);
  const pick = verdictOf(chatText, { ms: 5, provider: "openai", model: "m", runtime: "Python" });
  assert.equal(pick.probabilities, undefined);
  assert.equal(distribution(quality, pick), undefined);
  assert.deepEqual(pick.adaptations, [{ field: "config.probabilities", action: "dropped", reason: "no distribution on this wire" }]);
});
