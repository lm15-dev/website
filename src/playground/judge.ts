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

import { Message, Request as RequestNs, choice, isJsonObject, judgments, judgmentsInSchema, lookup, parseJson, score, stringifyJson, yesNo, type Config, type Judgment, type JsonObject, type JsonValue, type Request, type Response } from "lm15/browser";
import { ANTHROPIC_BROWSER_HEADER, EXAMPLE_API_KEY, RUST_NOT_YET, baseUrlFor, judgmentsOnly, keyless, type Connection } from "./experience.ts";

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
    }
    return row;
  });
  return stringifyJson({ questions: spec.properties, instructions: spec.instructions, shape: spec.shape, results }, { indent: 2 });
}

// ─── Code ────────────────────────────────────────────────────────────

const q = JSON.stringify;

/** A property spelled with the SDK's sugar when the sugar reproduces it exactly; otherwise the schema verbatim. */
function sugar(name: string, prop: JsonValue, lang: "javascript" | "python"): string | undefined {
  const found = judgmentsInSchema({ type: "object", properties: { [name]: prop } }).get(name);
  if (!found) return undefined;
  const question = questionOf(found);
  if (stringifyJson(writeQuestion(question)) !== stringifyJson(prop)) return undefined;
  const text = q(question.question.trim() || name);
  const py = lang === "python";
  if (question.kind === "yesNo") return `${py ? "yes_no" : "yesNo"}(${text})`;
  const keys = question.options.map((o) => o.key);
  // Short option lists stay on one line; longer ones go one per line, so the copied program reads as a person would write it.
  const pad = py ? "    " : "  ";
  const block = (open: string, items: string[], close: string) => {
    const inline = `${open}${items.join(", ")}${close}`;
    return inline.length + text.length < 72 ? inline : `${open}\n${items.map((i) => `${pad}${pad}${i},`).join("\n")}\n${pad}${close}`;
  };
  if (question.kind === "choice") {
    if (question.options.every((o) => !o.description)) return `choice(${text}, ${block("[", keys.map((k) => q(k)), "]")})`;
    const entries = question.options.map((o) => `${py ? q(o.key) : identifier(o.key)}: ${o.description ? q(o.description) : py ? "None" : "null"}`);
    return `choice(${text}, ${block("{", entries, "}")})`;
  }
  if (question.options.every((o) => !o.key)) return `score(${text}, ${block("[", question.options.map((o) => q(o.description)), "]")})`;
  const entries = question.options.map((o) => `${py ? q(o.key) : identifier(o.key)}: ${q(o.description)}`);
  return `score(${text}, ${block("{", entries, "}")})`;
}

function identifier(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : q(key);
}

function pyLiteral(value: JsonValue, level: number): string {
  const pad = "    ".repeat(level), inner = "    ".repeat(level + 1);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return q(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + pyLiteral(v, level + 1)).join(",\n")},\n${pad}]` : "[]";
  const entries = Object.entries(value as Record<string, JsonValue>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${inner}${q(k)}: ${pyLiteral(v, level + 1)}`).join(",\n")},\n${pad}}` : "{}";
}

function jsLiteral(value: JsonValue, level: number): string {
  const pad = "  ".repeat(level), inner = "  ".repeat(level + 1);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return q(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + jsLiteral(v, level + 1)).join(",\n")},\n${pad}]` : "[]";
  const entries = Object.entries(value as Record<string, JsonValue>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${inner}${identifier(k)}: ${jsLiteral(v, level + 1)}`).join(",\n")},\n${pad}}` : "{}";
}

/** The `judgments({...})` argument: sugar per property, and which sugar names it uses. */
function questionsCode(spec: JudgeSpec, lang: "javascript" | "python"): { lines: string[]; uses: Set<string> } {
  const uses = new Set<string>();
  const lines: string[] = [];
  const pad = lang === "python" ? "    " : "  ";
  const sep = lang === "python" ? "=" : ": ";
  for (const [name, prop] of Object.entries(spec.properties)) {
    const call = sugar(name, prop, lang);
    if (call) { uses.add(call.slice(0, call.indexOf("("))); lines.push(`${pad}${lang === "python" ? name : identifier(name)}${sep}${call},`); }
    else lines.push(`${pad}${lang === "python" ? name : identifier(name)}${sep}${lang === "python" ? pyLiteral(prop, 1) : jsLiteral(prop, 1)},`);
  }
  return { lines, uses };
}

function jsInput(value: InputValue, level: number, jev: boolean): string {
  if (typeof value === "string") return q(value);
  if (Array.isArray(value)) {
    const turns = value as readonly Turn[];
    return jev ? jsLiteral(turns.map((t) => ({ role: t.role, content: t.content })), level) : `[${turns.map((t) => `Message.${t.role}(${q(t.content)})`).join(", ")}]`;
  }
  return jsLiteral(value as JsonValue, level);
}

function pyInput(value: InputValue, level: number, jev: boolean): string {
  if (typeof value === "string") return q(value);
  if (Array.isArray(value)) {
    const turns = value as readonly Turn[];
    return jev ? pyLiteral(turns.map((t) => ({ role: t.role, content: t.content })), level) : `[${turns.map((t) => `Message.${t.role}(${q(t.content)})`).join(", ")}]`;
  }
  return pyLiteral(value as JsonValue, level);
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

/** The JavaScript that judges every input in turn: this page's client, loaded as `lm15/browser`. */
export function judgeJavascript(connection: Connection, spec: JudgeSpec, inputs: readonly InputValue[]): string {
  const { lines: questionLines, uses } = questionsCode(spec, "javascript");
  const imports = [connection.provider === "custom" ? "OpenAIChatLM" : "adapterFor", ...(connection.provider === "anthropic" ? ["access"] : []), "Message", "Request", "judgments", ...[...uses].sort()];
  const jev = judgmentsOnly(connection.provider);
  const lines = [`import { ${imports.join(", ")} } from "lm15/browser";`, ""];
  const relay = baseUrlFor(connection);
  if (connection.provider === "custom") lines.push("const lm = new OpenAIChatLM({", '  apiKey: "unused", // keyless custom server', `  baseUrl: ${q(connection.endpoint)},`, "});");
  else {
    lines.push(`const lm = adapterFor(${q(connection.provider)}, {`, `  apiKey: ${q(keyless(connection.provider) ? "unused" : EXAMPLE_API_KEY)},`);
    if (relay !== undefined) lines.push("  // This API refuses browser origins; the page relays it (see the Relay note). Drop this line outside a browser.", `  baseUrl: ${q(relay)},`);
    if (connection.provider === "anthropic") lines.push("  // A page must say it means to call Anthropic directly.", "  access: access.withHeaders(access.ANTHROPIC_API, {", `    ${q(ANTHROPIC_BROWSER_HEADER[0])}: ${q(ANTHROPIC_BROWSER_HEADER[1])},`, "  }),");
    lines.push("});");
  }
  lines.push("", "// Declared keys in, a distribution out (MAP-14).", "const questions = judgments({", ...questionLines, "});", "");
  lines.push(`// ${SHAPE_NOTE[spec.shape]}.`, "const inputs = [", ...inputs.map((v) => `  ${jsInput(v, 1, jev)},`), "];", "");
  const instructions = spec.instructions.trim();
  let messages: string;
  if (jev) {
    // The state, as the caller writes it (D4): verbatim, with the instructions as a named key.
    const state = spec.shape === "conversation" ? (instructions ? `{ ${JEV_INSTRUCTIONS_KEY}: ${q(instructions)}, messages: input }` : "{ messages: input }")
      : spec.shape === "fields" ? (instructions ? `{ ${JEV_INSTRUCTIONS_KEY}: ${q(instructions)}, ...input }` : "input")
      : instructions ? `{ ${JEV_INSTRUCTIONS_KEY}: ${q(instructions)}, ${JEV_TEXT_KEY}: input }` : "input";
    messages = spec.shape === "text" && !instructions ? "[Message.user(input)]" : `[Message.user({ type: "data", value: ${state} })]`;
    if (instructions || spec.shape === "conversation") lines.push(`// ${JEV_STATE_NOTE[spec.shape]}.`);
  } else messages = spec.shape === "conversation" ? "input" : spec.shape === "fields" ? '[Message.user({ type: "data", value: input })]' : "[Message.user(input)]";
  lines.push("for (const input of inputs) {", "  const request = Request.create({", `    model: ${q(connection.model)},`);
  if (instructions && !jev) lines.push(`    system: ${q(instructions)},`);
  lines.push(`    messages: ${messages},`, `    config: { responseFormat: questions, probabilities: "if_available" },`, "  });", "  const response = await lm.complete(request);", "  console.log(response.data); // the picked key per judgment", "  console.log(response.probabilities); // one distribution per judgment where the provider measures one; else absent and recorded", "  console.log(response.adaptations); // MAP-13: what this wire could not take as asked", "}");
  return lines.join("\n");
}

const PY_CLASS: Record<string, string> = { "openai-responses": "AsyncOpenAILM", "openai-chat": "AsyncOpenAIChatLM", anthropic: "AsyncAnthropicLM", gemini: "AsyncGeminiLM", typesafe: "AsyncTypeSafeLM" };

/** The Python of the same loop: under Pyodide in this page, on CPython without the transport line. */
export function judgePython(connection: Connection, spec: JudgeSpec, inputs: readonly InputValue[]): string {
  const definition = lookup(connection.provider);
  const cls = connection.provider === "custom" ? "AsyncOpenAIChatLM" : (PY_CLASS[definition?.dialect ?? "openai-chat"] ?? "AsyncOpenAIChatLM");
  const { lines: questionLines, uses } = questionsCode(spec, "python");
  const jev = judgmentsOnly(connection.provider);
  const instructions = spec.instructions.trim();
  const usesData = spec.shape === "fields" || (jev && (Boolean(instructions) || spec.shape === "conversation"));
  const names = [cls, "Config", "Message", "Request", "judgments", ...(usesData ? ["data"] : []), ...uses].sort();
  const lines = [`from lm15 import ${names.join(", ")}`];
  if (connection.provider === "anthropic") lines.push("from lm15.access import ANTHROPIC_API");
  lines.push("from lm15.transports import FetchTransport  # in a page (Pyodide); on CPython drop this and transport=", "", `lm = ${cls}(`, `    api_key=${q(keyless(connection.provider) ? "unused" : EXAMPLE_API_KEY)},`);
  const relay = baseUrlFor(connection);
  if (connection.provider === "custom") lines.push(`    base_url=${q(connection.endpoint)},`);
  else if (relay !== undefined) lines.push("    # This API refuses browser origins; the page relays it (see the Relay note). Drop this line outside a browser.", `    base_url=${q(relay)},`);
  if (connection.provider !== "custom" && definition?.bound) lines.push(`    compat=${q(connection.provider)},`);
  if (connection.provider === "anthropic") lines.push("    # A page must say it means to call Anthropic directly.", `    access=ANTHROPIC_API.with_headers({${q(ANTHROPIC_BROWSER_HEADER[0])}: ${q(ANTHROPIC_BROWSER_HEADER[1])}}),`);
  lines.push("    transport=FetchTransport(),", ")", "", "# Declared keys in, a distribution out (MAP-14).", "questions = judgments(", ...questionLines, ")", "");
  lines.push(`# ${SHAPE_NOTE[spec.shape]}.`, "inputs = [", ...inputs.map((v) => `    ${pyInput(v, 1, jev)},`), "]", "");
  let messages: string;
  if (jev) {
    const state = spec.shape === "conversation" ? (instructions ? `{${q(JEV_INSTRUCTIONS_KEY)}: ${q(instructions)}, "messages": x}` : `{"messages": x}`)
      : spec.shape === "fields" ? (instructions ? `{${q(JEV_INSTRUCTIONS_KEY)}: ${q(instructions)}, **x}` : "x")
      : instructions ? `{${q(JEV_INSTRUCTIONS_KEY)}: ${q(instructions)}, ${q(JEV_TEXT_KEY)}: x}` : "x";
    messages = spec.shape === "text" && !instructions ? "[Message.user(x)]" : `[Message.user(data(${state}))]`;
    if (instructions || spec.shape === "conversation") lines.push(`# ${JEV_STATE_NOTE[spec.shape]}.`);
  } else messages = spec.shape === "conversation" ? "x" : spec.shape === "fields" ? "[Message.user(data(x))]" : "[Message.user(x)]";
  lines.push("for x in inputs:", "    request = Request(", `        model=${q(connection.model)},`);
  if (instructions && !jev) lines.push(`        system=${q(instructions)},`);
  lines.push(`        messages=${messages},`, `        config=Config(response_format=questions, probabilities="if_available"),`, "    )", "    response = await lm.complete(request)", "    print(response.data)  # the picked key per judgment", "    print(response.probabilities)  # one distribution per judgment where the provider measures one; else None and recorded", "    print(response.adaptations)  # MAP-13: what this wire could not take as asked");
  return lines.join("\n");
}

export function judgeRust(): string {
  return RUST_NOT_YET;
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
