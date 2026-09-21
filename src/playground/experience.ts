/**
 * What the playground shares between its interface and its code panel:
 * the connection, the settings, the request they make, and the same
 * request rendered as JavaScript, Python, Rust and Go — each the real SDK's
 * own API, and each selectable as the executing runtime.
 *
 * The rendered code is what runs: the JavaScript runtime is this page's
 * own client; the Python runtime executes the Python text below under
 * Pyodide; the Rust runtime is the compiled lm15-rs codec, driven with the
 * same request the Rust text below builds natively. Credentials are always
 * placeholders in the text.
 */

import { Message, OpenAIChatLM, RawNumber, Request as RequestNs, adapterFor, access, lookup, stringifyJson, type Config, type ContinuationState, type ProviderLM, type ReasoningEffort, type Request } from "lm15/browser";
import { api, comment, dim, finish, quotedValue, val, type Code } from "./marks.ts";
import { relayBaseUrl, relayed } from "./relay.ts";

export interface Connection { provider: string; model: string; endpoint: string }
export interface Settings {
  system: string;
  temperature: number | null;
  maxTokens: number | null;
  reasoning: ReasoningEffort | "";
}
export type Language = "javascript" | "python" | "rust" | "go";
export const LANGUAGES: ReadonlyArray<{ id: Language; label: string }> = [
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
];
export const EXAMPLE_API_KEY = "sk-just-kidding";
export const EXAMPLE_QUESTION = "What is LM15?";
export const EXAMPLE_ANSWER = "LM15 lets you use different model providers through one consistent interface.";
export const EXAMPLE_DRAFT = "Can you show me a tiny example?";
export const DEFAULT_SETTINGS: Settings = { system: "You are an LM15 teacher. Explain things simply and keep answers short.", temperature: null, maxTokens: null, reasoning: "" };
export function exampleConversation(): Message[] { return [Message.user(EXAMPLE_QUESTION), Message.assistant(EXAMPLE_ANSWER)]; }

/** The Anthropic API refuses a browser origin unless the caller says it means it. */
export const ANTHROPIC_BROWSER_HEADER = ["anthropic-dangerous-direct-browser-access", "true"] as const;

export function keyless(provider: string): boolean {
  return provider === "ollama" || provider === "custom";
}

/** TypeSafe (Jev) answers declared judgments only (MAP-14): it has no chat; the page judges with it (judge.ts). */
export function judgmentsOnly(provider: string): boolean {
  return provider === "typesafe";
}

/** A provider that answers in one piece (TypeSafe): `complete`, never `stream`. */
export function streams(connection: Connection): boolean {
  return connection.provider === "custom" || (lookup(connection.provider)?.access.supports.stream ?? true);
}

/** Where the SDK sends this connection: the provider directly, or the relay once the user enabled it for that provider (relay.ts). */
export function baseUrlFor(connection: Connection): string | undefined {
  if (connection.provider === "custom") return connection.endpoint;
  return relayed(connection.provider) ? relayBaseUrl(connection.provider) : undefined;
}

export function keyPage(provider: string): string | undefined {
  return lookup(provider)?.consoleUrl;
}

export function createClient(connection: Connection, key?: string): ProviderLM {
  const id = connection.provider;
  if (!key && !keyless(id)) throw new Error("Add this provider's API key first.");
  if (id === "custom") {
    const url = new URL(connection.endpoint);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("Use an HTTP(S) API root without credentials, query parameters, or fragments.");
    }
    return new OpenAIChatLM({ apiKey: key ?? "unused", baseUrl: url.href.replace(/\/$/, "") });
  }
  const baseUrl = baseUrlFor(connection);
  return adapterFor(id, {
    apiKey: key ?? "unused",
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(id === "anthropic" ? { access: access.withHeaders(access.ANTHROPIC_API, { [ANTHROPIC_BROWSER_HEADER[0]]: ANTHROPIC_BROWSER_HEADER[1] }) } : {}),
  });
}

/** The one Request every runtime sends: the transcript, the new message, the settings. */
export function buildRequest(connection: Connection, settings: Settings, messages: readonly Message[], text: string): Request {
  const config: Record<string, unknown> = {};
  if (settings.maxTokens !== null) config["maxTokens"] = settings.maxTokens;
  if (settings.temperature !== null) config["temperature"] = settings.temperature;
  if (settings.reasoning) config["reasoning"] = { effort: settings.reasoning };
  return RequestNs.create({
    model: connection.model.trim(),
    ...(settings.system.trim() ? { system: settings.system.trim() } : {}),
    messages: [...messages, Message.user(text)],
    ...(Object.keys(config).length ? { config: config as Config } : {}),
  });
}

// ─── Rendering ────────────────────────────────────────────────────────
//
// Each program is written with its meaning marked as it goes (marks.ts):
// `qv` a value the person typed, `api` a call into LM15, `comment`, `dim`
// for what the language demands. The panel colours those; nothing parses.

const q = JSON.stringify;
/** A JSON string literal whose contents are the person's; `source` names the control it came from (the panel lights it on hover). */
const qv = (text: string, source?: string): string => quotedValue(q(text), source);
/** A number the person set. */
const nv = (n: number, source?: string): string => val(String(n), source);
/** The transcript's turns are named by position; the composer's draft is the last one. */
export const turnSource = (index: number): string => `turn:${index}`;
const indent = (text: string, level: number) => text.split("\n").map((line) => (line ? "  ".repeat(level) + line : line)).join("\n");

/** Python spelling of a JSON value (True/False/None), for the replayed transcript. */
function pyLiteral(value: unknown, level = 0): string {
  const pad = "    ".repeat(level);
  const inner = "    ".repeat(level + 1);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (value instanceof RawNumber) return value.raw; // a number as the wire spelled it (opaque payloads keep their lexeme)
  if (typeof value === "string") return q(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + pyLiteral(v, level + 1)).join(",\n")},\n${pad}]` : "[]";
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${inner}${q(k)}: ${pyLiteral(v, level + 1)}`).join(",\n")},\n${pad}}` : "{}";
}

/**
 * A reply the SDK's own constructors can spell: thinking and text parts, each
 * carrying its replay state as `continuation` (an OpenAI reasoning item, an
 * Anthropic signature, a Gemini thought signature) whose data is strings —
 * what every dialect writes. Anything else (tool calls, media, numbers in an
 * opaque payload, state on the message itself) keeps the canonical JSON replay.
 */
interface ReplayPart { readonly type: "thinking" | "text"; readonly text: string; readonly continuation: readonly ContinuationState[] }
function replayParts(message: Message): ReplayPart[] | undefined {
  if (message.role !== "assistant" || message.continuation?.length) return;
  const parts: ReplayPart[] = [];
  for (const part of message.parts) {
    if (part.type !== "thinking" && part.type !== "text") return;
    const continuation = part.continuation ?? [];
    if (!continuation.every((state) => Object.values(state.data).every((value) => typeof value === "string"))) return;
    parts.push({ type: part.type, text: part.text, continuation });
  }
  return parts.length ? parts : undefined;
}
/** The state's data as a flat literal in each language (strings only, by `replayParts`). */
const dataEntries = (state: ContinuationState): Array<[string, string]> => Object.entries(state.data).map(([k, v]) => [k, v as string]);
const jsIdentifier = /^[A-Za-z_$][\w$]*$/;
const jsData = (state: ContinuationState): string => `{ ${dataEntries(state).map(([k, v]) => `${jsIdentifier.test(k) ? k : q(k)}: ${q(v)}`).join(", ")} }`;
const pyData = (state: ContinuationState): string => `{${dataEntries(state).map(([k, v]) => `${q(k)}: ${q(v)}`).join(", ")}}`;
const goData = (state: ContinuationState): string => `lm15.JSONObject{${dataEntries(state).map(([k, v]) => `${q(k)}: ${q(v)}`).join(", ")}}`;
const rustData = (state: ContinuationState): string => `json!({ ${dataEntries(state).map(([k, v]) => `${rustString(k)}: ${rustString(v)}`).join(", ")} })`;

/** JavaScript: `Message.assistant([thinking("", { continuation: continuationState(...) }), "the answer"])`, one part per line. */
function jsReplay(parts: readonly ReplayPart[], source: string): string[] {
  const state = (s: ContinuationState) => `${api("continuationState")}(${q(s.provider)}, ${q(s.kind)}, ${jsData(s)})`;
  const states = (c: readonly ContinuationState[]) => `{ continuation: ${c.length === 1 ? state(c[0]!) : `[${c.map(state).join(", ")}]`} }`;
  return [`${api("Message.assistant")}([`, ...parts.map((p) => p.type === "thinking"
    ? `  ${api("thinking")}(${qv(p.text)}${p.continuation.length ? `, ${states(p.continuation)}` : ""}),`
    : p.continuation.length ? `  ${api("text")}(${qv(p.text, source)}, ${states(p.continuation)}),` : `  ${qv(p.text, source)},`), "]),"];
}
/** Python: the same shape with `ContinuationState(...)`; `thinking` and `text` come from `lm15.types`. */
function pyReplay(parts: readonly ReplayPart[], source: string, pad: string): string[] {
  const state = (s: ContinuationState) => `${api("ContinuationState")}(${q(s.provider)}, ${q(s.kind)}, ${pyData(s)})`;
  const states = (c: readonly ContinuationState[]) => `continuation=${c.length === 1 ? state(c[0]!) : `[${c.map(state).join(", ")}]`}`;
  return [`${pad}${api("Message.assistant")}([`, ...parts.map((p) => p.type === "thinking"
    ? `${pad}    ${api("thinking")}(${qv(p.text)}${p.continuation.length ? `, ${states(p.continuation)}` : ""}),`
    : p.continuation.length ? `${pad}    ${api("text")}(${qv(p.text, source)}, ${states(p.continuation)}),` : `${pad}    ${qv(p.text, source)},`), `${pad}]),`];
}
/** The names a program needs beyond `Message` to spell its replayed replies. */
function replayNames(messages: readonly Message[]): { thinking: boolean; text: boolean; state: boolean } {
  const names = { thinking: false, text: false, state: false };
  for (const message of messages) {
    if (plainText(message)) continue;
    for (const part of replayParts(message) ?? []) {
      if (part.type === "thinking") names.thinking = true;
      else if (part.continuation.length) names.text = true;
      if (part.continuation.length) names.state = true;
    }
  }
  return names;
}

/** Only use shorthand when it preserves the complete canonical message. */
function plainText(message: Message): { role: "user" | "assistant"; text: string } | undefined {
  const data = Message.toJSON(message);
  if (Object.keys(data).sort().join(",") !== "parts,role" || (data.role !== "user" && data.role !== "assistant")) return;
  const parts = data.parts;
  if (!Array.isArray(parts) || parts.length !== 1) return;
  const part = parts[0];
  if (!part || typeof part !== "object" || Array.isArray(part) || part instanceof RawNumber || Object.keys(part).sort().join(",") !== "text,type" || part.type !== "text" || typeof part.text !== "string") return;
  return { role: data.role, text: part.text };
}

function configLines(settings: Settings, lang: Language): string[] {
  const entries: Array<[string, string]> = [];
  if (lang === "javascript") {
    if (settings.maxTokens !== null) entries.push(["maxTokens", nv(settings.maxTokens, "maxTokens")]);
    if (settings.temperature !== null) entries.push(["temperature", nv(settings.temperature, "temperature")]);
    if (settings.reasoning) entries.push(["reasoning", `{ effort: ${qv(settings.reasoning, "reasoning")} }`]);
    return entries.length ? [`  config: { ${entries.map(([k, v]) => `${k}: ${v}`).join(", ")} },`] : [];
  }
  if (lang === "python") {
    if (settings.maxTokens !== null) entries.push(["max_tokens", nv(settings.maxTokens, "maxTokens")]);
    if (settings.temperature !== null) entries.push(["temperature", nv(settings.temperature, "temperature")]);
    if (settings.reasoning) entries.push(["reasoning", `${api("Reasoning")}(effort=${qv(settings.reasoning, "reasoning")})`]);
    return entries.length ? [`    config=${api("Config")}(${entries.map(([k, v]) => `${k}=${v}`).join(", ")}),`] : [];
  }
  if (settings.maxTokens !== null) entries.push(["max_tokens", `Some(${nv(settings.maxTokens, "maxTokens")})`]);
  if (settings.temperature !== null) entries.push(["temperature", `Some(${val(Number.isInteger(settings.temperature) ? `${settings.temperature}.0` : String(settings.temperature), "temperature")})`]);
  if (settings.reasoning) entries.push(["reasoning", `Some(${api("Reasoning::new")}(${quotedValue(rustString(settings.reasoning), "reasoning")}.parse()?))`]);
  return entries.length ? [`    config: ${api("Config")} { ${entries.map(([k, v]) => `${k}: ${v}`).join(", ")}, ${dim("..Default::default()")} },`] : [];
}

/** The lines that make the client, JavaScript: the adapter, and what a page must add (relay, Anthropic's header). */
export function jsClient(connection: Connection): string[] {
  const relay = baseUrlFor(connection);
  if (connection.provider === "custom") return [`const lm = new ${api("OpenAIChatLM")}({`, `  apiKey: "unused", ${comment("// keyless custom server")}`, `  baseUrl: ${qv(connection.endpoint, "provider")},`, "});"];
  const lines = [`const lm = ${api("adapterFor")}(${qv(connection.provider, "provider")}, {`, `  apiKey: ${keyless(connection.provider) ? '"unused"' : qv(EXAMPLE_API_KEY)},`];
  if (relay !== undefined) lines.push(`  ${comment("// This API refuses browser origins; the page relays it (see the Relay note). Drop this line outside a browser.")}`, `  baseUrl: ${qv(relay)},`);
  if (connection.provider === "anthropic") lines.push(`  ${comment("// A page must say it means to call Anthropic directly.")}`, `  access: ${api("access.withHeaders")}(${api("access.ANTHROPIC_API")}, {`, `    ${q(ANTHROPIC_BROWSER_HEADER[0])}: ${q(ANTHROPIC_BROWSER_HEADER[1])},`, "  }),");
  lines.push("});");
  return lines;
}

export function exampleJavascript(connection: Connection, settings: Settings, messages: readonly Message[], prompt: string): Code {
  const streamed = streams(connection);
  const replay = replayNames(messages);
  const imports = [connection.provider === "custom" ? "OpenAIChatLM" : "adapterFor", "Message", "Request", ...(streamed ? ["ResponseStream"] : []), ...(replay.state ? ["continuationState"] : []), ...(replay.text ? ["text"] : []), ...(replay.thinking ? ["thinking"] : [])];
  if (connection.provider === "anthropic") imports.splice(1, 0, "access");
  const chunk = replay.text ? "piece" : "text"; // the streamed variable steps aside for the `text` constructor
  const lines = [dim(`import { ${imports.join(", ")} } from "lm15/browser";`), "", ...jsClient(connection)];
  lines.push("", `const request = ${api("Request.create")}({`, `  model: ${qv(connection.model, "model")},`);
  if (settings.system.trim()) lines.push(`  system: ${qv(settings.system.trim(), "system")},`);
  if (messages.length) {
    lines.push("  messages: [", ...indent(messages.map((m, i) => {
      const simple = plainText(m);
      if (simple) return `${api(`Message.${simple.role}`)}(${qv(simple.text, turnSource(i))}),`;
      const parts = replayParts(m);
      return parts ? jsReplay(parts, turnSource(i)).join("\n") : `${api("Message.fromJSON")}(${stringifyJson(Message.toJSON(m), { indent: 2 })}),`;
    }).join("\n"), 2).split("\n"), `    ${api("Message.user")}(${qv(prompt, "draft")}),`, "  ],");
  } else lines.push(`  messages: [${api("Message.user")}(${qv(prompt, "draft")})],`);
  lines.push(...configLines(settings, "javascript"), "});", "");
  if (streamed) {
    lines.push(`const controller = new AbortController(); ${comment("// Stop calls controller.abort()")}`, `const result = new ${api("ResponseStream")}(${api("lm.stream")}(request, { signal: controller.signal }), request);`, `for await (const ${chunk} of result) console.log(${chunk});`, "", comment("// Keep the reply for the next turn."), `const response = await ${api("result.response")}();`);
  } else {
    lines.push(`const controller = new AbortController(); ${comment("// Stop calls controller.abort()")}`, `const response = await ${api("lm.complete")}(request, { signal: controller.signal }); ${comment("// one piece: this API has no stream")}`);
  }
  lines.push("const messages = [...request.messages, response.message];");
  return finish(lines.join("\n"));
}

const PY_CLASS: Record<string, string> = { "openai-responses": "AsyncOpenAILM", "openai-chat": "AsyncOpenAIChatLM", anthropic: "AsyncAnthropicLM", gemini: "AsyncGeminiLM", typesafe: "AsyncTypeSafeLM" };

/** The Python client's class for a connection, and the lines that make it (the transport line is the page's; CPython drops it). */
export function pyClient(connection: Connection): { cls: string; lines: string[] } {
  const definition = lookup(connection.provider);
  const cls = connection.provider === "custom" ? "AsyncOpenAIChatLM" : (PY_CLASS[definition?.dialect ?? "openai-chat"] ?? "AsyncOpenAIChatLM");
  const lines = [`lm = ${api(cls)}(`, `    api_key=${keyless(connection.provider) ? '"unused"' : qv(EXAMPLE_API_KEY)},`];
  const relay = baseUrlFor(connection);
  if (connection.provider === "custom") lines.push(`    base_url=${qv(connection.endpoint, "provider")},`);
  else if (relay !== undefined) lines.push(`    ${comment("# This API refuses browser origins; the page relays it (see the Relay note). Drop this line outside a browser.")}`, `    base_url=${qv(relay)},`);
  if (connection.provider !== "custom" && definition?.bound) lines.push(`    compat=${qv(connection.provider, "provider")},`);
  if (connection.provider === "anthropic") lines.push(`    ${comment("# A page must say it means to call Anthropic directly.")}`, `    access=${api("ANTHROPIC_API.with_headers")}({${q(ANTHROPIC_BROWSER_HEADER[0])}: ${q(ANTHROPIC_BROWSER_HEADER[1])}}),`);
  lines.push(dim("    transport=FetchTransport(),"), ")");
  return { cls, lines };
}

/** The Python import lines: the SDK names used, in one `from lm15 import`. */
export function pyImports(names: readonly string[], connection: Connection, extra: readonly string[] = []): string[] {
  const lines = [dim(`from lm15 import ${[...names].sort().join(", ")}`)];
  if (connection.provider === "anthropic") lines.push(dim("from lm15.access import ANTHROPIC_API"));
  lines.push(...extra.map(dim), dim(`from lm15.transports import FetchTransport  ${comment("# in a page (Pyodide); on CPython drop this and transport=")}`));
  return lines;
}

/** The Python that runs under Pyodide in this page, and on CPython without the transport line. */
export function examplePython(connection: Connection, settings: Settings, messages: readonly Message[], prompt: string): Code {
  const client = pyClient(connection);
  const streamed = streams(connection);
  const replay = replayNames(messages);
  const names = [client.cls, ...(streamed ? ["AsyncResponseStream"] : []), "Message", "Request", ...(replay.state ? ["ContinuationState"] : [])];
  if (configLines(settings, "python").length) names.push("Config");
  if (settings.reasoning) names.push("Reasoning");
  const factories = [...(replay.text ? ["text"] : []), ...(replay.thinking ? ["thinking"] : [])];
  const chunk = replay.text ? "piece" : "text";
  const lines = pyImports(names, connection, [
    ...(factories.length ? [`from lm15.types import ${factories.join(", ")}`] : []),
    ...(messages.some((message) => !plainText(message) && !replayParts(message)) ? ["from lm15.serde import message_from_dict"] : []),
  ]);
  lines.push("", ...client.lines, "", `request = ${api("Request")}(`, `    model=${qv(connection.model, "model")},`);
  if (settings.system.trim()) lines.push(`    system=${qv(settings.system.trim(), "system")},`);
  if (messages.length) {
    lines.push("    messages=(", ...messages.flatMap((m, i) => {
      const simple = plainText(m);
      if (simple) return [`        ${api(`Message.${simple.role}`)}(${qv(simple.text, turnSource(i))}),`];
      const parts = replayParts(m);
      return parts ? pyReplay(parts, turnSource(i), "        ") : [`        ${api("message_from_dict")}(${pyLiteral(Message.toJSON(m), 2)}),`];
    }), `        ${api("Message.user")}(${qv(prompt, "draft")}),`, "    ),");
  } else lines.push(`    messages=(${api("Message.user")}(${qv(prompt, "draft")}),),`);
  lines.push(...configLines(settings, "python"), ")", "");
  if (streamed) lines.push(`result = ${api("AsyncResponseStream")}(${api("lm.stream")}(request), request)  ${comment("# Stop closes the stream")}`, `async for ${chunk} in result:`, `    print(${chunk}, end="", flush=True)`, "", comment("# Keep the reply for the next turn."), `response = await ${api("result.response")}()`);
  else lines.push(`response = await ${api("lm.complete")}(request)  ${comment("# one piece: this API has no stream")}`);
  lines.push("messages = (*request.messages, response.message)");
  return finish(lines.join("\n"));
}

/** Rust string literal (JSON's control escapes are not all Rust escapes). */
export function rustString(text: string): string {
  return '"' + Array.from(text, (char) => {
    if (char === '"') return '\\"';
    if (char === "\\") return "\\\\";
    if (char === "\n") return "\\n";
    if (char === "\r") return "\\r";
    if (char === "\t") return "\\t";
    const code = char.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) throw new Error("Rust text cannot contain an unpaired surrogate");
    return code < 32 ? `\\u{${code.toString(16)}}` : char;
  }).join("") + '"';
}

/** A Rust string literal whose contents are the person's. */
export const rv = (text: string, source?: string): string => quotedValue(rustString(text), source);

/** The Rust adapter: `adapter_for` with the credential and, in a page, the relay. */
export function rustClient(connection: Connection): string[] {
  const provider = connection.provider === "custom" ? "openai-chat" : connection.provider;
  const relay = baseUrlFor(connection);
  return [`let lm = ${api("adapter_for")}(`, `    ${rv(provider, "provider")}, ${api("Credential::api_key")}(${keyless(connection.provider) ? '"unused"' : rv(EXAMPLE_API_KEY)})?,`, `    ${relay === undefined ? "None" : `Some(${rv(relay)})`}, None, None,`, ")?;"];
}

/** A Go string literal holding JSON text: raw (backticks) when the text allows it, so the JSON reads as JSON. */
export function goJsonText(text: string): string {
  return text.includes("`") ? q(text) : "`" + text + "`";
}

/**
 * The frame of every Go program the page shows: package, imports, `main`
 * delegating to `run() error`, the adapter, and `ctx` (cancel stops a call).
 * `body` is the indented statements of `run`; `imports` its standard-library
 * imports beside the SDK.
 */
export function goProgram(connection: Connection, imports: readonly string[], body: readonly string[]): Code {
  const provider = connection.provider === "custom" ? "openai-chat" : connection.provider;
  const std = [...new Set(["context", ...imports])].sort().map((name) => `    ${q(name)}`);
  const lines = [dim("package main"), "", dim("import ("), ...std.map(dim), "", dim('    lm15 "github.com/lm15-dev/lm15-go"'), dim(")"), "", dim("func main() {"), dim("    if err := run(); err != nil { panic(err) }"), dim("}"), "", dim("func run() error {"), `    ctx, cancel := context.WithCancel(context.Background()) ${comment("// call cancel to stop")}`, "    defer cancel()"];
  const relay = baseUrlFor(connection);
  if (connection.provider !== "custom" && relay !== undefined) lines.push(`    ${comment('// This API refuses browser origins; the page relays it (see the Relay note). Outside a browser pass "" instead.')}`);
  lines.push(`    lm, err := ${api("lm15.AdapterForProvider")}(${qv(provider, "provider")}, ${keyless(connection.provider) ? '"unused"' : qv(EXAMPLE_API_KEY)}, ${relay === undefined ? '""' : qv(relay)}, nil, nil)`, GO_ERR, "", ...body, dim("    return nil"), dim("}"));
  return finish(lines.join("\n"));
}

/** Go's error check, as plumbing. */
export const GO_ERR = dim("    if err != nil { return err }");
export const GO_ERR_IN_LOOP = dim("        if err != nil { return err }");

/** The Go spelling of one transcript message: the SDK's constructor for plain text; the canonical JSON replayed for anything else (reasoning with continuation state). */
function goMessage(message: Message, index: number): { expression: string; replay?: string[] } {
  const simple = plainText(message);
  if (simple) return { expression: `${api(simple.role === "user" ? "lm15.UserMessage" : "lm15.AssistantText")}(${qv(simple.text, turnSource(index))})` };
  const parts = replayParts(message);
  if (parts) {
    // A multi-line composite literal; the caller writes it at 12 columns.
    const state = (s: ContinuationState) => `{Provider: ${q(s.provider)}, Kind: ${q(s.kind)}, Data: ${goData(s)}}`;
    const states = (c: readonly ContinuationState[]) => `Continuation: []${api("lm15.ContinuationState")}{${c.map(state).join(", ")}}`;
    const inner = parts.map((p) => p.type === "thinking"
      ? `${api("lm15.ThinkingPart")}{${[...(p.text ? [`Text: ${qv(p.text)}`] : []), ...(p.continuation.length ? [states(p.continuation)] : [])].join(", ")}}`
      : p.continuation.length ? `${api("lm15.TextPart")}{Text: ${qv(p.text, turnSource(index))}, ${states(p.continuation)}}` : `${api("lm15.Text")}(${qv(p.text, turnSource(index))})`);
    return { expression: [`${api("lm15.AssistantMessage")}(`, ...inner.map((line) => `                ${line},`), "            )"].join("\n") };
  }
  return { expression: "earlier", replay: [`    ${comment("// A reply replayed as the wire gave it (its reasoning and continuation state stay verbatim).")}`, `    var earlier ${api("lm15.Message")}`, `    if err := json.Unmarshal([]byte(${goJsonText(stringifyJson(Message.toJSON(message)))}), &earlier); err != nil { return err }`] };
}

function goConfig(settings: Settings): string | undefined {
  const entries: string[] = [];
  if (settings.maxTokens !== null) entries.push(`MaxTokens: lm15.I(${nv(settings.maxTokens, "maxTokens")})`);
  if (settings.temperature !== null) entries.push(`Temperature: lm15.F(${nv(settings.temperature, "temperature")})`);
  if (settings.reasoning) entries.push(`Reasoning: &${api("lm15.Reasoning")}{Effort: ${qv(settings.reasoning, "reasoning")}}`);
  return entries.length ? `${api("lm15.Config")}{${entries.join(", ")}}` : undefined;
}

/** The Go of the chat turn: the SDK's own constructors, streamed where the API streams. */
export function exampleGo(connection: Connection, settings: Settings, messages: readonly Message[], prompt: string): Code {
  if (judgmentsOnly(connection.provider)) return finish(comment("// TypeSafe is judgments-only. Open Judge to declare the questions."));
  const streamed = streams(connection);
  const rendered = messages.map((m, i) => goMessage(m, i));
  const body: string[] = [];
  const replays = rendered.flatMap((m) => m.replay ?? []);
  if (replays.length) body.push(...replays, "");
  const turns = [...rendered.map((m) => m.expression), `${api("lm15.UserMessage")}(${qv(prompt, "draft")})`];
  const config = goConfig(settings);
  const options = [...(settings.system.trim() ? [`${api("lm15.WithSystem")}(${qv(settings.system.trim(), "system")})`] : []), ...(config ? [`${api("lm15.WithConfig")}(${config})`] : [])];
  body.push(`    request, err := ${api("lm15.NewRequest")}(`, `        ${qv(connection.model, "model")},`);
  if (turns.length === 1) body.push(`        []lm15.Message{${turns[0]}},`);
  else body.push("        []lm15.Message{", ...turns.map((t) => `            ${t},`), "        },");
  body.push(...options.map((o) => `        ${o},`), "    )", GO_ERR, "");
  if (streamed) body.push(`    result := ${api("lm15.NewResponseStream")}(${api("lm.Stream")}(ctx, request), request)`, `    for text, err := range ${api("result.Text")}() {`, GO_ERR_IN_LOOP, "        fmt.Print(text)", "    }", `    response, err := ${api("result.Response")}()`);
  else body.push(`    response, err := ${api("lm.Complete")}(ctx, request) ${comment("// one piece: this API has no stream")}`);
  body.push(GO_ERR, ...(streamed ? [] : [`    fmt.Println(${api("response.TextOr")}(""))`]), "", `    ${comment("// Keep the reply for the next turn.")}`, "    request.Messages = append(request.Messages, response.Message)");
  return goProgram(connection, replays.length ? ["encoding/json", "fmt"] : ["fmt"], body);
}

export function exampleRust(connection: Connection, settings: Settings, messages: readonly Message[], prompt: string): Code {
  if (judgmentsOnly(connection.provider)) return finish(comment("// TypeSafe is judgments-only. Open Judge to declare the questions."));
  const imports = ["Message", "Request", "ResponseStream"];
  if (configLines(settings, "rust").length) imports.push("Config");
  if (settings.reasoning) imports.push("Reasoning");
  if (messages.some((message) => !plainText(message) && !replayParts(message))) imports.push("Canonical");
  const replay = replayNames(messages);
  if (replay.thinking || replay.text) imports.push("Part");
  if (replay.thinking) imports.push("ThinkingPart");
  if (replay.text) imports.push("TextPart");
  if (replay.state) imports.push("ContinuationState");
  const lines = [dim("use futures_util::StreamExt;"), dim("use lm15::{auth::Credential, registry::adapter_for};"), dim(`use lm15::{${imports.sort().join(", ")}};`), ...(replay.state ? [dim("use serde_json::json;")] : []), "", ...rustClient(connection), "", `let request = ${api("Request")} {`, `    model: ${rv(connection.model, "model")}.into(),`];
  if (settings.system.trim()) lines.push(`    system: Some(${rv(settings.system.trim(), "system")}.into()),`);
  if (messages.length) {
    lines.push("    messages: vec![", ...messages.flatMap((m, i) => {
      const simple = plainText(m);
      if (simple) return [`        ${api(`Message::${simple.role}`)}(${rv(simple.text, turnSource(i))})?,`];
      const parts = replayParts(m);
      if (!parts) return [`        ${api("Message::from_json")}(&serde_json::from_str(${rustString(stringifyJson(Message.toJSON(m)))})?)?,`];
      const state = (s: ContinuationState) => `${api("ContinuationState::new")}(${rustString(s.provider)}, ${rustString(s.kind)}, serde_json::from_value(${rustData(s)})?)?`;
      const states = (c: readonly ContinuationState[]) => `continuation: vec![${c.map(state).join(", ")}],`;
      return [`        ${api("Message::assistant")}(vec![`, ...parts.flatMap((p) => {
        if (!p.continuation.length) return [`            ${api(p.type === "thinking" ? "Part::thinking" : "Part::text")}(${rv(p.text, p.type === "text" ? turnSource(i) : undefined)}),`];
        const kind = p.type === "thinking" ? ["Part::Thinking", "ThinkingPart"] : ["Part::Text", "TextPart"];
        return [`            ${api(kind[0]!)}(${api(kind[1]!)} {`, `                text: ${rv(p.text, p.type === "text" ? turnSource(i) : undefined)}.into(),`, `                ${states(p.continuation)}`, "            }),"];
      }), "        ])?,"];
    }), `        ${api("Message::user")}(${rv(prompt, "draft")})?,`, "    ],");
  } else lines.push(`    messages: vec![${api("Message::user")}(${rv(prompt, "draft")})?],`);
  lines.push(...configLines(settings, "rust"), dim("    ..Default::default()"), "};", "", `let mut result = ${api("ResponseStream::new")}(${api("lm.stream")}(&request), &request); ${comment("// drop it to stop")}`, `while let Some(text) = ${api("result.text_chunks")}().next().await {`, '    print!("{}", text?);', "}", "", comment("// Keep the reply for the next turn."), `let response = ${api("result.response")}().await?;`, "let mut messages = request.messages.clone();", "messages.push(response.message.clone());");
  return finish(lines.join("\n"));
}

export interface Wire { method: string; url: string; headers: Array<[string, string]>; body: string }

/** Stable fuzzy ranking: exact, prefix, substring, then ordered-character matches. */
export function fuzzyScore(query: string, candidate: string): number {
  const qq = query.trim().toLowerCase();
  const c = candidate.toLowerCase();
  if (!qq) return 0;
  if (c === qq) return 10000;
  if (c.startsWith(qq)) return 8000 - c.length;
  const index = c.indexOf(qq);
  if (index !== -1) return 6000 - index - c.length;
  let previous = -1, gap = 0;
  for (const char of qq) {
    const found = c.indexOf(char, previous + 1);
    if (found === -1) return -Infinity;
    gap += found - previous - 1;
    previous = found;
  }
  return 2000 - gap - c.length;
}

export type PickerKind = "commands" | "provider" | "model";
export function slashCommand(text: string): { kind: PickerKind; query: string } | undefined {
  if (!text.startsWith("/") || text.includes("\n")) return undefined;
  const command = /^\/(provider|model)(?:\s+(.*))?$/.exec(text);
  if (command) return { kind: command[1] as "provider" | "model", query: command[2] ?? "" };
  return { kind: "commands", query: text.slice(1) };
}
