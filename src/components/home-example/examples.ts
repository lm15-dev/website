import { CONNECTIONS } from '../../playground/connections';

export const LANGUAGES = [
  { id: 'python', label: 'Python', file: 'example.py' },
  { id: 'typescript', label: 'TypeScript', file: 'example.ts' },
  { id: 'rust', label: 'Rust', file: 'src/main.rs' },
  { id: 'go', label: 'Go', file: 'main.go' },
  { id: 'r', label: 'R', file: 'example.R' },
  { id: 'julia', label: 'Julia', file: 'example.jl' },
] as const;
export type Language = typeof LANGUAGES[number]['id'];

// Curated examples, not a live model catalog. Changing a selection makes no request.
const additionalModels: Record<string, string[]> = {
  openai: ['gpt-4.1', 'gpt-4.1-nano'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash-lite'],
  groq: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  openrouter: ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash'],
  deepseek: ['deepseek-reasoner'],
  zai: ['glm-4.5-air'],
  moonshotai: ['kimi-k2-thinking'],
};
export const PROVIDERS = CONNECTIONS.filter(choice => choice.env && !('judgmentsOnly' in choice)).map(choice => ({
  id: choice.id as string,
  label: choice.label as string,
  env: choice.env as string,
  models: [choice.model, ...(additionalModels[choice.id] ?? [])] as readonly string[],
}));

export const INITIAL = { language: 'python' as Language, provider: 'provider', model: 'model' };
const MODEL = '«model»';
const prompt = 'Explain why the sky is blue.';

/** Real router APIs: only the provider:model string changes between providers. */
export function exampleParts(language: Language): [string, string] {
  const examples: Record<Language, string> = {
    python: `from lm15 import LMRouter, Message, Request

router = LMRouter()
response = router.complete(Request(
    model="${MODEL}",
    messages=(Message.user("${prompt}"),),
))

print(response.text)`,
    typescript: `import { LMRouter, Message } from "lm15";

const router = new LMRouter();
const response = await router.complete({
  model: "${MODEL}",
  messages: [Message.user("${prompt}")],
});

console.log(response.text);`,
    rust: `use lm15::{LMRouter, Message, Request};

// Dependencies: lm15, tokio (macros, rt-multi-thread)
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let router = LMRouter::new();
    let request = Request {
        model: "${MODEL}".into(),
        messages: vec![Message::user(
            "${prompt}"
        )?],
        ..Default::default()
    };
    let response = router.complete(&request).await?;
    println!("{}", response.text().unwrap_or_default());
    Ok(())
}`,
    go: `package main

import (
    "context"
    "fmt"
    lm15 "github.com/lm15-dev/lm15-go"
)

func main() {
    router := lm15.NewRouter()
    response, err := router.Complete(context.Background(),
        &lm15.Request{
            Model: "${MODEL}",
            Messages: []lm15.Message{
                lm15.UserMessage("${prompt}"),
            },
        })
    if err != nil {
        panic(err)
    }
    fmt.Println(response.TextOr(""))
}`,
    r: `library(lm15)

router <- new_router()
req <- request(
  "${MODEL}",
  list(message_user("${prompt}"))
)
response <- complete(router, req)

response_text(response)`,
    julia: `using LM15

router = LMRouter()
req = Request(
    "${MODEL}",
    user("${prompt}")
)
response = complete(router, req)

println(text(response))`,
  };
  const [before, after] = examples[language].split(MODEL);
  // The editable field renders the quotes too, so they stay attached on narrow screens.
  return [before!.slice(0, -1), after!.slice(1)];
}

export function exampleSource(language: Language, provider: string, model: string): string {
  const [before, after] = exampleParts(language);
  return `${before}"${provider}:${model}"${after}`;
}
