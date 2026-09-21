import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTINUATION, layout } from "../src/playground/code-view.ts";
import { api, comment, dim, finish, plain, quotedValue, replaceAll, unmarked, val } from "../src/playground/marks.ts";
import { EXAMPLE_NOTE, EXAMPLE_SPEC, judgeGo, judgeJavascript, judgePython, judgeRust, type JudgeSpec } from "../src/playground/judge.ts";
import { DEFAULT_SETTINGS, exampleConversation, exampleGo, exampleJavascript, examplePython, exampleRust, type Connection } from "../src/playground/experience.ts";

test("marks: the text is exact, the runs are where the generator put them, nesting and slips are handled", () => {
  const code = finish(`${dim(`import x; ${comment("// why")}`)}\nconst m = ${api("Message.user")}(${quotedValue('"hi \\"there\\""')});`);
  assert.equal(code.text, 'import x; // why\nconst m = Message.user("hi \\"there\\"");');
  assert.deepEqual(code.marks, [
    { start: 0, end: 10, kinds: ["dim"] },
    { start: 10, end: 16, kinds: ["dim", "comment"] },
    { start: 27, end: 39, kinds: ["api"] },
    { start: 41, end: 53, kinds: ["value"] },
  ]);
  assert.equal(plain(`${val("a")}${api("b")}`), "ab");
  assert.throws(() => finish("\u0001open"), /never closed/);
  assert.throws(() => finish("\u0005"), /close without an open/);
  assert.throws(() => unmarked("\u0001"), /mark characters/);
  assert.deepEqual(finish(""), { text: "", marks: [] });
});

test("replaceAll keeps marks in place around, over and after each replacement", () => {
  const code = finish(`key=${val("sk-secret")} again sk-secret ${api("end")}`);
  const redacted = replaceAll(code, "sk-secret", "[redacted]");
  assert.equal(redacted.text, "key=[redacted] again [redacted] end");
  assert.deepEqual(redacted.marks, [{ start: 4, end: 14, kinds: ["value"] }, { start: 32, end: 35, kinds: ["api"] }]);
  const partial = replaceAll(finish(`${val("ab")}cd`), "bc", "X");
  assert.equal(partial.text, "aXd");
  assert.deepEqual(partial.marks, [{ start: 0, end: 2, kinds: ["value"] }], "a mark cut by a replacement stretches over it, never splits a secret");
  assert.equal(replaceAll(code, "", "x"), code);
});

test("layout: one block per line, text nodes concatenate to the source, indent follows the line", () => {
  const code = finish(`${dim("import a;")}\n\n    x = ${val("1")}; ${comment("// c")}\n  ${api("two\nlines")}`);
  const lines = layout(code);
  assert.equal(lines.map((l) => l.segments.map((s) => s.text).join("")).join(""), code.text);
  assert.deepEqual(lines.map((l) => l.indent), [0, 0, 4, 2, 0]);
  assert.deepEqual(lines[2]!.segments.map((s) => [s.text, s.kinds.join("+")]), [["    x = ", ""], ["1", "value"], ["; ", ""], ["// c", "comment"], ["\n", ""]]);
  assert.deepEqual(lines[3]!.segments.map((s) => [s.text, s.kinds.join("+")]), [["  ", ""], ["two\n", "api"]], "a mark spanning lines is cut at the newline");
  assert.deepEqual(lines[4]!.segments.map((s) => [s.text, s.kinds.join("+")]), [["lines", "api"]]);
  assert.equal(CONTINUATION, 4);
  assert.deepEqual(layout(unmarked("")), [{ indent: 0, segments: [] }]);
  assert.deepEqual(layout(unmarked("a\n")).map((l) => l.segments.map((s) => s.text).join("")), ["a\n"], "a trailing newline does not add an empty line");
});

const typesafe: Connection = { provider: "typesafe", model: "jev-latest", endpoint: "" };
const openai: Connection = { provider: "openai", model: "gpt-4.1-mini", endpoint: "" };
const marked = (code: { text: string; marks: readonly { start: number; end: number; kinds: readonly string[] }[] }, kind: string) => code.marks.filter((m) => m.kinds.includes(kind)).map((m) => code.text.slice(m.start, m.end));

test("every language marks the person's values, LM15's calls and the plumbing, in Chat and in Judge", () => {
  const fields: JudgeSpec = { ...EXAMPLE_SPEC, shape: "fields" };
  const conversation: JudgeSpec = { ...EXAMPLE_SPEC, shape: "conversation" };
  const turns = [{ role: "user" as const, content: "Red?" }, { role: "assistant" as const, content: "This one." }];
  const judge = [judgeJavascript, judgePython, judgeRust, judgeGo];
  for (const render of judge) {
    for (const [spec, input] of [[EXAMPLE_SPEC, EXAMPLE_NOTE], [fields, { note: "A note.", price_eur: 48 }], [conversation, turns]] as const) {
      for (const connection of [typesafe, openai]) {
        const code = render(connection, spec, input);
        const values = marked(code, "value"), apis = marked(code, "api");
        assert.ok(values.includes(connection.model), `${render.name}: the model is a value`);
        for (const name of Object.keys(spec.properties)) assert.ok(values.includes(name), `${render.name}: the question name ${name} is a value`);
        for (const text of ["How good is this wine, according to the note?", "Faulty or unpleasant", "faulty", "Is the note written in English?"]) assert.ok(values.includes(text), `${render.name}: ${text} is a value`);
        if (typeof input === "string") assert.ok(values.includes(input), `${render.name}: the input is a value`);
        else if (Array.isArray(input)) assert.ok(values.includes("Red?") && values.includes("This one."), `${render.name}: each turn's content is a value`);
        else assert.ok(values.includes("A note.") && values.includes("48"), `${render.name}: each field is a value`);
        assert.ok(apis.some((a) => /judgments|Judgments/.test(a)) && apis.some((a) => /score|Score/.test(a)) && apis.some((a) => /complete|Complete/.test(a)), `${render.name}: judgments, score and complete are api`);
        assert.ok(apis.some((a) => /data|Data/.test(a)) && apis.some((a) => /probabilities|Probabilities/.test(a)), `${render.name}: the response accessors are api`);
        assert.ok(marked(code, "dim").length >= 1, `${render.name}: the imports are dim`);
        assert.ok(marked(code, "comment").some((c) => /MAP-14/.test(c)), `${render.name}: the MAP-14 note is a comment`);
        assert.doesNotMatch(code.text, /[\u0001-\u0008]/, "no mark character leaks into the text");
      }
    }
  }
  const settings = { ...DEFAULT_SETTINGS, maxTokens: 64, temperature: 0.2, reasoning: "low" as const };
  for (const render of [exampleJavascript, examplePython, exampleRust, exampleGo]) {
    const code = render(openai, settings, exampleConversation(), "Can you show me a tiny example?");
    const values = marked(code, "value"), apis = marked(code, "api");
    for (const text of ["gpt-4.1-mini", DEFAULT_SETTINGS.system, "What is LM15?", "Can you show me a tiny example?", "64", "0.2", "low"]) assert.ok(values.includes(text), `${render.name}: ${text} is a value`);
    if (render !== examplePython) assert.ok(values.includes("openai"), `${render.name}: the provider is a value (Python's class name carries it instead)`);
    assert.ok(apis.some((a) => /stream|Stream/.test(a)) && apis.some((a) => /user|UserMessage/.test(a)), `${render.name}: the stream and the message constructor are api`);
    assert.ok(marked(code, "dim").length >= 1 && marked(code, "comment").length >= 1, render.name);
    assert.doesNotMatch(code.text, /[\u0001-\u0008]/);
  }
  // A person's text that looks like a mark cannot become one: it is escaped on the way into the source.
  const hostile = judgeJavascript(openai, EXAMPLE_SPEC, "x\u0002y\u0006z\u0008");
  assert.match(hostile.text, /x\\u0002y\\u0006z\\b/);
});
