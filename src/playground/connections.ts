/**
 * The providers this site offers (the playground's connections, the home and
 * docs provider pickers).
 *
 * What a provider IS — its id, its key variable, its wire, its address — is
 * the SDK's registry (`PROVIDERS` from the pinned runtime package), never a
 * copy here. This file adds only what a page shows: a label, a default model
 * (the model lm15-contract's live receipts used for that provider, where it
 * has them), and whether it answers judgments only. Every other registry
 * provider is in NOT_OFFERED with the reason, and tests/connections.test.ts
 * fails when the SDK gains a provider this file has not placed — the site
 * cannot fall behind the SDKs without a test saying so.
 */

import { PROVIDERS } from "@lm15/lm15/browser";

export interface Connection {
  readonly id: string;
  readonly label: string;
  /** The key variable: the registry's first env key; "" for a keyless server. */
  readonly env: string;
  readonly model: string;
  /** TypeSafe (Jev) answers declared judgments only (MAP-14): no chat, no stream. */
  readonly judgmentsOnly?: true;
}

interface Presentation {
  readonly id: string;
  readonly label: string;
  readonly model: string;
}

/** Offered registry providers, in picker order. */
const OFFERED: readonly Presentation[] = [
  { id: "openai", label: "OpenAI", model: "gpt-4.1-mini" },
  { id: "anthropic", label: "Anthropic", model: "claude-haiku-4-5" },
  { id: "gemini", label: "Google Gemini", model: "gemini-2.5-flash" },
  { id: "xai", label: "xAI", model: "grok-4.20" },
  { id: "groq", label: "Groq", model: "llama-3.3-70b-versatile" },
  { id: "openrouter", label: "OpenRouter", model: "openai/gpt-4.1-mini" },
  { id: "deepseek", label: "DeepSeek", model: "deepseek-chat" },
  { id: "zai", label: "Z.AI", model: "glm-4.5" },
  { id: "meta", label: "Meta", model: "muse-spark-1.3" },
  { id: "moonshotai", label: "Moonshot / Kimi", model: "kimi-k2.5" },
  { id: "deepinfra", label: "DeepInfra", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "together", label: "Together AI", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", label: "Fireworks AI", model: "accounts/fireworks/models/deepseek-v4p1-flash" },
  { id: "parasail", label: "Parasail", model: "meta-llama/Llama-3.3-70B-Instruct" },
  // Judgments only (MAP-14): no chat, no stream. The playground turns judgments on for it; the docs' first chat request leaves it out.
  { id: "typesafe", label: "TypeSafe (Jev)", model: "jev-latest" },
  { id: "ollama", label: "Ollama (local)", model: "qwen3.5:0.8b" },
];

/** Registry providers the site does not offer, each with the reason a page cannot or need not. */
export const NOT_OFFERED: Readonly<Record<string, string>> = Object.freeze({
  "openai-chat": "OpenAI's Chat Completions wire: the same key and models as openai, which the site offers on the Responses wire",
  "claude-code": "a Claude subscription through the local `claude` CLI login, not a key a page holds",
  "openai-codex": "a ChatGPT subscription through the local `codex` CLI login, not a key a page holds",
  "deepseek-anthropic": "DeepSeek's Anthropic Messages wire; the site offers deepseek",
  "moonshotai-responses": "Moonshot's Responses wire; the site offers moonshotai",
  "moonshotai-anthropic": "Moonshot's Anthropic Messages wire; the site offers moonshotai",
  "meta-chat": "Meta's Chat Completions wire; the site offers meta",
  "meta-anthropic": "Meta's Anthropic Messages wire; the site offers meta",
  azure: "a cloud door: an Azure resource and identity, not a pasted key",
  "azure-chat": "a cloud door: an Azure resource and identity, not a pasted key",
  "azure-anthropic": "a cloud door: a Foundry resource and identity, not a pasted key",
  "aws-anthropic": "a cloud door: an AWS region, workspace and identity, not a pasted key",
  "bedrock-anthropic": "a cloud door: an AWS region and identity, not a pasted key",
  "bedrock-chat": "a cloud door: an AWS region and identity, not a pasted key",
  "bedrock-mantle-chat": "a cloud door: an AWS region and identity, not a pasted key",
  vertex: "a cloud door: a Google Cloud project and identity, not a pasted key",
  "vertex-anthropic": "a cloud door: a Google Cloud project and identity, not a pasted key",
  "vertex-express": "Gemini through a Google Cloud express-mode key; the site offers Gemini's own API",
  vllm: "a local server like ollama; the Custom Chat Completions server reaches it",
  sglang: "a local server like ollama; the Custom Chat Completions server reaches it",
});

function connection(p: Presentation): Connection {
  const definition = PROVIDERS.get(p.id);
  if (!definition) throw new Error(`connections.ts offers ${JSON.stringify(p.id)}, which the SDK registry does not have`);
  const env = definition.access.envKeys[0] ?? "";
  return Object.freeze({ ...p, env, ...(definition.dialect === "typesafe" ? { judgmentsOnly: true as const } : {}) });
}

/** Named connection choices for the demo; provider behavior comes from lm15. */
export const CONNECTIONS: readonly Connection[] = Object.freeze([
  ...OFFERED.map(connection),
  { id: "custom", label: "Custom Chat Completions server", env: "", model: "" },
]);
