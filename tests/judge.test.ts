/**
 * Judge mode's rules (src/playground/judge.ts), with no DOM and no
 * network: the question form is a faithful view over the schema, the
 * request per input is the SDK's, the exports say what was measured,
 * and pasted inputs are read the way the shape says.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpResponse, Response, choice, judgmentsInSchema, score, stringifyJson, utf8Decode, yesNo } from "lm15/browser";
import { createClient, type Connection } from "../src/playground/experience.ts";
import { EXAMPLE_INPUTS, EXAMPLE_SPEC, distribution, expectedLevel, fieldValue, freeName, inputSummary, judgeJavascript, judgePython, judgeRequest, parseCsv, parseInputs, parseProperties, pickLabel, questionOf, readQuestions, specOfRequest, toCsv, toJsonExport, verdictOf, withQuestion, withoutQuestion, writeQuestion, type JudgeSpec, type Question, type Verdict } from "../src/playground/judge.ts";
import { judgeProgram } from "../src/playground/runtimes/python.ts";
import { replyFor } from "./support/replies.ts";

const typesafe: Connection = { provider: "typesafe", model: "jev-latest", endpoint: "" };
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
  const { questions, opaque } = readQuestions({ ...EXAMPLE_SPEC.properties, city: { type: "string" } });
  assert.deepEqual(questions.map((q) => q.name), ["quality", "style", "ageing"]);
  assert.deepEqual(opaque, ["city"]);
});

test("editing keeps the other questions and their order; names never collide; a blank question falls back to its name", () => {
  const properties = EXAMPLE_SPEC.properties;
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

test("one request per input, in the input's shape: a text, a data part, or the transcript; the instructions are the system text", async () => {
  const text = judgeRequest(typesafe, EXAMPLE_SPEC, EXAMPLE_INPUTS[0]!);
  assert.equal(text.system, undefined, "Jev has no system prompt: the instructions are in the state");
  assert.equal(text.config?.responseFormat?.type, "json_schema");
  assert.equal(text.config?.probabilities, "if_available");
  assert.deepEqual(text.messages.map((m) => m.parts[0]!.type), ["data"]);
  assert.equal(judgeRequest(openai, EXAMPLE_SPEC, EXAMPLE_INPUTS[0]!).system, EXAMPLE_SPEC.instructions, "a chat wire takes them as the system prompt");
  const fields: JudgeSpec = { ...EXAMPLE_SPEC, shape: "fields", fields: [{ name: "note", type: "text" }, { name: "price_eur", type: "number" }] };
  const object = judgeRequest(typesafe, { ...fields, instructions: "" }, { note: "Ripe.", price_eur: 48 });
  assert.deepEqual(object.messages[0]!.parts[0], { type: "data", value: { note: "Ripe.", price_eur: 48 } });
  const convo = judgeRequest(typesafe, { ...EXAMPLE_SPEC, shape: "conversation", instructions: "" }, [{ role: "user", content: "Red?" }, { role: "assistant", content: "Ripe." }]);
  assert.deepEqual(convo.messages.map((m) => m.role), ["user"], "one user part on Jev; the transcript is inside it");
  assert.deepEqual(judgeRequest(openai, { ...EXAMPLE_SPEC, shape: "conversation", instructions: "" }, [{ role: "user", content: "Red?" }, { role: "assistant", content: "Ripe." }]).messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(convo.system, undefined);
  // On the Jev wire (2026-09-19 D1/D4): the state is the input verbatim; the instructions a named key; a transcript the caller's own array.
  const state = async (request: typeof text) => (JSON.parse(utf8Decode((await createClient(typesafe, "k").buildRequest(request, false)).body)) as { state: unknown }).state;
  assert.deepEqual(await state(text), { instructions: EXAMPLE_SPEC.instructions, text: EXAMPLE_INPUTS[0] });
  assert.deepEqual(await state(judgeRequest(typesafe, { ...EXAMPLE_SPEC, instructions: "" }, "A wine.")), "A wine.");
  assert.deepEqual(await state(judgeRequest(typesafe, { ...fields, instructions: "" }, { note: "Ripe.", price_eur: 48 })), { note: "Ripe.", price_eur: 48 });
  assert.deepEqual(await state(convo), { messages: [{ role: "user", content: "Red?" }, { role: "assistant", content: "Ripe." }] });
  // A runtime that re-renders its program without the source reads the spec and the input back off a chat-wire request, for every shape.
  for (const [spec, value] of [[EXAMPLE_SPEC, EXAMPLE_INPUTS[1]!], [fields, { note: "Ripe.", price_eur: 48 }], [{ ...EXAMPLE_SPEC, shape: "conversation" } as JudgeSpec, [{ role: "user", content: "Red?" }, { role: "assistant", content: "Ripe." }]]] as const) {
    const back = specOfRequest(judgeRequest(openai, spec, value));
    assert.equal(back.spec.shape, spec.shape);
    assert.deepEqual(back.spec.properties, spec.properties);
    assert.deepEqual(back.value, value);
  }
});

test("the Python that executes is the Python shown, with one input: the loop body is unchanged", () => {
  const shown = judgePython(openai, EXAMPLE_SPEC, EXAMPLE_INPUTS);
  const executed = judgeProgram(openai, judgeRequest(openai, EXAMPLE_SPEC, EXAMPLE_INPUTS[1]!));
  const withoutInputs = (text: string) => text.replace(/inputs = \[[\s\S]*?\n\]\n/, "inputs = […]\n");
  assert.equal(withoutInputs(executed.split("\nimport json\n")[0]!), withoutInputs(shown));
  assert.match(executed, /inputs = \[\n    "Thin, sour, faintly oxidised\. Drink up\.",\n\]/);
  assert.match(executed, /json\.dumps\(response_to_dict\(response\)\)/);
});

test("the code spells the questions with the SDK's sugar when the sugar reproduces them, and verbatim otherwise", () => {
  const js = judgeJavascript(typesafe, EXAMPLE_SPEC, EXAMPLE_INPUTS);
  assert.match(js, /import \{ adapterFor, Message, Request, judgments, choice, score, yesNo \} from "lm15\/browser";/);
  // Long option lists go one per line; short ones stay inline.
  assert.match(js, /quality: score\("How good is this wine, according to the note\?", \{\n    faulty: "Faulty or unpleasant",\n    simple: "Simple and sound",/);
  assert.match(js, /style: choice\("What is the dominant style described\?", \{\n    fruit: "Fruit-forward",\n    oak: "Oak-driven",\n    mineral: "Mineral, savoury",\n  \}\)/);
  assert.match(judgeJavascript(openai, { ...EXAMPLE_SPEC, properties: { ok: choice("Ok?", ["yes", "no"]) } }, ["t"]), /ok: choice\("Ok\?", \["yes", "no"\]\)/);
  assert.match(js, /ageing: yesNo\("Does the note say the wine will improve with age\?"\)/);
  assert.match(js, /messages: \[Message\.user\(\{ type: "data", value: \{ instructions: "These are tasting notes[^"]*", text: input \} \}\)\]/, "on Jev the instructions ride in the state");
  assert.match(judgeJavascript(openai, EXAMPLE_SPEC, EXAMPLE_INPUTS), /messages: \[Message\.user\(input\)\]/);
  const py = judgePython(typesafe, EXAMPLE_SPEC, EXAMPLE_INPUTS);
  assert.match(py, /^from lm15 import AsyncTypeSafeLM, Config, Message, Request, choice, data, judgments, score, yes_no$/m, "data() carries the state on Jev");
  assert.match(py, /style=choice\("What is the dominant style described\?", \{\n        "fruit": "Fruit-forward",\n        "oak": "Oak-driven",\n        "mineral": "Mineral, savoury",\n    \}\)/);
  assert.match(py, /ageing=yes_no\(/);
  // Fields: a data part, and `data` imported in Python.
  const fields: JudgeSpec = { ...EXAMPLE_SPEC, shape: "fields", fields: [{ name: "note", type: "text" }] };
  assert.match(judgeJavascript(openai, fields, [{ note: "x" }]), /Message\.user\(\{ type: "data", value: input \}\)/);
  assert.match(judgePython(openai, fields, [{ note: "x" }]), /^from lm15 import .*\bdata\b.*$/m);
  assert.match(judgePython(openai, fields, [{ note: "x" }]), /Message\.user\(data\(x\)\)/);
  // Conversation: the input is the message list.
  const convo: JudgeSpec = { ...EXAMPLE_SPEC, shape: "conversation" };
  assert.match(judgeJavascript(openai, convo, [[{ role: "user", content: "a" }, { role: "assistant", content: "b" }]]), /\[Message\.user\("a"\), Message\.assistant\("b"\)\],/);
  assert.match(judgeJavascript(openai, convo, [[{ role: "user", content: "a" }]]), /messages: input,/);
  // A property outside the sugar is written as it is, in each language's literal.
  const raw: JudgeSpec = { ...EXAMPLE_SPEC, properties: { mood: { type: "string", enum: ["up", "down"], description: "Mood?", "x-note": true } } };
  assert.match(judgeJavascript(openai, raw, ["t"]), /mood: \{\n    type: "string",\n    enum: \[\n      "up",\n      "down",\n    \],\n    description: "Mood\?",\n    "x-note": true,\n  \},/);
  assert.match(judgePython(openai, raw, ["t"]), /mood=\{\n        "type": "string",[\s\S]*"x-note": True,\n    \},/);
  assert.doesNotMatch(judgeJavascript(openai, raw, ["t"]), /, choice|, score|, yesNo/);
});

test("a verdict keeps the pick, the distribution where measured, the method and the adaptations; labels read as a person would", async () => {
  const request = judgeRequest(typesafe, EXAMPLE_SPEC, "A ripe, long wine.");
  const jev = createClient(typesafe, "k").parseResponse(request, new HttpResponse({ status: 200, body: new TextEncoder().encode(await replyFor("https://api.typesafe.ai/v1/systemone").text()) }));
  const verdict = verdictOf(jev, { ms: 12, provider: "typesafe", model: "jev-latest", runtime: "JavaScript" });
  assert.deepEqual(verdict.data, { quality: 3, style: "fruit", ageing: true });
  assert.equal(verdict.method, "provider_classification");
  const found = judgmentsInSchema({ type: "object", properties: EXAMPLE_SPEC.properties });
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
  // Exports: CSV has one column per key only when something was measured; JSON carries the same facts.
  const rows: Array<{ value: string; verdict?: Verdict }> = [{ value: "A ripe, long wine.", verdict }, { value: "Thin." }];
  const csv = toCsv(EXAMPLE_SPEC, rows);
  assert.equal(csv.split("\r\n")[0], "input,quality,quality:faulty,quality:simple,quality:good,quality:excellent,quality:profound,style,style:fruit,style:oak,style:mineral,ageing,ageing:yes,ageing:no,method,provider,model,adaptations");
  assert.equal(csv.split("\r\n")[1], '"A ripe, long wine.",excellent,0,0,0.1,0.8,0.1,fruit,0.9,0.1,0,yes,0.97,0.03,provider_classification,typesafe,jev-latest,', "the input is quoted (it has a comma); 1 − 0.97 is written 0.03, not float noise");
  assert.equal(csv.split("\r\n")[2], "Thin.,,,,,,,,,,,,,,,,,");
  assert.equal(toCsv(EXAMPLE_SPEC, [{ value: 'say "hi", twice', verdict: pick }]).split("\r\n")[0], "input,quality,style,ageing,method,provider,model,adaptations");
  assert.match(toCsv(EXAMPLE_SPEC, [{ value: 'say "hi", twice', verdict: pick }]), /^"say ""hi"", twice",good,oak,no,,openai,m,config\.probabilities dropped\r\n$/m);
  const json = JSON.parse(toJsonExport(EXAMPLE_SPEC, rows)) as { results: Array<{ input: string; data?: unknown; method?: string }> };
  assert.equal(json.results[0]!.method, "provider_classification");
  assert.equal(json.results[1]!.data, undefined);
});

test("pasted inputs are read the way the shape says: lines, CSV with a header, JSON arrays; a wrong item is named", () => {
  assert.deepEqual(parseInputs("text", " a \n\nb\n", []), ["a", "b"]);
  const fields = [{ name: "note", type: "text" }, { name: "price_eur", type: "number" }, { name: "tags", type: "json" }] as const;
  assert.deepEqual(parseCsv('note,price_eur,tags\n"Ripe, long",48,"[""red""]"\nThin,,\n', fields), [{ note: "Ripe, long", price_eur: 48, tags: ["red"] }, { note: "Thin", price_eur: null, tags: null }]);
  assert.throws(() => parseCsv("note\nx\n", fields), /no "price_eur" column/);
  assert.throws(() => parseCsv("note,price_eur,tags\nx,abc,\n", fields), /Row 1: price_eur: not a number/);
  assert.deepEqual(parseInputs("fields", '[{"note": "x", "price_eur": 1, "extra": true}]', fields), [{ note: "x", price_eur: 1, tags: null }]);
  assert.throws(() => parseInputs("fields", "[1]", fields), /Item 1 is not an object/);
  assert.deepEqual(parseInputs("conversation", '[{"messages": [{"role": "user", "content": "a"}]}, [{"role": "assistant", "content": "b"}]]', []), [[{ role: "user", content: "a" }], [{ role: "assistant", content: "b" }]]);
  assert.throws(() => parseInputs("conversation", '[{"messages": [{"role": "system", "content": "a"}]}]', []), /Item 1, turn 1/);
  assert.throws(() => parseInputs("conversation", "[]", []), /JSON array/);
  assert.equal(fieldValue({ name: "n", type: "number" }, " 3.5 "), 3.5);
  assert.equal(fieldValue({ name: "n", type: "number" }, ""), null);
  assert.deepEqual(fieldValue({ name: "j", type: "json" }, '{"a": 1}'), { a: 1 });
  assert.equal(inputSummary({ note: "x", price_eur: 3 }), "note: x · price_eur: 3");
  assert.equal(inputSummary([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]), "user: a ▸ assistant: b");
});
