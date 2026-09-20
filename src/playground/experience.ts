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

import { Message, OpenAIChatLM, RawNumber, Request as RequestNs, adapterFor, access, lookup, stringifyJson, type Config, type ProviderLM, type ReasoningEffort, type Request } from "lm15/browser";
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
  if (!key && !keyless(id)) throw new Error("Add this provider's API key in Settings first.");
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

const q = JSON.stringify;
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
    if (settings.maxTokens !== null) entries.push(["maxTokens", String(settings.maxTokens)]);
    if (settings.temperature !== null) entries.push(["temperature", String(settings.temperature)]);
    if (settings.reasoning) entries.push(["reasoning", `{ effort: ${q(settings.reasoning)} }`]);
    return entries.length ? [`  config: { ${entries.map(([k, v]) => `${k}: ${v}`).join(", ")} },`] : [];
  }
  if (lang === "python") {
    if (settings.maxTokens !== null) entries.push(["max_tokens", String(settings.maxTokens)]);
    if (settings.temperature !== null) entries.push(["temperature", String(settings.temperature)]);
    if (settings.reasoning) entries.push(["reasoning", `Reasoning(effort=${q(settings.reasoning)})`]);
    return entries.length ? [`    config=Config(${entries.map(([k, v]) => `${k}=${v}`).join(", ")}),`] : [];
  }
  if (settings.maxTokens !== null) entries.push(["max_tokens", `Some(${settings.maxTokens})`]);
  if (settings.temperature !== null) entries.push(["temperature", `Some(${Number.isInteger(settings.temperature) ? `${settings.temperature}.0` : settings.temperature})`]);
  if (settings.reasoning) entries.push(["reasoning", `Some(Reasoning::new(${q(settings.reasoning)}.parse()?))`]);
  return entries.length ? [`    config: Config { ${entries.map(([k, v]) => `${k}: ${v}`).join(", ")}, ..Default::default() },`] : [];
}

export function exampleJavascript(connection: Connection, settings: Settings, messages: readonly Message[], prompt: string): string {
  const streamed = streams(connection);
  const imports = [connection.provider === "custom" ? "OpenAIChatLM" : "adapterFor", "Message", "Request", ...(streamed ? ["ResponseStream"] : [])];
  if (connection.provider === "anthropic") imports.splice(1, 0, "access");
  const lines = [`import { ${imports.join(", ")} } from "lm15/browser";`, ""];
  const relay = baseUrlFor(connection);
  if (connection.provider === "custom") {
    lines.push("const lm = new OpenAIChatLM({", '  apiKey: "unused", // keyless custom server', `  baseUrl: ${q(connection.endpoint)},`, "});");
  } else {
    lines.push(`const lm = adapterFor(${q(connection.provider)}, {`, `  apiKey: ${q(keyless(connection.provider) ? "unused" : EXAMPLE_API_KEY)},`);
    if (relay !== undefined) lines.push("  // This API refuses browser origins; the page relays it (see the Relay note). Drop this line outside a browser.", `  baseUrl: ${q(relay)},`);
    if (connection.provider === "anthropic") lines.push("  // A page must say it means to call Anthropic directly.", "  access: access.withHeaders(access.ANTHROPIC_API, {", `    ${q(ANTHROPIC_BROWSER_HEADER[0])}: ${q(ANTHROPIC_BROWSER_HEADER[1])},`, "  }),");
    lines.push("});");
  }
  lines.push("", "const request = Request.create({", `  model: ${q(connection.model)},`);
  if (settings.system.trim()) lines.push(`  system: ${q(settings.system.trim())},`);
  if (messages.length) {
    lines.push("  messages: [", ...indent(messages.map((m) => {
      const simple = plainText(m);
      return simple ? `Message.${simple.role}(${q(simple.text)}),` : `Message.fromJSON(${stringifyJson(Message.toJSON(m), { indent: 2 })}),`;
    }).join("\n"), 2).split("\n"), `    Message.user(${q(prompt)}),`, "  ],");
  } else lines.push(`  messages: [Message.user(${q(prompt)})],`);
  lines.push(...configLines(settings, "javascript"), "});", "");
  if (streamed) {
    lines.push("const controller = new AbortController(); // Stop calls controller.abort()", "const result = new ResponseStream(lm.stream(request, { signal: controller.signal }), request);", "for await (const text of result) console.log(text);", "", "// Keep the reply for the next turn.", "const response = await result.response();");
  } else {
    lines.push("const controller = new AbortController(); // Stop calls controller.abort()", "const response = await lm.complete(request, { signal: controller.signal }); // one piece: this API has no stream");
  }
  lines.push("const messages = [...request.messages, response.message];");
  return lines.join("\n");
}

const PY_CLASS: Record<string, string> = { "openai-responses": "AsyncOpenAILM", "openai-chat": "AsyncOpenAIChatLM", anthropic: "AsyncAnthropicLM", gemini: "AsyncGeminiLM", typesafe: "AsyncTypeSafeLM" };

/** The Python that runs under Pyodide in this page, and on CPython without the transport line. */
export function examplePython(connection: Connection, settings: Settings, messages: readonly Message[], prompt: string): string {
  const definition = lookup(connection.provider);
  const cls = connection.provider === "custom" ? "AsyncOpenAIChatLM" : (PY_CLASS[definition?.dialect ?? "openai-chat"] ?? "AsyncOpenAIChatLM");
  const streamed = streams(connection);
  const names = [cls, ...(streamed ? ["AsyncResponseStream"] : []), "Message", "Request"];
  if (configLines(settings, "python").length) names.push("Config");
  if (settings.reasoning) names.push("Reasoning");
  const lines = [`from lm15 import ${names.sort().join(", ")}`];
  if (connection.provider === "anthropic") lines.push("from lm15.access import ANTHROPIC_API");
  if (messages.some((message) => !plainText(message))) lines.push("from lm15.serde import message_from_dict");
  lines.push("from lm15.transports import FetchTransport  # in a page (Pyodide); on CPython drop this and transport=", "", `lm = ${cls}(`, `    api_key=${q(keyless(connection.provider) ? "unused" : EXAMPLE_API_KEY)},`);
  const relay = baseUrlFor(connection);
  if (connection.provider === "custom") lines.push(`    base_url=${q(connection.endpoint)},`);
  else if (relay !== undefined) lines.push("    # This API refuses browser origins; the page relays it (see the Relay note). Drop this line outside a browser.", `    base_url=${q(relay)},`);
  if (connection.provider !== "custom" && definition?.bound) lines.push(`    compat=${q(connection.provider)},`);
  if (connection.provider === "anthropic") lines.push("    # A page must say it means to call Anthropic directly.", `    access=ANTHROPIC_API.with_headers({${q(ANTHROPIC_BROWSER_HEADER[0])}: ${q(ANTHROPIC_BROWSER_HEADER[1])}}),`);
  lines.push("    transport=FetchTransport(),", ")", "", "request = Request(", `    model=${q(connection.model)},`);
  if (settings.system.trim()) lines.push(`    system=${q(settings.system.trim())},`);
  if (messages.length) {
    lines.push("    messages=(", ...messages.map((m) => {
      const simple = plainText(m);
      return simple ? `        Message.${simple.role}(${q(simple.text)}),` : `        message_from_dict(${pyLiteral(Message.toJSON(m), 2)}),`;
    }), `        Message.user(${q(prompt)}),`, "    ),");
  } else lines.push(`    messages=(Message.user(${q(prompt)}),),`);
  lines.push(...configLines(settings, "python"), ")", "");
  if (streamed) lines.push("result = AsyncResponseStream(lm.stream(request), request)  # Stop closes the stream", "async for text in result:", '    print(text, end="", flush=True)', "", "# Keep the reply for the next turn.", "response = await result.response()");
  else lines.push("response = await lm.complete(request)  # one piece: this API has no stream");
  lines.push("messages = (*request.messages, response.message)");
  return lines.join("\n");
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

/** A complete Go program; canonical JSON keeps arbitrary data/continuation fields and number lexemes intact. */
export function goProgram(connection: Connection, requests: readonly Request[], stream: boolean): string {
  const provider = connection.provider === "custom" ? "openai-chat" : connection.provider;
  const lines = ["package main", "", 'import (', '    "context"', '    "encoding/json"', '    "fmt"', '    lm15 "github.com/lm15-dev/lm15-go"', ')', '', 'func main() {', '    if err := run(); err != nil { panic(err) }', '}', '', 'func run() error {', '    ctx, cancel := context.WithCancel(context.Background()) // call cancel to stop', '    defer cancel()', `    lm, err := lm15.AdapterForProvider(${q(provider)}, ${q(keyless(connection.provider) ? "unused" : EXAMPLE_API_KEY)}, ${q(baseUrlFor(connection) ?? "")}, nil, nil)`, '    if err != nil { return err }', '    inputs := []string{', ...requests.map((request) => `        ${q(stringifyJson(RequestNs.toJSON(request)))},`), '    }', '    for _, input := range inputs {', '        var request lm15.Request', '        if err := json.Unmarshal([]byte(input), &request); err != nil { return err }'];
  if (stream) lines.push('        result := lm15.NewResponseStream(lm.Stream(ctx, &request), &request)', '        for text, err := range result.Text() {', '            if err != nil { return err }', '            fmt.Print(text)', '        }', '        response, err := result.Response()');
  else lines.push('        response, err := lm.Complete(ctx, &request)');
  lines.push('        if err != nil { return err }', stream ? '        fmt.Println(response.TextOr(""))' : '        fmt.Println(response.Data(), response.Probabilities(), response.Adaptations)', '    }', '    return nil', '}');
  return lines.join("\n");
}

export function exampleGo(connection: Connection, settings: Settings, messages: readonly Message[], prompt: string): string {
  return goProgram(connection, [buildRequest(connection, settings, messages, prompt)], streams(connection));
}

export function exampleRust(connection: Connection, settings: Settings, messages: readonly Message[], prompt: string): string {
  if (judgmentsOnly(connection.provider)) return "// TypeSafe is judgments-only. Open Judge to declare the questions.";
  const q = rustString;
  const imports = ["Message", "Request", "ResponseStream"];
  if (configLines(settings, "rust").length) imports.push("Config");
  if (settings.reasoning) imports.push("Reasoning");
  if (messages.some((message) => !plainText(message))) imports.push("Canonical");
  const lines = ["use futures_util::StreamExt;", "use lm15::{auth::Credential, registry::adapter_for};", `use lm15::{${imports.sort().join(", ")}};`, ""];
  const provider = connection.provider === "custom" ? "openai-chat" : connection.provider;
  const relay = baseUrlFor(connection);
  lines.push("let lm = adapter_for(", `    ${q(provider)}, Credential::api_key(${q(keyless(connection.provider) ? "unused" : EXAMPLE_API_KEY)})?,`, `    ${relay === undefined ? "None" : `Some(${q(relay)})`}, None, None,`, ")?;", "", "let request = Request {", `    model: ${q(connection.model)}.into(),`);
  if (settings.system.trim()) lines.push(`    system: Some(${q(settings.system.trim())}.into()),`);
  if (messages.length) {
    lines.push("    messages: vec![", ...messages.map((m) => {
      const simple = plainText(m);
      return simple ? `        Message::${simple.role}(${q(simple.text)})?,` : `        Message::from_json(&serde_json::from_str(${q(stringifyJson(Message.toJSON(m)))})?)?,`;
    }), `        Message::user(${q(prompt)})?,`, "    ],");
  } else lines.push(`    messages: vec![Message::user(${q(prompt)})?],`);
  lines.push(...configLines(settings, "rust"), "    ..Default::default()", "};", "", "let mut result = ResponseStream::new(lm.stream(&request), &request); // drop it to stop", "while let Some(text) = result.text_chunks().next().await {", '    print!("{}", text?);', "}", "", "// Keep the reply for the next turn.", "let response = result.response().await?;", "let mut messages = request.messages.clone();", "messages.push(response.message.clone());");
  return lines.join("\n");
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
