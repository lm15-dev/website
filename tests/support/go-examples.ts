import { Request as RequestNs } from "lm15/browser";
import { CONNECTIONS } from "../../src/playground/connections.ts";
import { DEFAULT_SETTINGS, exampleGo, buildRequest, type Connection } from "../../src/playground/experience.ts";
import { EXAMPLE_SPEC, judgeGo, judgeRequest, judgeRust, type InputValue } from "../../src/playground/judge.ts";

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
