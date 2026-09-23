/** Provider replies for the example suites: a stream of the right dialect for the URL, or TypeSafe's one-piece answer. No network. */

/** Jev's answers to the three example judgments; `keys` narrows them to the ones a request declared (the SDK refuses any other). */
export function jevAnswers(keys?: readonly string[]): Record<string, unknown> {
  const all: Record<string, unknown> = { quality: { type: "score", probabilities: { "0": 0, "1": 0, "2": 0.1, "3": 0.8, "4": 0.1 } }, id_certainty: { type: "score", probabilities: { "0": 0, "1": 0, "2": 0.1, "3": 0.8, "4": 0.1 } }, style: { type: "choice", choice: "fruit", probabilities: { fruit: 0.9, oak: 0.1, mineral: 0 } }, ageing: { type: "noul", noul: 0.97 }, juvenile_present: { type: "noul", noul: 0.99 } };
  return keys ? Object.fromEntries(Object.entries(all).filter(([k]) => keys.includes(k))) : all;
}
/** The question names a judge request body declares, whatever the wire: the schema's properties. */
export function declaredKeys(body: unknown): string[] | undefined {
  const found: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const item of v) walk(item, depth + 1); return; }
    const o = v as Record<string, unknown>;
    if (o["properties"] && typeof o["properties"] === "object" && !Array.isArray(o["properties"])) { found.push(...Object.keys(o["properties"] as object)); return; }
    if (o["questions"] && typeof o["questions"] === "object" && !Array.isArray(o["questions"])) { found.push(...Object.keys(o["questions"] as object)); return; }
    for (const item of Object.values(o)) walk(item, depth + 1);
  };
  walk(body, 0);
  return found.length ? found : undefined;
}

/** A stream of the right dialect for the URL — or TypeSafe's one-piece answer to the example judgments (`keys`: the ones declared). */
export function replyFor(url: string, text = "Hi", keys?: readonly string[]): Response {
  if (url.includes("/v1/systemone")) {
    const body = { model: "jev-1", answers: jevAnswers(keys), usage: { input_tokens: 40, output_tokens: 9 } };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }
  return new Response(streamFor(url, text), { headers: { "Content-Type": "text/event-stream" } });
}

/** The three example judgments answered as structured output by a chat wire (the pick, no distribution), or by Jev. */
export const JUDGED_TEXT = '{"quality":3,"style":"fruit","ageing":true}';
export function judgedText(keys?: readonly string[]): string {
  const all = { ...JSON.parse(JUDGED_TEXT), id_certainty: 1, juvenile_present: true } as Record<string, unknown>;
  return JSON.stringify(keys ? Object.fromEntries(Object.entries(all).filter(([k]) => keys.includes(k))) : all);
}

/** A one-piece (non-streaming) reply of the right dialect for the URL — what `complete` gets — carrying the judged text; Jev answers its own way. `keys`: the judgments the request declared. */
export function judgeReplyFor(url: string, keys?: readonly string[]): Response {
  if (url.includes("/v1/systemone")) return replyFor(url, "Hi", keys);
  const JUDGED_TEXT = judgedText(keys);
  let body: unknown;
  if (url.includes("/responses")) body = { id: "r", model: "m", status: "completed", output: [{ type: "message", id: "msg", role: "assistant", content: [{ type: "output_text", text: JUDGED_TEXT }] }], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } };
  else if (url.includes("/messages")) body = { id: "r", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: JUDGED_TEXT }], stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 1 } };
  else if (url.includes("generateContent")) body = { candidates: [{ content: { role: "model", parts: [{ text: JUDGED_TEXT }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } };
  else body = { id: "r", model: "m", choices: [{ index: 0, message: { role: "assistant", content: JUDGED_TEXT }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

/** A stream body of the right dialect for the URL, ending in `stop` with usage. */
export function streamFor(url: string, text = "Hi"): string {
  let frames: unknown[];
  if (url.includes("/responses")) frames = [
    { type: "response.created", response: { id: "r", model: "m" } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
    { type: "response.completed", response: { id: "r", status: "completed", output: [], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } },
  ];
  else if (url.includes("/messages")) frames = [
    { type: "message_start", message: { id: "r", model: "m", usage: { input_tokens: 2 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  else if (url.includes("streamGenerateContent")) frames = [{ candidates: [{ content: { role: "model", parts: [{ text: text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } }];
  else frames = [{ id: "r", model: "m", choices: [{ delta: { role: "assistant", content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }];
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + (url.includes("/responses") || url.includes("/messages") || url.includes("streamGenerateContent") ? "" : "data: [DONE]\n\n");
}

