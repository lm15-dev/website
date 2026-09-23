import { CONNECTIONS } from '../../playground/connections';
import { api, comment, dim, finish, plain, val, type Code } from '../../playground/marks';

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
const prompt = val('Explain why the sky is blue.');

/**
 * Real router APIs: only the provider:model string changes between providers.
 * Marked as the playground marks its code (marks.ts): LM15's calls, the values
 * a reader chose, comments, and the language's plumbing.
 */
function markedExample(language: Language): string {
  const examples: Record<Language, string> = {
    python: `${dim('from lm15 import LMRouter, Message, Request')}

router = ${api('LMRouter')}()
response = ${api('router.complete')}(${api('Request')}(
    model="${MODEL}",
    messages=(${api('Message.user')}("${prompt}"),),
))

print(response.text)`,
    typescript: `${dim('import { LMRouter, Message } from "lm15";')}

const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}({
  model: "${MODEL}",
  messages: [${api('Message.user')}("${prompt}")],
});

console.log(response.text);`,
    rust: `${dim('use lm15::{LMRouter, Message, Request};')}

${comment('// Dependencies: lm15, tokio (macros, rt-multi-thread)')}
${dim(`#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {`)}
    let router = ${api('LMRouter::new')}();
    let request = ${api('Request')} {
        model: "${MODEL}".into(),
        messages: vec![${api('Message::user')}(
            "${prompt}"
        )?],
        ${dim('..Default::default()')}
    };
    let response = ${api('router.complete')}(&request).await?;
    println!("{}", response.${api('text')}().unwrap_or_default());
${dim(`    Ok(())
}`)}`,
    go: `${dim(`package main

import (
    "context"
    "fmt"
    lm15 "github.com/lm15-dev/lm15-go"
)

func main() {`)}
    router := ${api('lm15.NewRouter')}()
    response, err := ${api('router.Complete')}(context.Background(),
        &${api('lm15.Request')}{
            Model: "${MODEL}",
            Messages: []${api('lm15.Message')}{
                ${api('lm15.UserMessage')}("${prompt}"),
            },
        })
${dim(`    if err != nil {
        panic(err)
    }`)}
    fmt.Println(response.${api('TextOr')}(""))
${dim('}')}`,
    r: `${dim('library(lm15)')}

router <- ${api('new_router')}()
req <- ${api('request')}(
  "${MODEL}",
  list(${api('message_user')}("${prompt}"))
)
response <- ${api('complete')}(router, req)

${api('response_text')}(response)`,
    julia: `${dim('using LM15')}

router = ${api('LMRouter')}()
req = ${api('Request')}(
    "${MODEL}",
    ${api('user')}("${prompt}")
)
response = ${api('complete')}(router, req)

println(${api('text')}(response))`,
  };
  return examples[language];
}

/** The plain source around the model string, for the homepage's inline provider and model controls. */
export function exampleParts(language: Language): [string, string] {
  const [before, after] = plain(markedExample(language)).split(MODEL);
  // The editable field renders the quotes too, so they stay attached on narrow screens.
  return [before!.slice(0, -1), after!.slice(1)];
}

/** The example with its marks, for code shown the way the playground shows it. `provider:model` is the reader's value. */
export function exampleCode(language: Language, provider: string, model: string): Code {
  return finish(markedExample(language).replace(MODEL, val(`${provider}:${model}`, 'model')));
}

export function exampleSource(language: Language, provider: string, model: string): string {
  return exampleCode(language, provider, model).text;
}
