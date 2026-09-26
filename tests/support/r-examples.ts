import { Message, Request as RequestNs, continuationState, thinking } from "@lm15/lm15/browser";
import { CONNECTIONS } from "../../src/playground/connections.ts";
import { DEFAULT_SETTINGS, buildRequest, exampleConversation, exampleR, type Connection, type Settings } from "../../src/playground/experience.ts";
import { EXAMPLE_SPEC, judgeR, judgeRequest, type StateValue } from "../../src/playground/judge.ts";
import { storyR, writtenTurns, type Turn } from "../../src/playground/story.ts";

// Every control a person could type except NUL, which no R string can hold (rString refuses it; tested below).
export const PROMPT = 'Wine �� café, `backtick`, "quote", slash \\, controls\n\r\t\b\f\u0001';
const SET: Settings = { ...DEFAULT_SETTINGS, maxTokens: 64, temperature: 0.2, reasoning: "low" };
/** A transcript with every kind of turn: plain text, a reply with hidden reasoning, a reply rewritten by hand. */
function turns(): Turn[] {
  return [
    ...writtenTurns(exampleConversation()),
    { message: Message.user("Asked through the page"), origin: "asked" },
    { message: Message.assistant([thinking("Earlier hidden reasoning", { continuation: [continuationState("anthropic", "thinking_signature", { signature: "opaque-replay-signature" })] }), "Earlier answer"]), origin: "answered" },
    { message: Message.user("Asked again"), origin: "asked" },
    { message: Message.assistant([thinking("", { continuation: continuationState("openai", "reasoning_item", { id: "rs_1", "odd key": "abc" }) }), "Rewritten by hand"]), origin: "written" },
  ];
}
const connectionOf = (id: string, model: string): Connection => ({ provider: id, model: model || "custom-model", endpoint: "http://localhost:1234/v1" });

/** The story the panel shows: parsed, never run (it would ask the model at every turn). */
export function rStories(): string[] {
  return CONNECTIONS.filter((choice) => choice.id !== "typesafe").flatMap((choice) => {
    const connection = connectionOf(choice.id, choice.model);
    return [storyR(connection, SET, turns(), PROMPT).text, storyR(connection, DEFAULT_SETTINGS, [], PROMPT).text];
  });
}

/** Snapshot and Judge programs, with the canonical request the page sends for each. */
export function rExamples(): Array<{ source: string; canonical: unknown }> {
  const out: Array<{ source: string; canonical: unknown }> = [];
  const messages = turns().map((t) => t.message);
  for (const choice of CONNECTIONS) {
    const connection = connectionOf(choice.id, choice.model);
    if (choice.id !== "typesafe") for (const settings of [DEFAULT_SETTINGS, SET]) {
      out.push({ source: exampleR(connection, settings, messages, PROMPT).text, canonical: RequestNs.toJSON(buildRequest(connection, settings, messages, PROMPT)) });
    }
    for (const shape of ["text", "fields", "conversation"] as const) {
      const value: StateValue = shape === "text" ? PROMPT : shape === "fields" ? { note: PROMPT, price: 48, ratio: 0.5, tags: ["a"], none: null, ok: true } : [{ role: "user", content: PROMPT }, { role: "assistant", content: "An answer" }];
      const spec = { ...EXAMPLE_SPEC, shape };
      out.push({ source: judgeR(connection, spec, value).text, canonical: RequestNs.toJSON(judgeRequest(connection, spec, value)) });
    }
  }
  return out;
}
