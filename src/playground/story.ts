/**
 * The code panel's program for a chat: the conversation as a person would
 * write it. The transcript is a variable that grows; one `ask` helper sends
 * a message, prints the stream and keeps `response.message` (which carries
 * the model's reasoning state, so nothing opaque is ever typed); each turn
 * that was sent is one `ask(...)` call, with what the model answered echoed
 * beneath it as a comment.
 *
 * Turns come with their origin. `written` turns — the teaching example, or
 * a reply the person rewrote by hand — are spelled as literals, since no
 * call produced them. An `asked` turn followed by its `answered` reply is an
 * `ask`. This is the program to read and copy; what the page executes is the
 * snapshot in experience.ts, the same setup with the transcript restored and
 * one call, because re-running the story would ask the model again.
 */
import type { Message } from "lm15/browser";
import { api, comment, dim, finish, mark, type Code } from "./marks.ts";
import { GO_ERR, GO_ERR_IN_LOOP, configLines, goConfig, goMessage, goProgram, indent, jsClient, jsMessage, judgmentsOnly, plainText, pyClient, pyImports, pyMessage, qv, replayNames, replayParts, rustClient, rustMessage, rustReplayImports, rv, streams, turnSource, type Connection, type Settings } from "./experience.ts";

export type Origin = "written" | "asked" | "answered";
export interface Turn { readonly message: Message; readonly origin: Origin }

/** The program as a sequence: the opening literals, then asks (with their answers) and hand-written pushes. */
type Step = { kind: "ask"; index: number; text: string; reply: { index: number; text: string } } | { kind: "push"; indices: number[] };
function plan(turns: readonly Turn[]): { opening: number[]; steps: Step[]; literal: Message[] } {
  const asked = (i: number) => turns[i]?.origin === "asked" && turns[i + 1]?.origin === "answered" && userText(turns[i]!.message) !== undefined;
  let i = 0;
  const opening: number[] = [];
  while (i < turns.length && !asked(i)) opening.push(i++);
  const steps: Step[] = [];
  while (i < turns.length) {
    if (asked(i)) { steps.push({ kind: "ask", index: i, text: userText(turns[i]!.message)!, reply: { index: i + 1, text: replyText(turns[i + 1]!.message) } }); i += 2; continue; }
    const indices: number[] = [];
    while (i < turns.length && !asked(i)) indices.push(i++);
    steps.push({ kind: "push", indices });
  }
  // The messages spelled as literals (the opening and the hand-written pushes): only they need the part constructors.
  const literal = [...opening, ...steps.flatMap((s) => (s.kind === "push" ? s.indices : []))].map((i) => turns[i]!.message);
  return { opening, steps, literal };
}
/** A user turn's text when it is text alone (what `ask` takes); otherwise the turn is written as a literal. */
function userText(message: Message): string | undefined {
  if (message.role !== "user" || message.parts.length !== 1 || message.parts[0]!.type !== "text" || message.parts[0]!.continuation?.length) return;
  return message.parts[0]!.text;
}
/** What the model said, for the echo: its text parts; the rest (reasoning state) is inside `response.message`. */
function replyText(message: Message): string {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}
/** The answer under an `ask`: one comment line per line of the reply, named after its turn so it lights with it. */
function echo(text: string, lead: string, index: number): string[] {
  const lines = text.trim() ? text.split("\n") : ["(no text in the reply)"];
  return lines.map((line) => mark("comment", `${lead} → ${line}`.trimEnd(), turnSource(index)));
}
const ONE_TURN = "Ask, print the stream, keep the reply: it carries the model's reasoning state.";
const REWRITTEN = "Rewritten by hand: no call produced these, so they are written out.";

export function storyJavascript(connection: Connection, settings: Settings, turns: readonly Turn[], draft: string): Code {
  if (judgmentsOnly(connection.provider) || !streams(connection)) return finish(comment("// TypeSafe is judgments-only. Open Judge to declare the questions."));
  const messages = turns.map((t) => t.message);
  const { opening, steps, literal } = plan(turns);
  const replay = replayNames(literal);
  const imports = [connection.provider === "custom" ? "OpenAIChatLM" : "adapterFor", "Message", "Request", "ResponseStream", ...(replay.state ? ["continuationState"] : []), ...(replay.text ? ["text"] : []), ...(replay.thinking ? ["thinking"] : [])];
  if (connection.provider === "anthropic") imports.splice(1, 0, "access");
  const system = settings.system.trim();
  const config = configLines(settings, "javascript").map((line) => line.trim().replace(/,$/, ""));
  const lines = [dim(`import { ${imports.join(", ")} } from "lm15/browser";`), "", ...jsClient(connection), `const model = ${qv(connection.model, "model")};`];
  if (system) lines.push(`const system = ${qv(system, "system")};`);
  lines.push("", ...(opening.length ? ["const messages = [", ...indent(opening.map((i) => jsMessage(messages[i]!, i)).join("\n"), 1).split("\n"), "];"] : ["const messages = [];"]));
  lines.push("", comment(`// ${ONE_TURN}`), "async function ask(text) {", `  messages.push(${api("Message.user")}(text));`,
    `  const request = ${api("Request.create")}({ model, ${system ? "system, " : ""}messages${config.length ? `, ${config.join(", ")}` : ""} });`,
    `  const result = new ${api("ResponseStream")}(${api("lm.stream")}(request), request);`, "  for await (const piece of result) console.log(piece);", `  messages.push((await ${api("result.response")}()).message);`, "}", "");
  for (const step of steps) {
    if (step.kind === "ask") lines.push(`await ask(${qv(step.text, turnSource(step.index))});`, ...echo(step.reply.text, "//", step.reply.index), "");
    else lines.push(comment(`// ${REWRITTEN}`), "messages.push(", ...indent(step.indices.map((i) => jsMessage(messages[i]!, i)).join("\n"), 1).split("\n"), ");", "");
  }
  lines.push(`await ask(${qv(draft, "draft")});`);
  return finish(lines.join("\n"));
}

export function storyPython(connection: Connection, settings: Settings, turns: readonly Turn[], draft: string): Code {
  if (judgmentsOnly(connection.provider) || !streams(connection)) return finish(comment("# TypeSafe is judgments-only. Open Judge to declare the questions."));
  const messages = turns.map((t) => t.message);
  const { opening, steps, literal } = plan(turns);
  const client = pyClient(connection);
  const replay = replayNames(literal);
  const names = [client.cls, "AsyncResponseStream", "Message", "Request", ...(replay.state ? ["ContinuationState"] : [])];
  const config = configLines(settings, "python");
  if (config.length) names.push("Config");
  if (settings.reasoning) names.push("Reasoning");
  const factories = [...(replay.text ? ["text"] : []), ...(replay.thinking ? ["thinking"] : [])];
  const system = settings.system.trim();
  const lines = pyImports(names, connection, [
    ...(factories.length ? [`from lm15.types import ${factories.join(", ")}`] : []),
    ...(literal.some((m) => !plainText(m) && !replayParts(m)) ? ["from lm15.serde import message_from_dict"] : []),
  ]);
  lines.push("", ...client.lines, `model = ${qv(connection.model, "model")}`);
  if (system) lines.push(`system = ${qv(system, "system")}`);
  lines.push("", ...(opening.length ? ["messages = [", ...opening.flatMap((i) => pyMessage(messages[i]!, i, "    ")), "]"] : ["messages = []"]));
  lines.push("", "", comment(`# ${ONE_TURN}`), "async def ask(text):", `    messages.append(${api("Message.user")}(text))`,
    `    request = ${api("Request")}(model=model, ${system ? "system=system, " : ""}messages=messages${config.length ? `, ${config[0]!.trim().replace(/,$/, "")}` : ""})`,
    `    result = ${api("AsyncResponseStream")}(${api("lm.stream")}(request), request)`, "    async for piece in result:", '        print(piece, end="", flush=True)',
    `    messages.append((await ${api("result.response")}()).message)`, "", "");
  for (const step of steps) {
    if (step.kind === "ask") lines.push(`await ask(${qv(step.text, turnSource(step.index))})`, ...echo(step.reply.text, "#", step.reply.index), "");
    else lines.push(comment(`# ${REWRITTEN}`), "messages.extend([", ...step.indices.flatMap((i) => pyMessage(messages[i]!, i, "    ")), "])", "");
  }
  lines.push(`await ask(${qv(draft, "draft")})`);
  return finish(lines.join("\n"));
}

export function storyRust(connection: Connection, settings: Settings, turns: readonly Turn[], draft: string): Code {
  if (judgmentsOnly(connection.provider) || !streams(connection)) return finish(comment("// TypeSafe is judgments-only. Open Judge to declare the questions."));
  const messages = turns.map((t) => t.message);
  const { opening, steps, literal } = plan(turns);
  const imports = ["Message", "ProviderLM", "Request", "ResponseStream", ...rustReplayImports(literal)];
  const config = configLines(settings, "rust");
  if (config.length) imports.push("Config");
  if (settings.reasoning) imports.push("Reasoning");
  const replay = replayNames(literal);
  const system = settings.system.trim();
  const lines = [dim("use futures_util::StreamExt;"), dim("use lm15::{auth::Credential, registry::adapter_for};"), dim(`use lm15::{${[...new Set(imports)].sort().join(", ")}};`), ...(replay.state ? [dim("use serde_json::json;")] : []), ""];
  lines.push(comment(`// ${ONE_TURN}`), `async fn ask(lm: &${api("ProviderLM")}, messages: &mut Vec<${api("Message")}>, text: &str) -> Result<(), Box<dyn std::error::Error>> {`,
    `    messages.push(${api("Message::user")}(text)?);`, `    let request = ${api("Request")} {`, `        model: ${rv(connection.model, "model")}.into(),`);
  if (system) lines.push(`        system: Some(${rv(system, "system")}.into()),`);
  lines.push("        messages: messages.clone(),", ...config.map((line) => `    ${line}`), dim("        ..Default::default()"), "    };",
    `    let mut result = ${api("ResponseStream::new")}(${api("lm.stream")}(&request), &request);`, `    while let Some(piece) = ${api("result.text_chunks")}().next().await {`, '        print!("{}", piece?);', "    }",
    `    messages.push(${api("result.response")}().await?.message);`, "    Ok(())", "}", "", ...rustClient(connection));
  lines.push(...(opening.length ? ["let mut messages = vec![", ...opening.flatMap((i) => rustMessage(messages[i]!, i, "    ")), "];"] : ["let mut messages: Vec<Message> = Vec::new();"]), "");
  for (const step of steps) {
    if (step.kind === "ask") lines.push(`ask(&lm, &mut messages, ${rv(step.text, turnSource(step.index))}).await?;`, ...echo(step.reply.text, "//", step.reply.index), "");
    else lines.push(comment(`// ${REWRITTEN}`), "messages.extend([", ...step.indices.flatMap((i) => rustMessage(messages[i]!, i, "    ")), "]);", "");
  }
  lines.push(`ask(&lm, &mut messages, ${rv(draft, "draft")}).await?;`);
  return finish(lines.join("\n"));
}

export function storyGo(connection: Connection, settings: Settings, turns: readonly Turn[], draft: string): Code {
  if (judgmentsOnly(connection.provider) || !streams(connection)) return finish(comment("// TypeSafe is judgments-only. Open Judge to declare the questions."));
  const messages = turns.map((t) => t.message);
  const { opening, steps, literal } = plan(turns);
  const rendered = messages.map((m, i) => (literal.includes(m) ? goMessage(m, i) : { expression: "" }));
  const replays = rendered.flatMap((m) => m.replay ?? []);
  const system = settings.system.trim();
  const config = goConfig(settings);
  const options = [...(system ? [`${api("lm15.WithSystem")}(${qv(system, "system")})`] : []), ...(config ? [`${api("lm15.WithConfig")}(${config})`] : [])];
  const body: string[] = [];
  if (replays.length) body.push(...replays, "");
  body.push(...(opening.length ? ["    messages := []lm15.Message{", ...opening.map((i) => `        ${rendered[i]!.expression},`), "    }"] : ["    messages := []lm15.Message{}"]), "");
  body.push(`    ${comment(`// ${ONE_TURN}`)}`, "    ask := func(text string) error {", `        messages = append(messages, ${api("lm15.UserMessage")}(text))`,
    `        request, err := ${api("lm15.NewRequest")}(${qv(connection.model, "model")}, messages${options.length ? `, ${options.join(", ")}` : ""})`, `    ${GO_ERR}`,
    `        result := ${api("lm15.NewResponseStream")}(${api("lm.Stream")}(ctx, request), request)`, `        for piece, err := range ${api("result.Text")}() {`, `    ${GO_ERR_IN_LOOP}`, "            fmt.Print(piece)", "        }",
    `        response, err := ${api("result.Response")}()`, `    ${GO_ERR}`, "        messages = append(messages, response.Message)", "        return nil", "    }", "");
  for (const step of steps) {
    if (step.kind === "ask") body.push(`    if err := ask(${qv(step.text, turnSource(step.index))}); err != nil { return err }`, ...echo(step.reply.text, "    //", step.reply.index), "");
    else body.push(`    ${comment(`// ${REWRITTEN}`)}`, "    messages = append(messages,", ...step.indices.map((i) => `        ${rendered[i]!.expression},`), "    )", "");
  }
  body.push(`    if err := ask(${qv(draft, "draft")}); err != nil { return err }`);
  return goProgram(connection, replays.length ? ["encoding/json", "fmt"] : ["fmt"], body);
}

/** The teaching example as turns: hand-written, so `written`. */
export function writtenTurns(messages: readonly Message[]): Turn[] { return messages.map((message) => ({ message, origin: "written" })); }
