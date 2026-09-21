import { Message, Request as RequestNs, continuationState, thinking } from "lm15/browser";
import { CONNECTIONS } from "../../src/playground/connections.ts";
import { DEFAULT_SETTINGS, exampleGo, buildRequest, type Connection } from "../../src/playground/experience.ts";
import { EXAMPLE_SPEC, judgeGo, judgeRequest, judgeRust, type InputValue } from "../../src/playground/judge.ts";
import { storyGo, writtenTurns, type Turn } from "../../src/playground/story.ts";
import { exampleConversation } from "../../src/playground/experience.ts";

/** The story the panel shows (story.ts): compiled, never run — it would ask the model at every turn. */
export function goStories(): string[] {
  const prompt = 'Wine �� café, `backtick`, "quote", slash \\, controls\n\r\t\b\f\u0000';
  const turns: Turn[] = [
    ...writtenTurns(exampleConversation()),
    { message: Message.user("Asked through the page"), origin: "asked" },
    { message: Message.assistant([thinking("Earlier hidden reasoning", { continuation: [continuationState("anthropic", "thinking_signature", { signature: "opaque-replay-signature" })] }), "Earlier answer"]), origin: "answered" },
    { message: Message.user("Asked again"), origin: "asked" },
    { message: Message.assistant([thinking("", { continuation: continuationState("openai", "reasoning_item", { id: "rs_1", encrypted_content: "abc" }) }), "Rewritten by hand"]), origin: "written" },
  ];
  const sources: string[] = [];
  for (const choice of CONNECTIONS) {
    if (choice.id === "typesafe") continue;
    const connection: Connection = { provider: choice.id, model: choice.model || "custom-model", endpoint: "http://localhost:1234/v1" };
    sources.push(storyGo(connection, { ...DEFAULT_SETTINGS, maxTokens: 64, temperature: 0.2, reasoning: "low" }, turns, prompt).text, storyGo(connection, DEFAULT_SETTINGS, [], prompt).text);
  }
  return sources;
}

export function goExamples() {
  const prompt = 'Wine 🍷 café, `backtick`, "quote", slash \\, controls\n\r\t\b\f\u0000';
  const examples: Array<{ source: string; canonical: unknown[]; rust?: string; hasData?: boolean }> = [];
  for (const choice of CONNECTIONS) {
    const connection: Connection = { provider: choice.id, model: choice.model || "custom-model", endpoint: "http://localhost:1234/v1" };
    if (choice.id !== "typesafe") examples.push({ source: exampleGo(connection, DEFAULT_SETTINGS, [], prompt).text, canonical: [RequestNs.toJSON(buildRequest(connection, DEFAULT_SETTINGS, [], prompt))] });
    for (const shape of ["text", "fields", "conversation"] as const) {
      const value: InputValue = shape === "text" ? prompt : shape === "fields" ? { note: prompt, price: 0 } : [{ role: "user", content: prompt }];
      const spec = { ...EXAMPLE_SPEC, shape };
      examples.push({ source: judgeGo(connection, spec, [value]).text, canonical: [RequestNs.toJSON(judgeRequest(connection, spec, value))], rust: judgeRust(connection, spec, [value]).text, hasData: shape === "fields" || (shape === "conversation" && choice.id === "typesafe") });
    }
  }
  return examples;
}
