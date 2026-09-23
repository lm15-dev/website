/**
 * The Overview's tour: one request, built up a part at a time, in every
 * language. The running example is a field assistant for a wildlife research station.
 *
 * Each language is written out by hand, in its own idiom, as a handful of
 * pieces (the tool, the request, reading the response, streaming). The page
 * shows pieces; `tourPrograms` assembles the same pieces into whole programs,
 * which tests/docs_examples_run.test.ts runs against a local stand-in server
 * in every language. What the page shows is therefore what was run.
 *
 * Marks (playground/marks.ts): `val` for what the reader chose or may change,
 * `api` for LM15's names, `dim` for the language's plumbing, `comment`.
 */
import { api, comment, dim, finish, val, type Code } from '../playground/marks.ts';
import type { Language } from '../components/home-example/examples.ts';

export const TOUR = {
  system: 'You are the field assistant for a wildlife research station. Answer in two sentences.',
  prompt: 'What might be eating the acorns under our oak trees at night?',
  tool: 'search_sightings',
  toolDescription: "Find the station's recorded sightings by species, place or date.",
  maxTokens: 1000,
} as const;

/** How much of the request a step shows: each adds one part to the one before. */
export type Step = 'request' | 'system' | 'tools' | 'config';
const STEPS: readonly Step[] = ['request', 'system', 'tools', 'config'];
/** What the page can show: a step's request, reading the response, streaming, or the whole program. */
export type TourView = Step | 'response' | 'stream' | 'program';

interface Parts { system: boolean; tools: boolean; config: boolean }
const partsOf = (step: Step): Parts => {
  const at = STEPS.indexOf(step);
  return { system: at >= 1, tools: at >= 2, config: at >= 3 };
};

interface Writer {
  /** The tool's definition (shown with the `tools` step). */
  tool(): string;
  /** The request, with the parts this step includes. */
  request(model: string, parts: Parts): string;
  /** Make the router, call it, read the answer. */
  response(): string;
  /** Stream the same request (the router already exists). */
  stream(): string;
  /** A whole program around `body`: imports, and whatever the language needs to run it. */
  program(body: string, uses: Uses): string;
  /** The line that makes the router, when the program streams. */
  router(): string;
}
interface Uses { tool: boolean; config: boolean; stream: boolean }

const q = (text: string) => `"${val(text)}"`;
const indent = (text: string, by: string) => text.split('\n').map(line => (line ? by + line : line)).join('\n');

const python: Writer = {
  tool: () => `${TOUR.tool} = ${api('FunctionTool')}(
    name=${q(TOUR.tool)},
    description=${q(TOUR.toolDescription)},
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
)`,
  request: (model, p) => [
    `request = ${api('Request')}(`,
    `    model=${q(model)},`,
    ...(p.system ? [`    system=${q(TOUR.system)},`] : []),
    `    messages=[${api('Message.user')}(${q(TOUR.prompt)})],`,
    ...(p.tools ? [`    tools=[${TOUR.tool}],`] : []),
    ...(p.config ? [`    config=${api('Config')}(max_tokens=${val(String(TOUR.maxTokens))}),`] : []),
    ')',
  ].join('\n'),
  router: () => `router = ${api('LMRouter')}()`,
  response: () => `router = ${api('LMRouter')}()
response = ${api('router.complete')}(request)
print(response.text)
print(response.finish_reason)  ${comment('# "stop", "length", "tool_call"…')}
print(response.usage.input_tokens, response.usage.output_tokens)`,
  stream: () => `stream = ${api('ResponseStream')}(${api('router.stream')}(request), request)
for text in stream:
    print(text, end="", flush=True)
print()
print(stream.usage.output_tokens, "tokens")`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', 'Request', ...(uses.config ? ['Config'] : []), ...(uses.stream ? ['ResponseStream'] : []), ...(uses.tool ? ['FunctionTool'] : [])].sort();
    return `${dim(`from lm15 import ${names.join(', ')}`)}\n\n${body}`;
  },
};

const typescript: Writer = {
  tool: () => `const searchSightings: ${api('FunctionTool')} = {
  type: "function",
  name: ${q(TOUR.tool)},
  description: ${q(TOUR.toolDescription)},
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};`,
  request: (model, p) => [
    'const request = {',
    `  model: ${q(model)},`,
    ...(p.system ? [`  system: ${q(TOUR.system)},`] : []),
    `  messages: [${api('Message.user')}(${q(TOUR.prompt)})],`,
    ...(p.tools ? ['  tools: [searchSightings],'] : []),
    ...(p.config ? [`  config: { maxTokens: ${val(String(TOUR.maxTokens))} },`] : []),
    '};',
  ].join('\n'),
  router: () => `const router = new ${api('LMRouter')}();`,
  response: () => `const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}(request);
console.log(response.text);
console.log(response.finishReason);  ${comment('// "stop", "length", "tool_call"…')}
console.log(response.usage.inputTokens, response.usage.outputTokens);`,
  stream: () => `const stream = new ${api('ResponseStream')}(${api('router.stream')}(request), request);
for await (const text of stream) process.stdout.write(text);
console.log();
const response = await ${api('stream.response')}();
console.log(response.usage.outputTokens, "tokens");`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', ...(uses.stream ? ['ResponseStream'] : []), ...(uses.tool ? ['type FunctionTool'] : [])];
    return `${dim(`import { ${names.join(', ')} } from "lm15";`)}\n\n${body}`;
  },
};

const rust: Writer = {
  tool: () => `let search_sightings = ${api('Tool::Function')}(${api('FunctionTool::new')}(
    ${q(TOUR.tool)},
    Some(${q(TOUR.toolDescription)}.into()),
    serde_json::from_value(serde_json::json!({
        "type": "object",
        "properties": { "query": { "type": "string" } },
        "required": ["query"]
    }))?,
)?);`,
  request: (model, p) => [
    `let request = ${api('Request')} {`,
    `    model: ${q(model)}.into(),`,
    ...(p.system ? [`    system: Some(${q(TOUR.system)}.into()),`] : []),
    `    messages: vec![${api('Message::user')}(${q(TOUR.prompt)})?],`,
    ...(p.tools ? ['    tools: vec![search_sightings],'] : []),
    ...(p.config ? [`    config: ${api('Config')} { max_tokens: Some(${val(String(TOUR.maxTokens))}), ${dim('..Default::default()')} },`] : []),
    // Every field given: nothing left to default.
    ...(p.system && p.tools && p.config ? [] : [`    ${dim('..Default::default()')}`]),
    '};',
  ].join('\n'),
  router: () => `let router = ${api('LMRouter::new')}();`,
  response: () => `let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
println!("{}", response.${api('text')}().unwrap_or_default());
println!("{}", response.finish_reason); ${comment('// "stop", "length", "tool_call"…')}
${comment('// None means the provider did not report it.')}
if let (Some(input), Some(output)) = (response.usage.input_tokens, response.usage.output_tokens) {
    println!("{input} {output}");
}`,
  stream: () => `let mut stream = ${api('ResponseStream::new')}(${api('router.stream')}(&request), &request);
while let Some(text) = stream.${api('text_chunks')}().next().await {
    print!("{}", text?);
}
println!();
let response = ${api('stream.response')}().await?;
if let Some(tokens) = response.usage.output_tokens {
    println!("{tokens} tokens");
}`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', 'Request', ...(uses.config ? ['Config'] : []), ...(uses.tool ? ['FunctionTool', 'Tool'] : []), ...(uses.stream ? ['ResponseStream'] : [])].sort();
    const deps = ['lm15', 'tokio (macros, rt-multi-thread)', ...(uses.tool ? ['serde_json'] : []), ...(uses.stream ? ['futures-util'] : [])];
    return [
      ...(uses.stream ? [dim('use futures_util::StreamExt;')] : []),
      dim(`use lm15::{${names.join(', ')}};`),
      '',
      comment(`// Dependencies: ${deps.join(', ')}`),
      dim('#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {'),
      indent(body, '    '),
      dim('    Ok(())\n}'),
    ].join('\n');
  },
};

const go: Writer = {
  tool: () => `searchSightings := ${api('lm15.FunctionTool')}{
    Name:        ${q(TOUR.tool)},
    Description: ${q(TOUR.toolDescription)},
    Parameters: lm15.JSONObject{
        "type":       "object",
        "properties": lm15.JSONObject{"query": lm15.JSONObject{"type": "string"}},
        "required":   []any{"query"},
    },
}`,
  request: (model, p) => [
    `request := &${api('lm15.Request')}{`,
    // gofmt aligns the values of neighbouring one-line fields.
    `    Model:${p.system ? '  ' : ' '}${q(model)},`,
    ...(p.system ? [`    System: ${api('lm15.System')}(${q(TOUR.system)}),`] : []),
    `    Messages: []${api('lm15.Message')}{`,
    `        ${api('lm15.UserMessage')}(${q(TOUR.prompt)}),`,
    '    },',
    ...(p.tools ? [`    Tools:${p.config ? '  ' : ' '}[]${api('lm15.Tool')}{searchSightings},`] : []),
    ...(p.config ? [`    Config: ${api('lm15.Config')}{MaxTokens: ${api('lm15.I')}(${val(String(TOUR.maxTokens))})},`] : []),
    '}',
  ].join('\n'),
  router: () => `router := ${api('lm15.NewRouter')}()`,
  response: () => `router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.${api('TextOr')}(""))
fmt.Println(response.FinishReason) ${comment('// "stop", "length", "tool_call"…')}
${comment('// nil means the provider did not report it.')}
if in, out := response.Usage.InputTokens, response.Usage.OutputTokens; in != nil && out != nil {
    fmt.Println(*in, *out)
}`,
  stream: () => `stream := ${api('lm15.NewResponseStream')}(${api('router.Stream')}(context.Background(), request), request)
for text, err := range stream.${api('Text')}() {
${dim('    if err != nil {\n        panic(err)\n    }')}
    fmt.Print(text)
}
fmt.Println()
response, err := stream.${api('Response')}()
${dim('if err != nil {\n    panic(err)\n}')}
if out := response.Usage.OutputTokens; out != nil {
    fmt.Println(*out, "tokens")
}`,
  program: body => [
    dim('package main\n\nimport (\n    "context"\n    "fmt"\n    lm15 "github.com/lm15-dev/lm15-go"\n)\n\nfunc main() {'),
    indent(body, '    '),
    dim('}'),
  ].join('\n'),
};

const r: Writer = {
  tool: () => `search_sightings <- ${api('function_tool')}(
  ${q(TOUR.tool)},
  description = ${q(TOUR.toolDescription)},
  parameters = ${api('json_object')}(
    type = "object",
    properties = ${api('json_object')}(query = ${api('json_object')}(type = "string")),
    required = ${api('json_array')}("query")
  )
)`,
  request: (model, p) => {
    const args = [
      q(model),
      `list(${api('message_user')}(${q(TOUR.prompt)}))`,
      ...(p.system ? [`system = ${q(TOUR.system)}`] : []),
      ...(p.tools ? ['tools = list(search_sightings)'] : []),
      ...(p.config ? [`config = ${api('config')}(max_tokens = ${val(String(TOUR.maxTokens))})`] : []),
    ];
    return `req <- ${api('request')}(\n${args.map(a => `  ${a}`).join(',\n')}\n)`;
  },
  router: () => `router <- ${api('new_router')}()`,
  response: () => `router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
${api('response_text')}(response)
response$finish_reason  ${comment('# "stop", "length", "tool_call"…')}
response$usage$input_tokens
response$usage$output_tokens`,
  stream: () => `response <- ${api('stream')}(router, req, on_event = function(event) {
  if (event$type == "delta" && event$delta$type == "text") cat(event$delta$text)
})
response$usage$output_tokens`,
  program: body => `${dim('library(lm15)')}\n\n${body}`,
};

const julia: Writer = {
  tool: () => `${TOUR.tool} = ${api('FunctionTool')}(
    name=${q(TOUR.tool)},
    description=${q(TOUR.toolDescription)},
    parameters=Dict(
        "type" => "object",
        "properties" => Dict("query" => Dict("type" => "string")),
        "required" => ["query"],
    ),
)`,
  request: (model, p) => {
    const options = [
      ...(p.system ? [`system=${q(TOUR.system)}`] : []),
      ...(p.tools ? [`tools=[${TOUR.tool}]`] : []),
      ...(p.config ? [`config=${api('Config')}(max_tokens=${val(String(TOUR.maxTokens))})`] : []),
    ];
    const user = `    ${api('user')}(${q(TOUR.prompt)})`;
    return [`req = ${api('Request')}(`, `    ${q(model)},`, options.length ? `${user};` : `${user},`, ...options.map(o => `    ${o},`), ')'].join('\n');
  },
  router: () => `router = ${api('LMRouter')}()`,
  response: () => `router = ${api('LMRouter')}()
response = ${api('complete')}(router, req)
println(${api('text')}(response))
println(response.finish_reason)  ${comment('# "stop", "length", "tool_call"…')}
println(response.usage.input_tokens, " ", response.usage.output_tokens)`,
  stream: () => `response = ${api('stream')}(router, req) do result
    for text in ${api('text_chunks')}(result)
        print(text)
    end
    ${api('LM15.response')}(result)
end
println()
println(response.usage.output_tokens, " tokens")`,
  program: body => `${dim('using LM15')}\n\n${body}`,
};

const WRITERS: Record<Language, Writer> = { python, typescript, rust, go, r, julia };

/** The marked text a view shows (before `finish`). */
function marked(language: Language, view: TourView, model: string): string {
  const w = WRITERS[language];
  switch (view) {
    case 'request': case 'system': case 'config': return w.request(model, partsOf(view));
    case 'tools': return `${w.tool()}\n\n${w.request(model, partsOf('tools'))}`;
    case 'response': return w.response();
    case 'stream': return w.stream();
    case 'program': return streamProgram(w, model);
  }
}

/** The whole program the "Putting it together" section shows: every part but the tool, streamed. */
function streamProgram(w: Writer, model: string): string {
  const request = w.request(model, { system: true, tools: false, config: true });
  return w.program(`${w.router()}\n${request}\n\n${w.stream()}`, { tool: false, config: true, stream: true });
}

export function tourCode(language: Language, view: TourView, provider: string, model: string): Code {
  return finish(marked(language, view, `${provider}:${model}`));
}

/**
 * Whole programs, one per thing the page shows, for the run test: each step's
 * request read back with the response piece, and the streamed program. Their
 * pieces are the very strings `tourCode` shows.
 */
export function tourPrograms(language: Language, provider: string, model: string): { name: string; source: string; streams: boolean }[] {
  const w = WRITERS[language];
  const id = `${provider}:${model}`;
  const complete = STEPS.map(step => {
    const parts = partsOf(step);
    const body = [...(parts.tools ? [w.tool(), ''] : []), w.request(id, parts), '', w.response()].join('\n');
    return { name: step, source: finish(w.program(body, { tool: parts.tools, config: parts.config, stream: false })).text, streams: false };
  });
  return [...complete, { name: 'program', source: finish(streamProgram(w, id)).text, streams: true }];
}
