/**
 * Judge mode: one question set, many inputs, one call per input (MAP-14).
 *
 * The question set is the JSON Schema `properties` object that
 * `judgments({...})` takes — the SDK's own contract, kept verbatim. The
 * form in the page is a view over it: it reads questions with the SDK's
 * `judgmentsInSchema` and writes them back with the SDK's `choice`,
 * `yesNo` and `score`, so nothing here invents a second schema format.
 *
 * Inputs have a shape — a text, a JSON object of fields, or a whole
 * conversation — because Jev reads all three (contract D6: a string, a
 * data part's value, or `{system, messages}`), and a question can point
 * at a piece of a structured input with backticks (`` `note` ``,
 * `` `messages[1].content` ``). The same request goes to any chat
 * provider, which answers the pick without the numbers.
 *
 * The rendered code is what runs (runtimes/): the JavaScript is this
 * page's client, the Python executes under Pyodide with one input, the
 * loop body unchanged. Nothing here touches the DOM or the network.
 */

import { Message, RawNumber, Request as RequestNs, choice, isJsonObject, judgments, judgmentsInSchema, lookup, parseJson, score, stringifyJson, yesNo, type Config, type Judgment, type JsonObject, type JsonValue, type Request, type Response } from "lm15/browser";
import { GO_ERR, GO_ERR_IN_LOOP, goProgram, jsClient, judgmentsOnly, pyClient, pyImports, rustClient, rustString, rv, type Connection } from "./experience.ts";
import { api, comment, dim, finish, plain, quotedValue, val, type Code } from "./marks.ts";

export type Shape = "text" | "fields" | "conversation";
export interface FieldDef { readonly name: string; readonly type: "text" | "number" | "json" }
export interface Turn { readonly role: "user" | "assistant"; readonly content: string }
/** One input, in the set's shape: a text, an object of fields, or a transcript. */
export type InputValue = string | Readonly<Record<string, JsonValue>> | readonly Turn[];

export interface JudgeSpec {
  /** The `properties` of the judgments schema, verbatim (what `judgments(...)` takes). */
  readonly properties: JsonObject;
  /** How to read each input; sent as the system text (Jev takes it as context, chat wires as the system prompt). */
  readonly instructions: string;
  readonly shape: Shape;
  /** The fields of a `fields` set: the keys every input object carries. */
  readonly fields: readonly FieldDef[];
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

// ─── Inputs ──────────────────────────────────────────────────────────

export function emptyInput(shape: Shape, fields: readonly FieldDef[]): InputValue {
  if (shape === "text") return "";
  if (shape === "fields") return Object.fromEntries(fields.map((f) => [f.name, f.type === "number" ? 0 : f.type === "json" ? null : ""]));
  return [{ role: "user", content: "" }];
}

/** A field value as the person typed it, in the field's type: numbers parse, JSON parses, text stays. Throws on a value the type cannot hold. */
export function fieldValue(field: FieldDef, typed: string): JsonValue {
  if (field.type === "text") return typed;
  const trimmed = typed.trim();
  if (field.type === "number") {
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) throw new Error(`${field.name}: not a number`);
    return n;
  }
  if (trimmed === "") return null;
  try { return parseJson(trimmed); } catch (e) { throw new Error(`${field.name}: ${(e as Error).message}`); }
}

export function fieldText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return stringifyJson(value);
}

/** One line that says what an input is (the results table's preview, the CSV's first column). */
export function inputSummary(value: InputValue): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return (value as readonly Turn[]).map((t) => `${t.role}: ${t.content}`).join(" ▸ ");
  return Object.entries(value as Record<string, JsonValue>).map(([k, v]) => `${k}: ${fieldText(v)}`).join(" · ");
}

export function inputIsBlank(value: InputValue): boolean {
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return (value as readonly Turn[]).every((t) => !t.content.trim());
  return Object.values(value as Record<string, JsonValue>).every((v) => v === null || v === "" );
}

/** Texts pasted one per line; a JSON array pasted as objects or transcripts. */
export function parseInputs(shape: Shape, text: string, fields: readonly FieldDef[]): InputValue[] {
  if (shape === "text") return text.split("\n").map((s) => s.trim()).filter(Boolean);
  const value = parseJson(text.trim());
  if (!Array.isArray(value) || value.length === 0) throw new Error("Paste a JSON array: one item per input.");
  if (shape === "fields") return value.map((item, i) => {
    if (!isJsonObject(item)) throw new Error(`Item ${i + 1} is not an object.`);
    return Object.fromEntries(fields.map((f) => [f.name, item[f.name] ?? null]));
  });
  return value.map((item, i) => {
    const turns = isJsonObject(item) && Array.isArray(item["messages"]) ? item["messages"] : Array.isArray(item) ? item : undefined;
    if (!turns) throw new Error(`Item ${i + 1} is not a conversation: give { "messages": [{ "role", "content" }] } or an array of turns.`);
    return turns.map((t, k): Turn => {
      if (!isJsonObject(t) || (t["role"] !== "user" && t["role"] !== "assistant") || typeof t["content"] !== "string") throw new Error(`Item ${i + 1}, turn ${k + 1}: a turn is { "role": "user" | "assistant", "content": text }.`);
      return { role: t["role"], content: t["content"] };
    });
  });
}

/** CSV with a header row: field names, or `text`; one row per input. */
export function parseCsv(text: string, fields: readonly FieldDef[]): InputValue[] {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error("Paste CSV with a header row and at least one data row.");
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r, i) => {
    const object: Record<string, JsonValue> = {};
    for (const f of fields) {
      const at = header.indexOf(f.name);
      if (at === -1) throw new Error(`The CSV has no "${f.name}" column (header: ${header.join(", ")}).`);
      try { object[f.name] = fieldValue(f, r[at] ?? ""); } catch (e) { throw new Error(`Row ${i + 1}: ${(e as Error).message}`); }
    }
    return object;
  });
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ─── The request ─────────────────────────────────────────────────────

/** The key under which the instructions ride in Jev's state, and the key a bare text takes beside them. */
export const JEV_INSTRUCTIONS_KEY = "instructions";
export const JEV_TEXT_KEY = "text";

/**
 * Jev's state for an input (changes/2026-09-19-jev-state.md D1/D4): the
 * one user part, verbatim. Jev has no system prompt and no conversation,
 * so the page writes what a caller would: the instructions as a named key
 * of the state, a transcript as the caller's own `messages` array. The
 * shown code does exactly this; no adapter does anything.
 */
export function jevState(spec: JudgeSpec, value: InputValue): JsonValue {
  const instructions = spec.instructions.trim();
  if (Array.isArray(value)) {
    const messages = (value as readonly Turn[]).map((t) => ({ role: t.role, content: t.content }));
    return instructions ? { [JEV_INSTRUCTIONS_KEY]: instructions, messages } : { messages };
  }
  if (typeof value === "string") return instructions ? { [JEV_INSTRUCTIONS_KEY]: instructions, [JEV_TEXT_KEY]: value } : value;
  const object = value as Record<string, JsonValue>;
  if (!instructions) return object;
  if (JEV_INSTRUCTIONS_KEY in object) throw new Error(`A field is already named ${JEV_INSTRUCTIONS_KEY}: on Jev the instructions go into the state under that key. Rename the field, or clear the instructions.`);
  return { [JEV_INSTRUCTIONS_KEY]: instructions, ...object };
}

/** The messages an input makes: on Jev the one user part holding the state; on a chat wire the text, the data part, or the transcript, with the instructions as the system prompt. */
export function judgeMessages(connection: Connection, spec: JudgeSpec, value: InputValue): Message[] {
  if (judgmentsOnly(connection.provider)) {
    const state = jevState(spec, value);
    return [typeof state === "string" ? Message.user(state) : Message.user({ type: "data", value: state })];
  }
  if (typeof value === "string") return [Message.user(value)];
  if (Array.isArray(value)) return (value as readonly Turn[]).map((t) => t.role === "user" ? Message.user(t.content) : Message.assistant(t.content));
  return [Message.user({ type: "data", value: value as Record<string, JsonValue> })];
}

/** The one Request an input makes: its messages, the instructions (a system prompt on a chat wire; part of the state on Jev), the declared judgments, probabilities if the wire measures them. */
export function judgeRequest(connection: Connection, spec: JudgeSpec, value: InputValue): Request {
  const config: Config = { responseFormat: judgments(parseProperties(stringifyJson(spec.properties)) as Record<string, JsonObject>), probabilities: "if_available" };
  const jev = judgmentsOnly(connection.provider);
  return RequestNs.create({
    model: connection.model.trim(),
    ...(spec.instructions.trim() && !jev ? { system: spec.instructions.trim() } : {}),
    messages: judgeMessages(connection, spec, value),
    config,
  });
}

/** What the page executed a judge request from: the spec and the input. Runtimes that re-render the shown program take it beside the request. */
export interface JudgeSource { readonly spec: JudgeSpec; readonly value: InputValue }

/** A judge request: a json_schema response format declaring at least one judgment. It is sent with `complete`, never streamed. */
export function isJudgeRequest(request: Request): boolean {
  const format = request.config?.responseFormat;
  return format?.type === "json_schema" && judgmentsInSchema(format.schema).size > 0;
}

/**
 * The spec and input a chat-wire judge Request carries, read back off it —
 * the fallback for a runtime that re-renders its program without a
 * JudgeSource (runtimes/python.ts). A Jev request is not read back: its
 * state is the caller's object and the page passes the source instead.
 */
export function specOfRequest(request: Request): JudgeSource {
  const format = request.config?.responseFormat;
  if (format?.type !== "json_schema" || !isJsonObject(format.schema["properties"])) throw new Error("Not a judge request: no judgments schema.");
  const properties = format.schema["properties"];
  const instructions = typeof request.system === "string" ? request.system : "";
  const parts = request.messages[0]?.parts ?? [];
  if (request.messages.length === 1 && request.messages[0]!.role === "user" && parts.length === 1 && parts[0]!.type === "data" && isJsonObject(parts[0]!.value)) {
    const object = parts[0]!.value;
    const fields: FieldDef[] = Object.entries(object).map(([name, v]) => ({ name, type: typeof v === "number" ? "number" : typeof v === "string" || v === null ? "text" : "json" }));
    return { spec: { properties, instructions, shape: "fields", fields }, value: object };
  }
  if (request.messages.length === 1 && request.messages[0]!.role === "user" && parts.length === 1 && parts[0]!.type === "text") {
    return { spec: { properties, instructions, shape: "text", fields: [] }, value: parts[0]!.text };
  }
  const turns: Turn[] = request.messages.map((m) => {
    const text = m.parts.map((p) => p.type === "text" ? p.text : "").join("");
    if (m.role !== "user" && m.role !== "assistant") throw new Error(`Not a judge conversation: a ${m.role} message.`);
    return { role: m.role, content: text };
  });
  return { spec: { properties, instructions, shape: "conversation", fields: [] }, value: turns };
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

/** Every judgment, one row per input; the distribution's keys as columns where measured. RFC 4180 quoting. */
export function toCsv(spec: JudgeSpec, rows: ReadonlyArray<{ value: InputValue; verdict?: Verdict }>): string {
  const found = [...judgmentsInSchema({ type: "object", properties: spec.properties }).values()];
  const measured = rows.some((r) => r.verdict?.probabilities);
  const head = ["input", ...found.flatMap((j) => [j.name, ...(measured ? j.keys.map((k) => `${j.name}:${keyLabel(j, k)}`) : [])]), "method", "provider", "model", "adaptations"];
  const cell = (v: unknown) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [head.map(cell).join(",")];
  for (const { value, verdict } of rows) {
    const cells: unknown[] = [inputSummary(value)];
    for (const j of found) {
      cells.push(verdict ? pickLabel(j, verdict.data[j.name]) : "");
      // Twelve significant digits: the value the wire gave without binary float noise (1 − 0.97 is not 0.030000000000000027).
      if (measured) for (const k of j.keys) { const p = verdict?.probabilities?.[j.name]?.[k]; cells.push(p === undefined ? "" : Number(p.toPrecision(12))); }
    }
    cells.push(verdict?.method ?? "", verdict?.provider ?? "", verdict?.model ?? "", verdict?.adaptations.map((a) => `${a.field} ${a.action}`).join("; ") ?? "");
    lines.push(cells.map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function toJsonExport(spec: JudgeSpec, rows: ReadonlyArray<{ value: InputValue; verdict?: Verdict }>): string {
  const results = rows.map(({ value, verdict }) => {
    const row: JsonObject = { input: value as JsonValue };
    if (verdict) {
      row["data"] = verdict.data as JsonObject;
      if (verdict.probabilities) row["probabilities"] = verdict.probabilities as unknown as JsonObject;
      if (verdict.method) row["method"] = verdict.method;
      row["adaptations"] = verdict.adaptations.map((a) => ({ ...a }));
      row["provider"] = verdict.provider;
      row["model"] = verdict.model;
      row["runtime"] = verdict.runtime;
    }
    return row;
  });
  return stringifyJson({ questions: spec.properties, instructions: spec.instructions, shape: spec.shape, results }, { indent: 2 });
}

// ─── Code ────────────────────────────────────────────────────────────
//
// Each program is written with its meaning marked (marks.ts): the
// person's questions, options and inputs as values, LM15's calls as api.

const q = JSON.stringify;
const qv = (text: string): string => quotedValue(q(text));
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
    if (call) { uses.add(plain(call).slice(0, plain(call).indexOf("("))); lines.push(`${pad}${key}${sep}${call},`); }
    else lines.push(`${pad}${key}${sep}${lang === "python" ? pyLiteral(prop, 1) : jsLiteral(prop, 1)},`);
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

function jsInput(value: InputValue, level: number, jev: boolean): string {
  if (typeof value === "string") return qv(value);
  if (Array.isArray(value)) {
    const turns = value as readonly Turn[];
    return jev ? turnsLiteral(turns, level, "javascript") : `[${turns.map((t) => `${api(`Message.${t.role}`)}(${qv(t.content)})`).join(", ")}]`;
  }
  return jsLiteral(value as JsonValue, level, true);
}

function pyInput(value: InputValue, level: number, jev: boolean): string {
  if (typeof value === "string") return qv(value);
  if (Array.isArray(value)) {
    const turns = value as readonly Turn[];
    return jev ? turnsLiteral(turns, level, "python") : `[${turns.map((t) => `${api(`Message.${t.role}`)}(${qv(t.content)})`).join(", ")}]`;
  }
  return pyLiteral(value as JsonValue, level, true);
}

const SHAPE_NOTE: Record<Shape, string> = {
  text: "one text per call",
  fields: "one object per call: a data part; Jev reads it as structured state and a question can point at a field with backticks; a chat wire gets it as JSON text",
  conversation: "one transcript per call",
};
/** On Jev the state is the one user part: the page writes the instructions and the transcript into it as a caller would (2026-09-19 D4). */
const JEV_STATE_NOTE: Record<Shape, string> = {
  text: `Jev has no system prompt: the instructions ride in the state as \`${JEV_INSTRUCTIONS_KEY}\`, the text as \`${JEV_TEXT_KEY}\``,
  fields: `Jev has no system prompt: the instructions ride in the state as \`${JEV_INSTRUCTIONS_KEY}\` beside the fields`,
  conversation: `Jev has no conversation: the transcript is the state's \`messages\` array, and a question can point at a turn (\`messages[1].content\`)`,
};
const DATA_NOTE = "the picked key per judgment";
const PROBABILITIES_NOTE = "one distribution per judgment where the provider measures one; else %s and recorded";
const ADAPTATIONS_NOTE = "MAP-13: what this wire could not take as asked";

/** The JavaScript that judges every input in turn: this page's client, loaded as `lm15/browser`. */
export function judgeJavascript(connection: Connection, spec: JudgeSpec, inputs: readonly InputValue[]): Code {
  const { lines: questionLines, uses } = questionsCode(spec, "javascript");
  const imports = [connection.provider === "custom" ? "OpenAIChatLM" : "adapterFor", ...(connection.provider === "anthropic" ? ["access"] : []), "Message", "Request", "judgments", ...[...uses].sort()];
  const jev = judgmentsOnly(connection.provider);
  const lines = [dim(`import { ${imports.join(", ")} } from "lm15/browser";`), "", ...jsClient(connection)];
  lines.push("", comment("// Declared keys in, a distribution out (MAP-14)."), `const questions = ${api("judgments")}({`, ...questionLines, "});", "");
  lines.push(comment(`// ${SHAPE_NOTE[spec.shape]}.`), "const inputs = [", ...inputs.map((v) => `  ${jsInput(v, 1, jev)},`), "];", "");
  const instructions = spec.instructions.trim();
  let messages: string;
  if (jev) {
    // The state, as the caller writes it (D4): verbatim, with the instructions as a named key.
    const state = spec.shape === "conversation" ? (instructions ? `{ ${JEV_INSTRUCTIONS_KEY}: ${qv(instructions)}, messages: input }` : "{ messages: input }")
      : spec.shape === "fields" ? (instructions ? `{ ${JEV_INSTRUCTIONS_KEY}: ${qv(instructions)}, ...input }` : "input")
      : instructions ? `{ ${JEV_INSTRUCTIONS_KEY}: ${qv(instructions)}, ${JEV_TEXT_KEY}: input }` : "input";
    messages = spec.shape === "text" && !instructions ? `[${api("Message.user")}(input)]` : `[${api("Message.user")}({ type: "data", value: ${state} })]`;
    if (instructions || spec.shape === "conversation") lines.push(comment(`// ${JEV_STATE_NOTE[spec.shape]}.`));
  } else messages = spec.shape === "conversation" ? "input" : spec.shape === "fields" ? `[${api("Message.user")}({ type: "data", value: input })]` : `[${api("Message.user")}(input)]`;
  lines.push("for (const input of inputs) {", `  const request = ${api("Request.create")}({`, `    model: ${qv(connection.model)},`);
  if (instructions && !jev) lines.push(`    system: ${qv(instructions)},`);
  lines.push(`    messages: ${messages},`, `    config: { responseFormat: questions, probabilities: ${api('"if_available"')} },`, "  });", `  const response = await ${api("lm.complete")}(request);`, `  console.log(${api("response.data")}); ${comment(`// ${DATA_NOTE}`)}`, `  console.log(${api("response.probabilities")}); ${comment(`// ${PROBABILITIES_NOTE.replace("%s", "absent")}`)}`, `  console.log(${api("response.adaptations")}); ${comment(`// ${ADAPTATIONS_NOTE}`)}`, "}");
  return finish(lines.join("\n"));
}

/** The Python of the same loop: under Pyodide in this page, on CPython without the transport line. */
export function judgePython(connection: Connection, spec: JudgeSpec, inputs: readonly InputValue[]): Code {
  const client = pyClient(connection);
  const { lines: questionLines, uses } = questionsCode(spec, "python");
  const jev = judgmentsOnly(connection.provider);
  const instructions = spec.instructions.trim();
  const usesData = spec.shape === "fields" || (jev && (Boolean(instructions) || spec.shape === "conversation"));
  const lines = pyImports([client.cls, "Config", "Message", "Request", "judgments", ...(usesData ? ["data"] : []), ...uses], connection);
  lines.push("", ...client.lines, "", comment("# Declared keys in, a distribution out (MAP-14)."), `questions = ${api("judgments")}(`, ...questionLines, ")", "");
  lines.push(comment(`# ${SHAPE_NOTE[spec.shape]}.`), "inputs = [", ...inputs.map((v) => `    ${pyInput(v, 1, jev)},`), "]", "");
  let messages: string;
  if (jev) {
    const state = spec.shape === "conversation" ? (instructions ? `{${q(JEV_INSTRUCTIONS_KEY)}: ${qv(instructions)}, "messages": x}` : `{"messages": x}`)
      : spec.shape === "fields" ? (instructions ? `{${q(JEV_INSTRUCTIONS_KEY)}: ${qv(instructions)}, **x}` : "x")
      : instructions ? `{${q(JEV_INSTRUCTIONS_KEY)}: ${qv(instructions)}, ${q(JEV_TEXT_KEY)}: x}` : "x";
    messages = spec.shape === "text" && !instructions ? `[${api("Message.user")}(x)]` : `[${api("Message.user")}(${api("data")}(${state}))]`;
    if (instructions || spec.shape === "conversation") lines.push(comment(`# ${JEV_STATE_NOTE[spec.shape]}.`));
  } else messages = spec.shape === "conversation" ? "x" : spec.shape === "fields" ? `[${api("Message.user")}(${api("data")}(x))]` : `[${api("Message.user")}(x)]`;
  lines.push("for x in inputs:", `    request = ${api("Request")}(`, `        model=${qv(connection.model)},`);
  if (instructions && !jev) lines.push(`        system=${qv(instructions)},`);
  lines.push(`        messages=${messages},`, `        config=${api("Config")}(response_format=questions, probabilities=${api('"if_available"')}),`, "    )", `    response = await ${api("lm.complete")}(request)`, `    print(${api("response.data")})  ${comment(`# ${DATA_NOTE}`)}`, `    print(${api("response.probabilities")})  ${comment(`# ${PROBABILITIES_NOTE.replace("%s", "None")}`)}`, `    print(${api("response.adaptations")})  ${comment(`# ${ADAPTATIONS_NOTE}`)}`);
  return finish(lines.join("\n"));
}

// ─── Go ──────────────────────────────────────────────────────────────

/** A Go literal of a JSON value: `lm15.JSONObject` for objects, `[]any` for arrays, `nil` for null. `values`: the leaves are the person's. */
function goJson(value: JsonValue, level: number, values = false): string {
  const pad = "    ".repeat(level), inner = "    ".repeat(level + 1);
  if (value === null) return "nil";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return values ? nv(value) : String(value);
  if (typeof value === "string") return values ? qv(value) : q(value);
  if (value instanceof RawNumber) return value.raw;
  if (Array.isArray(value)) return value.length ? `[]any{\n${value.map((v) => `${inner}${goJson(v, level + 1, values)},`).join("\n")}\n${pad}}` : "[]any{}";
  const entries = Object.entries(value as Record<string, JsonValue>);
  return entries.length ? `lm15.JSONObject{\n${entries.map(([k, v]) => `${inner}${q(k)}: ${goJson(v, level + 1, values)},`).join("\n")}\n${pad}}` : "lm15.JSONObject{}";
}

/** One input object as the element of a `[]lm15.JSONObject` literal: the type elided, as Go allows; the leaves the person's. */
function goElement(value: Readonly<Record<string, JsonValue>>): string {
  return `{${Object.entries(value).map(([k, v]) => `${q(k)}: ${goJson(v, 0, true)}`).join(", ")}}`;
}

const GO_RESERVED = new Set(["break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var", "lm", "lm15", "ctx", "cancel", "err", "questions", "inputs", "input", "state", "request", "response", "main", "run"]);

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

/** The Go of the same loop: the SDK's sugar for each question, one request per input, `Complete` (never streamed). */
export function judgeGo(connection: Connection, spec: JudgeSpec, inputs: readonly InputValue[]): Code {
  const jev = judgmentsOnly(connection.provider);
  const instructions = spec.instructions.trim();
  const body: string[] = [`    ${comment("// Declared keys in, a distribution out (MAP-14).")}`];
  const entries = Object.entries(spec.properties);
  const names = goIdentifiers(entries.map(([name]) => name));
  const properties: string[] = [];
  entries.forEach(([name, prop], i) => {
    const question = sugarQuestion(name, prop);
    const text = qv(question?.question.trim() || name);
    if (!question) { properties.push(`${api("lm15.JudgmentProperty")}{Name: ${qv(name)}, Schema: ${goJson(prop, 2)}}`); return; }
    if (question.kind === "yesNo") { properties.push(`${api("lm15.JudgmentProperty")}{Name: ${qv(name)}, Schema: ${api("lm15.YesNo")}(${text})}`); return; }
    properties.push(`${api("lm15.JudgmentProperty")}{Name: ${qv(name)}, Schema: ${names[i]}}`);
    if (question.kind === "choice") {
      if (question.options.every((o) => !o.description)) body.push(`    ${names[i]}, err := ${api("lm15.Choice")}(${text}, ${api("lm15.Options")}(${question.options.map((o) => qv(o.key)).join(", ")})...)`);
      else body.push(`    ${names[i]}, err := ${api("lm15.Choice")}(${text},`, ...question.options.map((o) => `        ${api("lm15.ChoiceOption")}{Key: ${qv(o.key)}${o.description ? `, Description: ${qv(o.description)}` : ""}},`), "    )");
    } else {
      body.push(`    ${names[i]}, err := ${api("lm15.Score")}(${text}, ${comment("// levels, worst to best")}`, ...question.options.map((o) => `        ${api("lm15.ScoreLevel")}{${[...(o.key ? [`Name: ${qv(o.key)}`] : []), ...(o.description ? [`Description: ${qv(o.description)}`] : [])].join(", ")}},`), "    )");
    }
    body.push(GO_ERR);
  });
  body.push(`    questions, err := ${api("lm15.Judgments")}("judgments", true,`, ...properties.map((p) => `        ${p},`), "    )", GO_ERR, "");
  // The inputs, typed by shape: texts, field objects, or transcripts (Jev takes a transcript as its own `messages` array).
  body.push(`    ${comment(`// ${SHAPE_NOTE[spec.shape]}.`)}`);
  if (spec.shape === "text") body.push("    inputs := []string{", ...inputs.map((v) => `        ${qv(v as string)},`), "    }");
  else if (spec.shape === "fields") body.push("    inputs := []lm15.JSONObject{", ...inputs.map((v) => `        ${goElement(v as Readonly<Record<string, JsonValue>>)},`), "    }");
  else if (jev) body.push("    inputs := [][]lm15.JSONObject{", ...inputs.map((v) => `        {${(v as readonly Turn[]).map((t) => `{"role": ${q(t.role)}, "content": ${qv(t.content)}}`).join(", ")}},`), "    }");
  else body.push("    inputs := [][]lm15.Message{", ...inputs.map((v) => `        {${(v as readonly Turn[]).map((t) => `${api(t.role === "user" ? "lm15.UserMessage" : "lm15.AssistantText")}(${qv(t.content)})`).join(", ")}},`), "    }");
  body.push("    for _, input := range inputs {");
  let messages: string;
  if (jev) {
    const fieldNames = spec.shape === "fields" ? Object.keys((inputs[0] ?? {}) as Record<string, JsonValue>) : [];
    const state = spec.shape === "conversation" ? (instructions ? `lm15.JSONObject{${q(JEV_INSTRUCTIONS_KEY)}: ${qv(instructions)}, "messages": input}` : `lm15.JSONObject{"messages": input}`)
      : spec.shape === "fields" ? (instructions ? `lm15.JSONObject{\n${[`${q(JEV_INSTRUCTIONS_KEY)}: ${qv(instructions)}`, ...fieldNames.map((f) => `${q(f)}: input[${q(f)}]`)].map((e) => `            ${e},`).join("\n")}\n        }` : "input")
      : instructions ? `lm15.JSONObject{${q(JEV_INSTRUCTIONS_KEY)}: ${qv(instructions)}, ${q(JEV_TEXT_KEY)}: input}` : "input";
    if (spec.shape === "text" && !instructions) messages = `[]lm15.Message{${api("lm15.UserMessage")}(input)}`;
    else {
      body.push(`        ${comment(`// ${JEV_STATE_NOTE[spec.shape]}.`)}`, `        state := ${state}`);
      messages = `[]lm15.Message{${api("lm15.UserParts")}(${api("lm15.Data")}(state))}`;
    }
  } else messages = spec.shape === "conversation" ? "input" : spec.shape === "fields" ? `[]lm15.Message{${api("lm15.UserParts")}(${api("lm15.Data")}(input))}` : `[]lm15.Message{${api("lm15.UserMessage")}(input)}`;
  body.push(`        request, err := ${api("lm15.NewRequest")}(`, `            ${qv(connection.model)},`, `            ${messages},`);
  if (instructions && !jev) body.push(`            ${api("lm15.WithSystem")}(${qv(instructions)}),`);
  body.push(`            ${api("lm15.WithConfig")}(${api("lm15.Config")}{ResponseFormat: questions, Probabilities: ${api("lm15.ProbabilitiesIfAvailable")}}),`, "        )", GO_ERR_IN_LOOP, `        response, err := ${api("lm.Complete")}(ctx, request)`, GO_ERR_IN_LOOP, `        fmt.Println(${api("response.Data")}())          ${comment(`// ${DATA_NOTE}`)}`, `        fmt.Println(${api("response.Probabilities")}()) ${comment(`// ${PROBABILITIES_NOTE.replace("%s", "nil")}`)}`, `        fmt.Println(${api("response.Adaptations")})     ${comment(`// ${ADAPTATIONS_NOTE}`)}`, "    }");
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

/** The Rust of the same loop: the SDK's sugar for each question, one `Request` per input, `complete` (never streamed). */
export function judgeRust(connection: Connection, spec: JudgeSpec, inputs: readonly InputValue[]): Code {
  const jev = judgmentsOnly(connection.provider);
  const instructions = spec.instructions.trim();
  const uses = new Set<string>(["judgments", "Config", "JsonObject", "Message", "ProbabilityPolicy", "Request"]);
  let json = false;
  const questions: string[] = [];
  for (const [name, prop] of Object.entries(spec.properties)) {
    const question = sugarQuestion(name, prop);
    const text = rv(question?.question.trim() || name);
    const key = `${rv(name)}.into()`;
    if (!question) { json = true; questions.push(`questions.insert(${key}, json!(${rustJson(prop, 0)}));`); continue; }
    if (question.kind === "yesNo") { uses.add("yes_no"); questions.push(`questions.insert(${key}, ${api("yes_no")}(${text}).into());`); continue; }
    if (question.kind === "choice") {
      if (question.options.every((o) => !o.description)) { uses.add("choice"); questions.push(`questions.insert(${key}, ${api("choice")}(${text}, ${rustPairs(question.options.map((o) => rv(o.key)), 0)})?.into());`); }
      else { uses.add("choice_described"); questions.push(`questions.insert(${key}, ${api("choice_described")}(${text}, ${rustPairs(question.options.map((o) => `(${rv(o.key)}.into(), ${o.description ? `Some(${rv(o.description)}.into())` : "None"})`), 0)})?.into());`); }
    } else if (question.options.every((o) => !o.key)) { uses.add("score"); questions.push(`questions.insert(${key}, ${api("score")}(${text}, ${rustPairs(question.options.map((o) => rv(o.description)), 0)})?.into()); ${comment("// levels, worst to best")}`); }
    else { uses.add("score_named"); questions.push(`questions.insert(${key}, ${api("score_named")}(${text}, ${rustPairs(question.options.map((o) => `(${o.key ? `Some(${rv(o.key)}.into())` : "None"}, ${rv(o.description)}.into())`), 0)})?.into()); ${comment("// levels, worst to best")}`); }
  }
  // The inputs, typed by shape: texts, `json!` objects, or transcripts (Jev takes a transcript as its own `messages` array).
  const inputLines: string[] = [];
  if (spec.shape === "text") inputLines.push(...inputs.map((v) => `    ${rv(v as string)},`));
  else if (spec.shape === "fields") { json = true; inputLines.push(...inputs.map((v) => `    json!(${rustJson(v as JsonValue, 1, true)}),`)); }
  else if (jev) { json = true; inputLines.push(...inputs.map((v) => `    json!([\n${(v as readonly Turn[]).map((t) => `        { "role": ${q(t.role)}, "content": ${rv(t.content)} },`).join("\n")}\n    ]),`)); }
  else inputLines.push(...inputs.map((v) => `    vec![${(v as readonly Turn[]).map((t) => `${api(`Message::${t.role}`)}(${rv(t.content)})?`).join(", ")}],`));
  const loop: string[] = [];
  let messages: string;
  if (jev) {
    const fieldNames = spec.shape === "fields" ? Object.keys((inputs[0] ?? {}) as Record<string, JsonValue>) : [];
    const state = spec.shape === "conversation" ? (instructions ? `json!({ ${q(JEV_INSTRUCTIONS_KEY)}: ${rv(instructions)}, "messages": input })` : `json!({ "messages": input })`)
      : spec.shape === "fields" ? (instructions ? `json!({\n${[`${q(JEV_INSTRUCTIONS_KEY)}: ${rv(instructions)}`, ...fieldNames.map((f) => `${q(f)}: input[${q(f)}]`)].map((e) => `        ${e},`).join("\n")}\n    })` : "input")
      : instructions ? `json!({ ${q(JEV_INSTRUCTIONS_KEY)}: ${rv(instructions)}, ${q(JEV_TEXT_KEY)}: input })` : "input";
    if (spec.shape === "text" && !instructions) messages = `vec![${api("Message::user")}(input)?]`;
    else {
      uses.add("Part");
      if (state !== "input") { json = true; loop.push(`    ${comment(`// ${JEV_STATE_NOTE[spec.shape]}.`)}`, `    let state = ${state};`); }
      messages = `vec![${api("Message::user")}(${api("Part::data")}(${state === "input" ? "input" : "state"}))?]`;
    }
  } else if (spec.shape === "conversation") messages = "input";
  else if (spec.shape === "fields") { uses.add("Part"); messages = `vec![${api("Message::user")}(${api("Part::data")}(input))?]`; }
  else messages = `vec![${api("Message::user")}(input)?]`;
  const lines = [dim("use lm15::{auth::Credential, registry::adapter_for};"), dim(`use lm15::{${rustUseOrder(uses).join(", ")}};`), ...(json ? [dim("use serde_json::json;")] : []), ""];
  lines.push(...rustClient(connection), "");
  lines.push(comment("// Declared keys in, a distribution out (MAP-14)."), "let mut questions = JsonObject::new();", ...questions, `let questions = ${api("judgments")}(questions)?;`, "");
  lines.push(comment(`// ${SHAPE_NOTE[spec.shape]}.`), "let inputs = [", ...inputLines, "];", "");
  lines.push("for input in inputs {", ...loop, `    let request = ${api("Request")} {`, `        model: ${rv(connection.model)}.into(),`);
  if (instructions && !jev) lines.push(`        system: Some(${rv(instructions)}.into()),`);
  lines.push(`        messages: ${messages},`, `        config: ${api("Config")} {`, "            response_format: Some(questions.clone()),", `            probabilities: Some(${api("ProbabilityPolicy::IfAvailable")}),`, dim("            ..Default::default()"), "        },", dim("        ..Default::default()"), "    };", `    let response = ${api("lm.complete")}(&request).await?;`, `    println!("{:?}", ${api("response.data")}()); ${comment(`// ${DATA_NOTE}`)}`, `    println!("{:?}", ${api("response.probabilities")}()); ${comment(`// ${PROBABILITIES_NOTE.replace("%s", "None")}`)}`, `    println!("{:?}", ${api("response.adaptations")}); ${comment(`// ${ADAPTATIONS_NOTE}`)}`, "}");
  return finish(lines.join("\n"));
}

// ─── The example set ─────────────────────────────────────────────────

/** The contract's own receipted example: three judgments over a wine note. */
export const EXAMPLE_SPEC: JudgeSpec = {
  properties: {
    quality: score("How good is this wine, according to the note?", { faulty: "Faulty or unpleasant", simple: "Simple and sound", good: "Good, well made", excellent: "Excellent, complex and structured", profound: "Profound, exceptional" }),
    style: choice("What is the dominant style described?", { fruit: "Fruit-forward", oak: "Oak-driven", mineral: "Mineral, savoury" }),
    ageing: yesNo("Does the note say the wine will improve with age?"),
  },
  // No instructions by default: the request is the docs' quick start — a string state and the questions, nothing else.
  instructions: "",
  shape: "text",
  fields: [],
};

/** What a person might add as instructions; the example does not start with them. */
export const EXAMPLE_INSTRUCTIONS = "These are tasting notes written by a sommelier. Judge the wine described, not the writing.";

export const EXAMPLE_INPUTS: readonly string[] = [
  "Ripe blackberry and cassis lead, framed by toasty oak and firm, fine-grained tannins. Long, layered finish; will reward a decade in the cellar.",
  "Thin, sour, faintly oxidised. Drink up.",
  "Wet stone and lime zest, taut acidity, saline finish.",
];

export const EXAMPLE_FIELDS: readonly FieldDef[] = [{ name: "note", type: "text" }, { name: "price_eur", type: "number" }];
