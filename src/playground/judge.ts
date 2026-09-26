/**
 * Judge mode: one state, one question set, one call (MAP-14).
 *
 * The question set is the JSON Schema `properties` object that
 * `judgments({...})` takes — the SDK's own contract, kept verbatim. The
 * form in the page is a view over it: it reads questions with the SDK's
 * `judgmentsInSchema` and writes them back with the SDK's `choice`,
 * `yesNo` and `score`, so nothing here invents a second schema format.
 *
 * The state has a shape — a text, a JSON object, or a conversation —
 * because Jev reads all three (contract D6: a string, a data part's value,
 * or `{messages}`), and a question can point at a piece of a structured
 * state with backticks (`` `note` ``, `` `messages[1].content` ``). The
 * same request goes to any chat provider, which answers the pick without
 * the numbers.
 *
 * The rendered code is what runs (runtimes/): the JavaScript is this
 * page's client, the Python executes under Pyodide as shown. Nothing here
 * touches the DOM or the network.
 */

import { Message, RawNumber, Request as RequestNs, choice, isJsonObject, judgments, judgmentsInSchema, parseJson, score, stringifyJson, yesNo, type Config, type Judgment, type JsonObject, type JsonValue, type Request, type Response } from "@lm15/lm15/browser";
import { GO_ERR, goProgram, jsClient, judgmentsOnly, pyClient, pyImports, rustClient, rustString, rv, type Connection } from "./experience.ts";
import { api, comment, dim, finish, group, mark, plain, quotedValue, val, type Code } from "./marks.ts";

export type Shape = "text" | "fields" | "conversation";
export interface Turn { readonly role: "user" | "assistant"; readonly content: string }
/** The state, in the set's shape: a text, a JSON object, or a transcript. */
export type StateValue = string | Readonly<Record<string, JsonValue>> | readonly Turn[];

export interface JudgeSpec {
  /** The `properties` of the judgments schema, verbatim (what `judgments(...)` takes). */
  readonly properties: JsonObject;
  readonly shape: Shape;
}

// ─── The question form: a view over the schema ───────────────────────

export type QuestionKind = "yesNo" | "choice" | "score";
export interface Option { readonly key: string; readonly description: string }
export interface Question {
  readonly name: string;
  readonly kind: QuestionKind;
  readonly question: string;
  /** `choice`: option keys with an optional description. `score`: levels low → high; `key` is the level's title (may be empty when the level has only a description). */
  readonly options: readonly Option[];
}

/** What `judgmentsInSchema` reads off a property, as the form shows it. */
export function questionOf(j: Judgment): Question {
  if (j.kind === "boolean") return { name: j.name, kind: "yesNo", question: j.instruction ?? "", options: [] };
  if (j.kind === "choice") return { name: j.name, kind: "choice", question: j.instruction ?? "", options: j.keys.map((key) => ({ key, description: j.descriptions[key] ?? "" })) };
  return { name: j.name, kind: "score", question: j.instruction ?? "", options: j.keys.map((key) => ({ key: j.titles[key] ?? "", description: j.descriptions[key] ?? "" })) };
}

/** The questions the form can show, and the property names it cannot (kept verbatim in the schema, editable as JSON). */
export function readQuestions(properties: JsonObject): { questions: Question[]; opaque: string[] } {
  const found = judgmentsInSchema({ type: "object", properties });
  return { questions: [...found.values()].map(questionOf), opaque: Object.keys(properties).filter((name) => !found.has(name)) };
}

/** The property a question writes: the SDK's own sugar, so the schema is exactly what `choice`/`yesNo`/`score` emit. */
export function writeQuestion(q: Question): JsonObject {
  const question = q.question.trim() || q.name;
  if (q.kind === "yesNo") return yesNo(question);
  if (q.kind === "choice") {
    const options = q.options.filter((o) => o.key.trim());
    return options.some((o) => o.description.trim()) ? choice(question, Object.fromEntries(options.map((o) => [o.key.trim(), o.description.trim() || null]))) : choice(question, options.map((o) => o.key.trim()));
  }
  const levels = q.options.filter((o) => o.key.trim() || o.description.trim());
  if (levels.every((o) => o.key.trim())) return score(question, Object.fromEntries(levels.map((o) => [o.key.trim(), o.description.trim()])));
  if (levels.every((o) => !o.key.trim())) return score(question, levels.map((o) => o.description.trim()));
  // A level with a description but no title has no sugar spelling: the schema branch says it directly.
  return { type: "integer", description: question, anyOf: levels.map((o, i) => ({ const: i, ...(o.key.trim() ? { title: o.key.trim() } : {}), ...(o.description.trim() ? { description: o.description.trim() } : {}) })) };
}

/** Replace (or append) one property, keeping the others and their order. */
export function withQuestion(properties: JsonObject, previousName: string | undefined, q: Question): JsonObject {
  const out: JsonObject = {};
  let placed = false;
  for (const [name, prop] of Object.entries(properties)) {
    if (name === previousName) { out[q.name] = writeQuestion(q); placed = true; }
    else if (name !== q.name) out[name] = prop;
  }
  if (!placed) out[q.name] = writeQuestion(q);
  return out;
}

export function withoutQuestion(properties: JsonObject, name: string): JsonObject {
  return Object.fromEntries(Object.entries(properties).filter(([k]) => k !== name));
}

/** A property name that is not taken: `flag`, `flag_2`, … */
export function freeName(properties: JsonObject, base: string): string {
  if (!(base in properties)) return base;
  for (let i = 2; ; i++) if (!(`${base}_${i}` in properties)) return `${base}_${i}`;
}

/** The properties text a person typed, validated the way the request builder will: an object with at least one judgment. */
export function parseProperties(text: string): JsonObject {
  let value: unknown;
  try { value = parseJson(text); } catch (e) { throw new Error(`Questions must be a JSON object of properties: ${(e as Error).message}`); }
  if (!isJsonObject(value) || Object.keys(value).length === 0) throw new Error("Questions must be a JSON object with at least one property.");
  if (judgmentsInSchema({ type: "object", properties: value }).size === 0) throw new Error("No property declares a judgment: use a string enum, an anyOf of const values, integer levels 0..n-1, or a boolean (MAP-14).");
  return value;
}

// ─── The state ───────────────────────────────────────────────────────

export function emptyState(shape: Shape): StateValue {
  if (shape === "text") return "";
  if (shape === "fields") return {};
  return [{ role: "user", content: "" }];
}

export function stateIsBlank(value: StateValue): boolean {
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return (value as readonly Turn[]).every((t) => !t.content.trim());
  return Object.keys(value as Record<string, JsonValue>).length === 0;
}

/** The JSON object a person typed for a `fields` state, validated: an object, nothing else. */
export function parseStateObject(text: string): Readonly<Record<string, JsonValue>> {
  let value: unknown;
  try { value = parseJson(text); } catch (e) { throw new Error(`The state must be a JSON object: ${(e as Error).message}`); }
  if (!isJsonObject(value)) throw new Error("The state must be a JSON object ({ … }).");
  return value;
}

// ─── The request ─────────────────────────────────────────────────────

/**
 * Jev's state (changes/2026-09-19-jev-state.md D1): the one user part,
 * verbatim. Jev has no conversation, so a transcript goes as the caller's
 * own `messages` array. The shown code does exactly this; no adapter does anything.
 */
export function jevState(value: StateValue): JsonValue {
  if (Array.isArray(value)) return { messages: (value as readonly Turn[]).map((t) => ({ role: t.role, content: t.content })) };
  return value as JsonValue;
}

/** The messages the state makes: on Jev the one user part holding it; on a chat wire the text, the data part, or the transcript. */
export function judgeMessages(connection: Connection, value: StateValue): Message[] {
  if (judgmentsOnly(connection.provider)) {
    const state = jevState(value);
    return [typeof state === "string" ? Message.user(state) : Message.user({ type: "data", value: state })];
  }
  if (typeof value === "string") return [Message.user(value)];
  if (Array.isArray(value)) return (value as readonly Turn[]).map((t) => t.role === "user" ? Message.user(t.content) : Message.assistant(t.content));
  return [Message.user({ type: "data", value: value as Record<string, JsonValue> })];
}

/** The one Request: the state's messages, the declared judgments, probabilities if the wire measures them. */
export function judgeRequest(connection: Connection, spec: JudgeSpec, value: StateValue): Request {
  const config: Config = { responseFormat: judgments(parseProperties(stringifyJson(spec.properties)) as Record<string, JsonObject>), probabilities: "if_available" };
  return RequestNs.create({ model: connection.model.trim(), messages: judgeMessages(connection, value), config });
}

/** What the page executed a judge request from: the spec and the state. Runtimes that re-render the shown program take it beside the request. */
export interface JudgeSource { readonly spec: JudgeSpec; readonly value: StateValue }

/** A judge request: a json_schema response format declaring at least one judgment. It is sent with `complete`, never streamed. */
export function isJudgeRequest(request: Request): boolean {
  const format = request.config?.responseFormat;
  return format?.type === "json_schema" && judgmentsInSchema(format.schema).size > 0;
}

/**
 * The spec and state a chat-wire judge Request carries, read back off it —
 * the fallback for a runtime that re-renders its program without a
 * JudgeSource (runtimes/python.ts). A Jev request is not read back: its
 * state is the caller's object and the page passes the source instead.
 */
export function specOfRequest(request: Request): JudgeSource {
  const format = request.config?.responseFormat;
  if (format?.type !== "json_schema" || !isJsonObject(format.schema["properties"])) throw new Error("Not a judge request: no judgments schema.");
  const properties = format.schema["properties"];
  const parts = request.messages[0]?.parts ?? [];
  if (request.messages.length === 1 && request.messages[0]!.role === "user" && parts.length === 1 && parts[0]!.type === "data" && isJsonObject(parts[0]!.value)) {
    return { spec: { properties, shape: "fields" }, value: parts[0]!.value };
  }
  if (request.messages.length === 1 && request.messages[0]!.role === "user" && parts.length === 1 && parts[0]!.type === "text") {
    return { spec: { properties, shape: "text" }, value: parts[0]!.text };
  }
  const turns: Turn[] = request.messages.map((m) => {
    const text = m.parts.map((p) => p.type === "text" ? p.text : "").join("");
    if (m.role !== "user" && m.role !== "assistant") throw new Error(`Not a judge conversation: a ${m.role} message.`);
    return { role: m.role, content: text };
  });
  return { spec: { properties, shape: "conversation" }, value: turns };
}

// ─── Results ─────────────────────────────────────────────────────────

/** What the page keeps of a response: the pick per judgment, the distribution where measured, and the facts around them. */
export interface Verdict {
  readonly data: Readonly<Record<string, JsonValue>>;
  readonly probabilities?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly method?: string;
  readonly adaptations: ReadonlyArray<{ readonly field: string; readonly action: string; readonly reason: string }>;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly ms: number;
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
}

export function verdictOf(response: Response, facts: { ms: number; provider: string; model: string; runtime: string }): Verdict {
  const data = response.data;
  if (!isJsonObject(data)) throw new Error("The answer is not a JSON object of judgments.");
  const part = response.dataPart;
  return {
    data,
    ...(part?.probabilities ? { probabilities: part.probabilities } : {}),
    ...(part?.method ? { method: part.method } : {}),
    adaptations: response.adaptations.map((a) => ({ field: a.field, action: a.action, reason: a.reason })),
    ...(response.usage?.inputTokens !== undefined ? { inputTokens: response.usage.inputTokens } : {}),
    ...(response.usage?.outputTokens !== undefined ? { outputTokens: response.usage.outputTokens } : {}),
    ...facts,
  };
}

/** The distribution of one judgment in the order its keys were declared, with the label a person reads for each key. */
export function distribution(j: Judgment, verdict: Verdict): Array<{ key: string; label: string; p: number }> | undefined {
  const dist = verdict.probabilities?.[j.name];
  if (!dist) return undefined;
  return j.keys.map((key) => ({ key, label: keyLabel(j, key), p: dist[key] ?? 0 }));
}

export function keyLabel(j: Judgment, key: string): string {
  if (j.kind === "boolean") return key === "true" ? "yes" : "no";
  if (j.kind === "ordered") return j.titles[key] || j.descriptions[key] || key;
  return key;
}

/** The label of the picked value: `true` → yes, an ordered level → its title. */
export function pickLabel(j: Judgment, value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "—";
  if (j.kind === "boolean") return value === true ? "yes" : value === false ? "no" : String(value);
  return keyLabel(j, String(value));
}

export function expectedLevel(j: Judgment, verdict: Verdict): number | undefined {
  if (j.kind !== "ordered") return undefined;
  const dist = verdict.probabilities?.[j.name];
  if (!dist) return undefined;
  return j.keys.reduce((sum, key, i) => sum + (dist[key] ?? 0) * i, 0);
}

// ─── Code ────────────────────────────────────────────────────────────
//
// Each program is written with its meaning marked (marks.ts): the
// person's questions, options and inputs as values, LM15's calls as api.

const q = JSON.stringify;
const qv = (text: string, source?: string): string => quotedValue(q(text), source);
const nv = (n: number): string => val(String(n));

/** The question the SDK's sugar spells, when the sugar reproduces the property exactly (MAP-14 §4 is one convention in every language); otherwise the schema goes verbatim. */
function sugarQuestion(name: string, prop: JsonValue): Question | undefined {
  const found = judgmentsInSchema({ type: "object", properties: { [name]: prop } }).get(name);
  if (!found) return undefined;
  const question = questionOf(found);
  return stringifyJson(writeQuestion(question)) === stringifyJson(prop) ? question : undefined;
}

/** A property spelled with the SDK's sugar when the sugar reproduces it exactly; otherwise the schema verbatim. */
function sugar(name: string, prop: JsonValue, lang: "javascript" | "python"): string | undefined {
  const question = sugarQuestion(name, prop);
  if (!question) return undefined;
  const text = qv(question.question.trim() || name);
  const py = lang === "python";
  if (question.kind === "yesNo") return `${api(py ? "yes_no" : "yesNo")}(${text})`;
  const key = (k: string) => (py ? qv(k) : val(identifier(k)));
  // Short option lists stay on one line; longer ones go one per line, so the copied program reads as a person would write it.
  const pad = py ? "    " : "  ";
  const block = (open: string, items: string[], close: string) => {
    const inline = `${open}${items.join(", ")}${close}`;
    return plain(inline).length + plain(text).length < 72 ? inline : `${open}\n${items.map((i) => `${pad}${pad}${i},`).join("\n")}\n${pad}${close}`;
  };
  if (question.kind === "choice") {
    if (question.options.every((o) => !o.description)) return `${api("choice")}(${text}, ${block("[", question.options.map((o) => qv(o.key)), "]")})`;
    const entries = question.options.map((o) => `${key(o.key)}: ${o.description ? qv(o.description) : py ? "None" : "null"}`);
    return `${api("choice")}(${text}, ${block("{", entries, "}")})`;
  }
  if (question.options.every((o) => !o.key)) return `${api("score")}(${text}, ${block("[", question.options.map((o) => qv(o.description)), "]")})`;
  const entries = question.options.map((o) => `${key(o.key)}: ${qv(o.description)}`);
  return `${api("score")}(${text}, ${block("{", entries, "}")})`;
}

function identifier(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : q(key);
}

/** Python spelling of a JSON value. `values`: the leaves are the person's (an input); otherwise verbatim (a schema). */
function pyLiteral(value: JsonValue, level: number, values = false): string {
  const pad = "    ".repeat(level), inner = "    ".repeat(level + 1);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return values ? nv(value) : String(value);
  if (typeof value === "string") return values ? qv(value) : q(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + pyLiteral(v, level + 1, values)).join(",\n")},\n${pad}]` : "[]";
  const entries = Object.entries(value as Record<string, JsonValue>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${inner}${q(k)}: ${pyLiteral(v, level + 1, values)}`).join(",\n")},\n${pad}}` : "{}";
}

function jsLiteral(value: JsonValue, level: number, values = false): string {
  const pad = "  ".repeat(level), inner = "  ".repeat(level + 1);
  if (typeof value === "string") return values ? qv(value) : q(value);
  if (typeof value === "number") return values ? nv(value) : String(value);
  if (typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + jsLiteral(v, level + 1, values)).join(",\n")},\n${pad}]` : "[]";
  const entries = Object.entries(value as Record<string, JsonValue>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${inner}${identifier(k)}: ${jsLiteral(v, level + 1, values)}`).join(",\n")},\n${pad}}` : "{}";
}

/** The `judgments({...})` argument: sugar per property, and which sugar names it uses. */
function questionsCode(spec: JudgeSpec, lang: "javascript" | "python"): { lines: string[]; uses: Set<string> } {
  const uses = new Set<string>();
  const lines: string[] = [];
  const pad = lang === "python" ? "    " : "  ";
  const sep = lang === "python" ? "=" : ": ";
  for (const [name, prop] of Object.entries(spec.properties)) {
    const call = sugar(name, prop, lang);
    const key = val(lang === "python" ? name : identifier(name));
    if (call) { uses.add(plain(call).slice(0, plain(call).indexOf("("))); lines.push(`${pad}${group(`${key}${sep}${call}`, questionSource(name))},`); }
    else lines.push(`${pad}${group(`${key}${sep}${lang === "python" ? pyLiteral(prop, 1) : jsLiteral(prop, 1)}`, questionSource(name))},`);
  }
  return { lines, uses };
}

/** A transcript as the plain objects Jev reads: the roles are structure, the contents the person's. */
function turnsLiteral(turns: readonly Turn[], level: number, lang: "javascript" | "python"): string {
  const unit = lang === "python" ? "    " : "  ";
  const pad = unit.repeat(level), inner = unit.repeat(level + 1);
  const turn = (t: Turn) => (lang === "python" ? `{"role": ${q(t.role)}, "content": ${qv(t.content)}}` : `{ role: ${q(t.role)}, content: ${qv(t.content)} }`);
  return `[\n${turns.map((t) => `${inner}${turn(t)}`).join(",\n")},\n${pad}]`;
}

function jsState(value: StateValue, level: number, jev: boolean): string {
  if (typeof value === "string") return qv(value);
  if (Array.isArray(value)) {
    const turns = value as readonly Turn[];
    return jev ? turnsLiteral(turns, level, "javascript") : `[\n${turns.map((t) => `  ${api(`Message.${t.role}`)}(${qv(t.content)}),`).join("\n")}\n]`;
  }
  return jsLiteral(value as JsonValue, level, true);
}

function pyState(value: StateValue, level: number, jev: boolean): string {
  if (typeof value === "string") return qv(value);
  if (Array.isArray(value)) {
    const turns = value as readonly Turn[];
    return jev ? turnsLiteral(turns, level, "python") : `[\n${turns.map((t) => `    ${api(`Message.${t.role}`)}(${qv(t.content)}),`).join("\n")}\n]`;
  }
  return pyLiteral(value as JsonValue, level, true);
}

const SHAPE_NOTE: Record<Shape, string> = {
  text: "The state: a text",
  fields: "The state: an object. Jev reads it as structured state, and a question can point at a field with backticks; a chat wire gets it as JSON text",
  conversation: "The state: a conversation. Jev takes it as the state's `messages` array, and a question can point at a turn (`messages[1].content`); a chat wire gets the turns as its conversation",
};
const DATA_NOTE = "the picked key per judgment";
const PROBABILITIES_NOTE = "one distribution per judgment where the provider measures one; else %s and recorded";
const ADAPTATIONS_NOTE = "MAP-13: what this wire could not take as asked";
/** The source names the panel lights: the state, each question by name, the echoed result. */
export const STATE_SOURCE = "state";
export const RESULT_SOURCE = "result";
export const questionSource = (name: string): string => `question:${name}`;

/** What the call answered, echoed under the program as comments (like a REPL), three significant digits for a probability. */
export interface Echo { readonly data: Readonly<Record<string, JsonValue>>; readonly probabilities?: Readonly<Record<string, Readonly<Record<string, number>>>>; readonly adaptations: ReadonlyArray<{ readonly field: string; readonly action: string }> }
function tidy(value: JsonValue): JsonValue {
  if (typeof value === "number") return Number(value.toPrecision(3));
  if (Array.isArray(value)) return value.map(tidy);
  if (isJsonObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tidy(v)]));
  return value;
}
/** One echoed value in the language's own spelling of what `print` shows: a JS literal, a Python repr, JSON for Go and Rust. */
function echoValue(value: JsonValue | undefined, lang: "javascript" | "python" | "go" | "rust"): string {
  if (value === undefined) return lang === "python" ? "None" : lang === "go" ? "map[]" : lang === "rust" ? "None" : "undefined";
  const walk = (v: JsonValue): string => {
    if (v === null) return lang === "python" ? "None" : "null";
    if (typeof v === "boolean") return lang === "python" ? (v ? "True" : "False") : String(v);
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return lang === "python" ? `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'` : q(v);
    if (Array.isArray(v)) return v.length ? `[${v.map(walk).join(", ")}]` : "[]";
    const entries = Object.entries(v as Record<string, JsonValue>);
    if (!entries.length) return "{}";
    const key = (k: string) => (lang === "javascript" ? (/^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k)) : lang === "python" ? `'${k}'` : q(k));
    return `{ ${entries.map(([k, x]) => `${key(k)}: ${walk(x)}`).join(", ")} }`;
  };
  return walk(tidy(value));
}
function echoLines(echo: Echo | undefined, lang: "javascript" | "python" | "go" | "rust", lead: string): [string[], string[], string[]] {
  if (!echo) return [[], [], []];
  const line = (text: string) => mark("comment", `${lead} → ${text}`, RESULT_SOURCE);
  return [[line(echoValue(echo.data as JsonValue, lang))], [line(echoValue(echo.probabilities as JsonValue | undefined, lang))], [line(echoValue(echo.adaptations.map((a) => ({ field: a.field, action: a.action })), lang))]];
}

/** The JavaScript of one call: this page's client, loaded as `lm15/browser`. */
export function judgeJavascript(connection: Connection, spec: JudgeSpec, value: StateValue, echo?: Echo): Code {
  const { lines: questionLines, uses } = questionsCode(spec, "javascript");
  const imports = [connection.provider === "custom" ? "OpenAIChatLM" : "adapterFor", ...(connection.provider === "anthropic" ? ["access"] : []), "Message", "Request", "judgments", ...[...uses].sort()];
  const jev = judgmentsOnly(connection.provider);
  const lines = [dim(`import { ${imports.join(", ")} } from "@lm15/lm15/browser";`), "", ...jsClient(connection), `const model = ${qv(connection.model, "model")};`];
  lines.push("", comment(`// ${SHAPE_NOTE[spec.shape]}.`), `const state = ${group(jsState(value, 0, jev), STATE_SOURCE)};`, "");
  lines.push(comment("// Declared keys in, a distribution out (MAP-14)."), `const questions = ${api("judgments")}({`, ...questionLines, "});", "");
  const messages = jev
    ? (spec.shape === "text" ? `[${api("Message.user")}(state)]` : spec.shape === "fields" ? `[${api("Message.user")}({ type: "data", value: state })]` : `[${api("Message.user")}({ type: "data", value: { messages: state } })]`)
    : (spec.shape === "conversation" ? "state" : spec.shape === "fields" ? `[${api("Message.user")}({ type: "data", value: state })]` : `[${api("Message.user")}(state)]`);
  const [data, probabilities, adaptations] = echoLines(echo, "javascript", "//");
  lines.push(`const request = ${api("Request.create")}({`, "  model,", `  messages: ${messages},`, `  config: { responseFormat: questions, probabilities: ${api('"if_available"')} },`, "});",
    `const response = await ${api("lm.complete")}(request);`,
    `console.log(${api("response.data")}); ${comment(`// ${DATA_NOTE}`)}`, ...data,
    `console.log(${api("response.probabilities")}); ${comment(`// ${PROBABILITIES_NOTE.replace("%s", "absent")}`)}`, ...probabilities,
    `console.log(${api("response.adaptations")}); ${comment(`// ${ADAPTATIONS_NOTE}`)}`, ...adaptations);
  return finish(lines.join("\n"));
}

/** The Python of the same call: under Pyodide in this page, on CPython without the transport line. */
export function judgePython(connection: Connection, spec: JudgeSpec, value: StateValue, echo?: Echo): Code {
  const client = pyClient(connection);
  const { lines: questionLines, uses } = questionsCode(spec, "python");
  const jev = judgmentsOnly(connection.provider);
  const usesData = spec.shape === "fields" || (jev && spec.shape === "conversation");
  const lines = pyImports([client.cls, "Config", "Message", "Request", "judgments", ...(usesData ? ["data"] : []), ...uses], connection);
  lines.push("", ...client.lines, `model = ${qv(connection.model, "model")}`, "", comment(`# ${SHAPE_NOTE[spec.shape]}.`), `state = ${group(pyState(value, 0, jev), STATE_SOURCE)}`, "");
  lines.push(comment("# Declared keys in, a distribution out (MAP-14)."), `questions = ${api("judgments")}(`, ...questionLines, ")", "");
  const messages = jev
    ? (spec.shape === "text" ? `[${api("Message.user")}(state)]` : spec.shape === "fields" ? `[${api("Message.user")}(${api("data")}(state))]` : `[${api("Message.user")}(${api("data")}({"messages": state}))]`)
    : (spec.shape === "conversation" ? "state" : spec.shape === "fields" ? `[${api("Message.user")}(${api("data")}(state))]` : `[${api("Message.user")}(state)]`);
  const [data, probabilities, adaptations] = echoLines(echo, "python", "#");
  lines.push(`request = ${api("Request")}(`, "    model=model,", `    messages=${messages},`, `    config=${api("Config")}(response_format=questions, probabilities=${api('"if_available"')}),`, ")",
    `response = await ${api("lm.complete")}(request)`,
    `print(${api("response.data")})  ${comment(`# ${DATA_NOTE}`)}`, ...data,
    `print(${api("response.probabilities")})  ${comment(`# ${PROBABILITIES_NOTE.replace("%s", "None")}`)}`, ...probabilities,
    `print(${api("response.adaptations")})  ${comment(`# ${ADAPTATIONS_NOTE}`)}`, ...adaptations);
  return finish(lines.join("\n"));
}

// ─── Go ──────────────────────────────────────────────────────────────

/** A Go literal of a JSON value: `lm15.JSONObject` (ordered `lm15.KV` members) for objects, `[]any` for arrays, `nil` for null. `values`: the leaves are the person's. */
function goJson(value: JsonValue, level: number, values = false): string {
  const pad = "    ".repeat(level), inner = "    ".repeat(level + 1);
  if (value === null) return "nil";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return values ? nv(value) : String(value);
  if (typeof value === "string") return values ? qv(value) : q(value);
  if (value instanceof RawNumber) return value.raw;
  if (Array.isArray(value)) return value.length ? `[]any{\n${value.map((v) => `${inner}${goJson(v, level + 1, values)},`).join("\n")}\n${pad}}` : "[]any{}";
  const entries = Object.entries(value as Record<string, JsonValue>);
  return entries.length ? `lm15.JSONObject{\n${entries.map(([k, v]) => `${inner}lm15.KV(${q(k)}, ${goJson(v, level + 1, values)}),`).join("\n")}\n${pad}}` : "lm15.JSONObject{}";
}

const GO_RESERVED = new Set(["break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var", "lm", "lm15", "ctx", "cancel", "err", "questions", "state", "request", "response", "main", "run"]);

/** One Go variable per question, named after it: `quality`, `is_good` → `isGood`, anything unspellable → `question1`. */
function goIdentifiers(names: readonly string[]): string[] {
  const taken = new Set(GO_RESERVED);
  return names.map((name, i) => {
    const camel = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^[0-9]+/, "");
    let candidate = /^[A-Za-z_]\w*$/.test(camel) && !taken.has(camel) ? camel : `question${i + 1}`;
    for (let n = 2; taken.has(candidate); n++) candidate = `${camel || "question"}${n}`;
    taken.add(candidate);
    return candidate;
  });
}

/** The Go of the same call: the SDK's sugar for each question, one request, `Complete` (never streamed). */
export function judgeGo(connection: Connection, spec: JudgeSpec, value: StateValue, echo?: Echo): Code {
  const jev = judgmentsOnly(connection.provider);
  // The state first, as on the page; typed by shape: a text, an object, or a transcript (Jev takes a transcript as its own `messages` array).
  const body: string[] = [`    ${comment(`// ${SHAPE_NOTE[spec.shape]}.`)}`];
  if (spec.shape === "text") body.push(`    state := ${group(qv(value as string), STATE_SOURCE)}`);
  else if (spec.shape === "fields") body.push(`    state := ${group(goJson(value as JsonValue, 1, true), STATE_SOURCE)}`);
  else if (jev) body.push(`    state := ${group(`[]lm15.JSONObject{\n${(value as readonly Turn[]).map((t) => `        {lm15.KV("role", ${q(t.role)}), lm15.KV("content", ${qv(t.content)})},`).join("\n")}\n    }`, STATE_SOURCE)}`);
  else body.push(`    state := ${group(`[]lm15.Message{\n${(value as readonly Turn[]).map((t) => `        ${api(t.role === "user" ? "lm15.UserMessage" : "lm15.AssistantText")}(${qv(t.content)}),`).join("\n")}\n    }`, STATE_SOURCE)}`);
  body.push("", `    ${comment("// Declared keys in, a distribution out (MAP-14).")}`);
  const entries = Object.entries(spec.properties);
  const names = goIdentifiers(entries.map(([name]) => name));
  const properties: string[] = [];
  entries.forEach(([name, prop], i) => {
    const question = sugarQuestion(name, prop);
    const text = qv(question?.question.trim() || name);
    const source = questionSource(name);
    if (!question) { properties.push(group(`${api("lm15.JudgmentProperty")}{Name: ${qv(name)}, Schema: ${goJson(prop, 2)}}`, source)); return; }
    if (question.kind === "yesNo") { properties.push(group(`${api("lm15.JudgmentProperty")}{Name: ${qv(name)}, Schema: ${api("lm15.YesNo")}(${text})}`, source)); return; }
    properties.push(group(`${api("lm15.JudgmentProperty")}{Name: ${qv(name)}, Schema: ${names[i]}}`, source));
    const declared: string[] = [];
    if (question.kind === "choice") {
      if (question.options.every((o) => !o.description)) declared.push(`    ${names[i]}, err := ${api("lm15.Choice")}(${text}, ${api("lm15.Options")}(${question.options.map((o) => qv(o.key)).join(", ")})...)`);
      else declared.push(`    ${names[i]}, err := ${api("lm15.Choice")}(${text},`, ...question.options.map((o) => `        ${api("lm15.ChoiceOption")}{Key: ${qv(o.key)}${o.description ? `, Description: ${qv(o.description)}` : ""}},`), "    )");
    } else {
      declared.push(`    ${names[i]}, err := ${api("lm15.Score")}(${text}, ${comment("// levels, worst to best")}`, ...question.options.map((o) => `        ${api("lm15.ScoreLevel")}{${[...(o.key ? [`Name: ${qv(o.key)}`] : []), ...(o.description ? [`Description: ${qv(o.description)}`] : [])].join(", ")}},`), "    )");
    }
    body.push(group(declared.join("\n"), source), GO_ERR);
  });
  body.push(`    questions, err := ${api("lm15.Judgments")}("judgments", true,`, ...properties.map((p) => `        ${p},`), "    )", GO_ERR);
  const messages = jev
    ? (spec.shape === "text" ? `[]lm15.Message{${api("lm15.UserMessage")}(state)}` : spec.shape === "fields" ? `[]lm15.Message{${api("lm15.UserParts")}(${api("lm15.Data")}(state))}` : `[]lm15.Message{${api("lm15.UserParts")}(${api("lm15.Data")}(lm15.JSONObject{lm15.KV("messages", state)}))}`)
    : (spec.shape === "conversation" ? "state" : spec.shape === "fields" ? `[]lm15.Message{${api("lm15.UserParts")}(${api("lm15.Data")}(state))}` : `[]lm15.Message{${api("lm15.UserMessage")}(state)}`);
  const [data, probabilities, adaptations] = echoLines(echo, "go", "    //");
  body.push("", `    request, err := ${api("lm15.NewRequest")}(`, `        ${qv(connection.model, "model")},`, `        ${messages},`, `        ${api("lm15.WithConfig")}(${api("lm15.Config")}{ResponseFormat: questions, Probabilities: ${api("lm15.ProbabilitiesIfAvailable")}}),`, "    )", GO_ERR,
    `    response, err := ${api("lm.Complete")}(ctx, request)`, GO_ERR,
    `    fmt.Println(${api("response.Data")}())          ${comment(`// ${DATA_NOTE}`)}`, ...data,
    `    fmt.Println(${api("response.Probabilities")}()) ${comment(`// ${PROBABILITIES_NOTE.replace("%s", "nil")}`)}`, ...probabilities,
    `    fmt.Println(${api("response.Adaptations")})     ${comment(`// ${ADAPTATIONS_NOTE}`)}`, ...adaptations);
  return goProgram(connection, ["fmt"], body);
}

// ─── Rust ────────────────────────────────────────────────────────────

/** A `serde_json::json!` literal of a JSON value, laid out as a person would write it. `values`: the leaves are the person's. */
function rustJson(value: JsonValue, level: number, values = false): string {
  const pad = "    ".repeat(level), inner = "    ".repeat(level + 1);
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "number") return values ? nv(value) : String(value);
  if (typeof value === "string") return values ? rv(value) : rustString(value);
  if (value instanceof RawNumber) return value.raw;
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => `${inner}${rustJson(v, level + 1, values)},`).join("\n")}\n${pad}]` : "[]";
  const entries = Object.entries(value as Record<string, JsonValue>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${inner}${rustString(k)}: ${rustJson(v, level + 1, values)},`).join("\n")}\n${pad}}` : "{}";
}

/** rustfmt's order inside a `use` list: functions (snake_case) before types. */
function rustUseOrder(names: Iterable<string>): string[] {
  return [...names].sort((a, b) => (/^[a-z]/.test(a) === /^[a-z]/.test(b) ? a.localeCompare(b) : /^[a-z]/.test(a) ? -1 : 1));
}

/** Rust's `[(a, b), ...]` of an option list, one per line when it would not fit. */
function rustPairs(pairs: readonly string[], level: number): string {
  const inline = `[${pairs.join(", ")}]`;
  if (plain(inline).length < 60) return inline;
  const pad = "    ".repeat(level), inner = "    ".repeat(level + 1);
  return `[\n${pairs.map((p) => `${inner}${p},`).join("\n")}\n${pad}]`;
}

/** The Rust of the same call: the SDK's sugar for each question, one `Request`, `complete` (never streamed). */
export function judgeRust(connection: Connection, spec: JudgeSpec, value: StateValue, echo?: Echo): Code {
  const jev = judgmentsOnly(connection.provider);
  const uses = new Set<string>(["judgments", "Config", "JsonObject", "Message", "ProbabilityPolicy", "Request"]);
  let json = false;
  const questions: string[] = [];
  for (const [name, prop] of Object.entries(spec.properties)) {
    const question = sugarQuestion(name, prop);
    const text = rv(question?.question.trim() || name);
    const key = `${rv(name)}.into()`;
    const push = (line: string) => questions.push(group(line, questionSource(name)));
    if (!question) { json = true; push(`questions.insert(${key}, json!(${rustJson(prop, 0)}));`); continue; }
    if (question.kind === "yesNo") { uses.add("yes_no"); push(`questions.insert(${key}, ${api("yes_no")}(${text}).into());`); continue; }
    if (question.kind === "choice") {
      if (question.options.every((o) => !o.description)) { uses.add("choice"); push(`questions.insert(${key}, ${api("choice")}(${text}, ${rustPairs(question.options.map((o) => rv(o.key)), 0)})?.into());`); }
      else { uses.add("choice_described"); push(`questions.insert(${key}, ${api("choice_described")}(${text}, ${rustPairs(question.options.map((o) => `(${rv(o.key)}.into(), ${o.description ? `Some(${rv(o.description)}.into())` : "None"})`), 0)})?.into());`); }
    } else if (question.options.every((o) => !o.key)) { uses.add("score"); push(`questions.insert(${key}, ${api("score")}(${text}, ${rustPairs(question.options.map((o) => rv(o.description)), 0)})?.into()); ${comment("// levels, worst to best")}`); }
    else { uses.add("score_named"); push(`questions.insert(${key}, ${api("score_named")}(${text}, ${rustPairs(question.options.map((o) => `(${o.key ? `Some(${rv(o.key)}.into())` : "None"}, ${rv(o.description)}.into())`), 0)})?.into()); ${comment("// levels, worst to best")}`); }
  }
  // The state, typed by shape: a text, a `json!` object, or a transcript (Jev takes a transcript as its own `messages` array).
  let state: string;
  if (spec.shape === "text") state = rv(value as string);
  else if (spec.shape === "fields") { json = true; state = `json!(${rustJson(value as JsonValue, 0, true)})`; }
  else if (jev) { json = true; state = `json!([\n${(value as readonly Turn[]).map((t) => `    { "role": ${q(t.role)}, "content": ${rv(t.content)} },`).join("\n")}\n])`; }
  else state = `vec![\n${(value as readonly Turn[]).map((t) => `    ${api(`Message::${t.role}`)}(${rv(t.content)})?,`).join("\n")}\n]`;
  let messages: string;
  if (jev) {
    if (spec.shape === "text") messages = `vec![${api("Message::user")}(state)?]`;
    else { uses.add("Part"); if (spec.shape === "conversation") json = true; messages = `vec![${api("Message::user")}(${api("Part::data")}(${spec.shape === "fields" ? "state" : 'json!({ "messages": state })'}))?]`; }
  } else if (spec.shape === "conversation") messages = "state";
  else if (spec.shape === "fields") { uses.add("Part"); messages = `vec![${api("Message::user")}(${api("Part::data")}(state))?]`; }
  else messages = `vec![${api("Message::user")}(state)?]`;
  const [data, probabilities, adaptations] = echoLines(echo, "rust", "//");
  const lines = [dim("use lm15::{auth::Credential, registry::adapter_for};"), dim(`use lm15::{${rustUseOrder(uses).join(", ")}};`), ...(json ? [dim("use serde_json::json;")] : []), ""];
  lines.push(...rustClient(connection), "");
  lines.push(comment(`// ${SHAPE_NOTE[spec.shape]}.`), `let state = ${group(state, STATE_SOURCE)};`, "");
  lines.push(comment("// Declared keys in, a distribution out (MAP-14)."), "let mut questions = JsonObject::new();", ...questions, `let questions = ${api("judgments")}(questions)?;`, "");
  lines.push(`let request = ${api("Request")} {`, `    model: ${rv(connection.model, "model")}.into(),`, `    messages: ${messages},`, `    config: ${api("Config")} {`, "        response_format: Some(questions),", `        probabilities: Some(${api("ProbabilityPolicy::IfAvailable")}),`, dim("        ..Default::default()"), "    },", dim("    ..Default::default()"), "};",
    `let response = ${api("lm.complete")}(&request).await?;`,
    `println!("{:?}", ${api("response.data")}()); ${comment(`// ${DATA_NOTE}`)}`, ...data,
    `println!("{:?}", ${api("response.probabilities")}()); ${comment(`// ${PROBABILITIES_NOTE.replace("%s", "None")}`)}`, ...probabilities,
    `println!("{:?}", ${api("response.adaptations")}); ${comment(`// ${ADAPTATIONS_NOTE}`)}`, ...adaptations);
  return finish(lines.join("\n"));
}

// ─── The example ─────────────────────────────────────────────────────

/** Two questions over one state, the docs' running example (a wildlife station's field note): how sure the identification is, on a scale, and a yes/no. */
export const EXAMPLE_SPEC: JudgeSpec = {
  properties: {
    id_certainty: score("How sure is the species identification, according to the note?", { unknown: "Species not identified", guess: "A guess", probable: "Probable, some features described", confident: "Confident, clear features described", certain: "Certain, unmistakable or confirmed" }),
    juvenile_present: yesNo("Does the note say a juvenile was present?"),
  },
  shape: "text",
};

export const EXAMPLE_NOTE = "Dusk, edge of the oak grove. Two deer browsing on fallen acorns, one small with spots still showing. Too far to be sure of the species: roe or fallow. They moved off into the trees when a dog barked.";

/** What each shape starts with: the note as a text, as an object, as a conversation. */
export function exampleState(shape: Shape): StateValue {
  if (shape === "text") return EXAMPLE_NOTE;
  if (shape === "fields") return { note: EXAMPLE_NOTE, distance_m: 80 };
  return [{ role: "user", content: "Anything at the oak grove last night?" }, { role: "assistant", content: `From the field notes: ${EXAMPLE_NOTE}` }];
}
