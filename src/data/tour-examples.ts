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
import { api, comment, dim, finish, plain, val, type Code } from '../playground/marks.ts';
import type { Language } from '../components/home-example/examples.ts';

import TEXT from './tour-text.json' with { type: 'json' };

/** The wording the docs' examples share with scripts/capture-first-request.py. */
export const TOUR = TEXT;

/**
 * Columns an example may use: what a docs code box shows at 1280px without
 * wrapping (measured). Rust and Go pieces go inside `main`, four columns in.
 * tests/docs_example_widths.test.ts holds every example to it.
 */
export const WIDTH = 72;
const BUDGET: Record<Language, number> = { python: WIDTH, typescript: WIDTH, r: WIDTH, julia: WIDTH, rust: WIDTH - 4, go: WIDTH - 4 };

/** A marked string literal: its opening mark (with the value's source, if any) and its text. */
const LITERAL = /"(\u0001(?:\u0006[^\u0006]*\u0006)?)([^\u0005"]*)\u0005"/g;

/**
 * A line too long because of a text value, broken the way the language's own
 * formatter would: Python `("a " "b")`, TypeScript/Go `"a " + "b"`, Julia
 * `"a " * "b"`, Rust `concat!("a ", "b")`, R `paste("a", "b")`. The string the
 * program builds is unchanged (the run test compares the wire in every
 * language). Lines too long for other reasons are laid out by hand.
 */
function fitLine(language: Language, line: string): string {
  const budget = BUDGET[language];
  const plainLine = plain(line);
  if (plainLine.length <= budget) return line;
  let longest: RegExpExecArray | undefined;
  for (const m of line.matchAll(LITERAL)) if (!longest || m[2]!.length > longest[2]!.length) longest = m as RegExpExecArray;
  if (!longest || longest[2]!.length < 20) return line;
  const [whole, open, text] = longest as unknown as [string, string, string];
  const prefix = line.slice(0, longest.index), suffix = line.slice(longest.index! + whole.length);
  const indent = /^ */.exec(plain(prefix))![0], inner = indent + '    ';
  const piece = (t: string) => `"${open}${t}\u0005"`;
  const r = language === 'r';
  // Words into pieces that fit an inner line; R's paste() puts the spaces back.
  // Two quotes, the trailing space, and the joiner (` +`, ` *`, `,`).
  const room = budget - inner.length - 5;
  const pieces: string[] = [];
  for (const word of text.split(' ')) {
    const last = pieces.at(-1);
    if (last !== undefined && (last + ' ' + word).length <= room) pieces[pieces.length - 1] = last + ' ' + word;
    else pieces.push(word);
  }
  const parts = r ? pieces : pieces.map((p, i) => (i < pieces.length - 1 ? p + ' ' : p));
  const opens = /[([{]\s*$/.test(plain(prefix));
  switch (language) {
    case 'python':
      return opens
        ? [prefix.trimEnd(), ...parts.map(p => inner + piece(p)), indent + suffix.trimStart()].join('\n')
        : [prefix + '(', ...parts.map(p => inner + piece(p)), indent + ')' + suffix].join('\n');
    case 'rust':
      return [prefix + 'concat!(', ...parts.map(p => `${inner}${piece(p)},`), indent + ')' + suffix].join('\n');
    case 'r':
      return [prefix + 'paste(', ...parts.map((p, i) => inner + piece(p) + (i < parts.length - 1 ? ',' : '')), indent + ')' + suffix].join('\n');
    default: {
      const join = language === 'julia' ? ' *' : ' +';
      const close = language === 'go' ? ',' : language === 'typescript' ? ',' : '';
      return opens
        ? [prefix.trimEnd(), ...parts.map((p, i) => inner + piece(p) + (i < parts.length - 1 ? join : close)), indent + suffix.trimStart()].join('\n')
        : [prefix.trimEnd(), ...parts.map((p, i) => inner + piece(p) + (i < parts.length - 1 ? join : suffix))].join('\n');
    }
  }
}

/** A list of names, comma-separated, wrapped at WIDTH (rustfmt's layout for a long `use`). */
function wrapNames(names: readonly string[], indent: string): string {
  const lines = [indent];
  for (const name of names) {
    const current = lines[lines.length - 1]!;
    const next = current === indent ? `${indent}${name},` : `${current} ${name},`;
    if (next.length <= WIDTH || current === indent) lines[lines.length - 1] = next;
    else lines.push(`${indent}${name},`);
  }
  return lines.join('\n');
}

/** Every line of a piece fitted to the language's budget. */
const fit = (language: Language, text: string) => text.split('\n').map(line => fitLine(language, line)).join('\n');

/** How much of the request a step shows: each adds one part to the one before. */
export type Step = 'request' | 'system' | 'tools' | 'config';
const STEPS: readonly Step[] = ['request', 'system', 'tools', 'config'];
/** What the page can show: a step's request, reading the response, streaming, a follow-up, or the whole program. */
export type TourView = Step | 'first' | 'response' | 'stream' | 'program' | 'followup' | 'forgetful'
  | 'tools-search' | 'tools-define' | 'tools-vague' | 'tools-ask' | 'tools-answer' | 'tools-loop'
  | 'so-note' | 'so-plain' | 'so-schema' | 'so-ask' | 'so-use' | 'so-note-barn' | 'so-schema-other' | 'so-program';

interface Parts { system: boolean; tools: boolean; config: boolean }
const partsOf = (step: Step): Parts => {
  const at = STEPS.indexOf(step);
  return { system: at >= 1, tools: at >= 2, config: at >= 3 };
};

interface Writer {
  /** The tool's definition (shown with the `tools` step); `vague` leaves the input undescribed. */
  tool(vague?: boolean): string;
  /** The request, with the parts this step includes. */
  request(model: string, parts: Parts): string;
  /** Make the router, call it, print the answer's text. */
  ask(): string;
  /** Make the router, call it, read the answer. */
  response(): string;
  /** Stream the same request (the router already exists). */
  stream(): string;
  /** A second question, sent with the conversation so far (`request`, then `response`) or on its own. */
  followUp(model: string, withHistory: boolean): string;
  /** The station's records and the function that searches them (the tools page). */
  search(): string;
  /** Ask the tools question with the tool offered, and print the calls the model asks for. */
  askTool(model: string): string;
  /** Run each call, answer it, and send the conversation back (after askTool). */
  answerTool(): string;
  /** The whole exchange as a loop, capped at TOUR.maxTurns rounds. */
  toolLoop(model: string): string;
  /** Structured output: one field note, as a string variable. */
  soNote(note: NoteKey): string;
  /** Send the note with no answer format, print the text. */
  soPlain(model: string): string;
  /** The sightings schema; `other` adds "other" to the places. */
  soSchema(other: boolean): string;
  /** Send the note asking for the schema; print the data. */
  soAsk(model: string): string;
  /** Use the data: one line per sighting. */
  soUse(): string;
  /** A whole program around `body`: imports, and whatever the language needs to run it. */
  program(body: string, uses: Uses): string;
  /** The line that makes the router, when the program streams. */
  router(): string;
}
interface Uses { tool: boolean; config: boolean; stream: boolean; search?: boolean; loop?: boolean; schema?: boolean; typed?: boolean }
type NoteKey = keyof typeof TOUR.extract.notes;
const X = TOUR.extract;
/** The places, as quoted values in any language's list syntax. */
const placeList = (other: boolean) => [...X.places, ...(other ? [X.other] : [])].map(p => q(p)).join(', ');

const q = (text: string) => `"${val(text)}"`;
/** Starts a line that continues a multi-line string: program frames don't indent it, and it is removed before `finish`. */
const RAW = '\u000e';
const indent = (text: string, by: string) => text.split('\n').map(line => (!line || line.startsWith(RAW) ? line : by + line)).join('\n');
/** `finish`, without the multi-line-string sentinels. */
const done = (marked: string): Code => finish(marked.replaceAll(RAW, ''));
/** A note's text as a multi-line value: its later lines start at column 0, whatever the frame's indent. */
const lines = (text: string) => val(text.split('\n').join('\n' + RAW));

const python: Writer = {
  tool: (vague = false) => `sightings_tool = ${api('FunctionTool')}(
    name=${q(TOUR.tool)},
    description=${q(TOUR.toolDescription)},
    parameters={
        "type": "object",
        "properties": {${vague ? '"query": {"type": "string"}' : `\n            "query": {"type": "string", "description": ${q(TOUR.queryDescription)}},\n        `}},
        "required": ["query"],
    },
)`,
  request: (model, p) => [
    `request = ${api('Request')}(`,
    `    model=${q(model)},`,
    ...(p.system ? [`    system=${q(TOUR.system)},`] : []),
    `    messages=[${api('Message.user')}(${q(TOUR.prompt)})],`,
    ...(p.tools ? ['    tools=[sightings_tool],'] : []),
    ...(p.config ? [`    config=${api('Config')}(max_tokens=${val(String(TOUR.maxTokens))}),`] : []),
    ')',
  ].join('\n'),
  router: () => `router = ${api('LMRouter')}()`,
  ask: () => `router = ${api('LMRouter')}()
response = ${api('router.complete')}(request)
print(response.text)`,
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
  followUp: (model, history) => [
    `followup = ${api('Request')}(`,
    `    model=${q(model)},`,
    `    system=${q(TOUR.system)},`,
    ...(history
      ? ['    messages=[', '        *request.messages,', '        response.message,', `        ${api('Message.user')}(${q(TOUR.followUp)}),`, '    ],']
      : [`    messages=[${api('Message.user')}(${q(TOUR.followUp)})],`]),
    ')',
    `print(${api('router.complete')}(followup).text)`,
  ].join('\n'),
  search: () => [
    'SIGHTINGS = [',
    ...TOUR.sightings.flatMap(x => [`    {"date": ${q(x.date)}, "place": ${q(x.place)},`, `     "species": ${q(x.species)}, "count": ${val(String(x.count))}},`]),
    ']',
    '',
    '',
    'def search_sightings(query):',
    '    query = query.lower()',
    '    return [s for s in SIGHTINGS',
    '            if query in (s["species"], s["place"], s["date"])]',
  ].join('\n'),
  askTool: model => `request = ${api('Request')}(
    model=${q(model)},
    system=${q(TOUR.system)},
    messages=[${api('Message.user')}(${q(TOUR.toolQuestion)})],
    tools=[sightings_tool],
)
router = ${api('LMRouter')}()
response = ${api('router.complete')}(request)
print(response.finish_reason)  ${comment('# "tool_call"')}
for call in response.tool_calls:
    print(call.name, call.input)`,
  answerTool: () => `results = {
    call.id: json.dumps(search_sightings(**call.input))
    for call in response.tool_calls
}
followup = ${api('Request')}(
    model=request.model,
    system=request.system,
    messages=[
        *request.messages,
        response.message,
        ${api('Message.tool')}(results),
    ],
    tools=request.tools,
)
print(${api('router.complete')}(followup).text)`,
  toolLoop: model => `router = ${api('LMRouter')}()
messages = [${api('Message.user')}(${q(TOUR.toolQuestion)})]
for turn in range(${val(String(TOUR.maxTurns))}):
    response = ${api('router.complete')}(${api('Request')}(
        model=${q(model)},
        system=${q(TOUR.system)},
        messages=messages,
        tools=[sightings_tool],
    ))
    messages.append(response.message)
    if response.finish_reason != "tool_call":
        print(response.text)
        break
    results = {
        call.id: json.dumps(search_sightings(**call.input))
        for call in response.tool_calls
    }
    messages.append(${api('Message.tool')}(results))
else:
    raise RuntimeError("still calling tools after ${TOUR.maxTurns} turns")`,
  soNote: key => `note = """${lines(X.notes[key])}"""`,
  soPlain: model => `request = ${api('Request')}(
    model=${q(model)},
    system=${q(X.system)},
    messages=[${api('Message.user')}(note)],
)
router = ${api('LMRouter')}()
response = ${api('router.complete')}(request)
print(response.text)`,
  soSchema: other => `places = [${placeList(other)}]
sighting_schema = {
    "type": "object",
    "properties": {
        "sightings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "species": {
                        "type": "string",
                        "description": ${q(X.speciesDescription)},
                    },
                    "count": {"type": "integer"},
                    "place": {
                        "type": "string",
                        "enum": places,
                    },
                },
                "required": ["species", "count", "place"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sightings"],
    "additionalProperties": False,
}`,
  soAsk: model => `request = ${api('Request')}(
    model=${q(model)},
    system=${q(X.system)},
    messages=[${api('Message.user')}(note)],
    config=${api('Config')}(response_format={
        "type": "json_schema",
        "name": "sightings",
        "schema": sighting_schema,
        "strict": True,
    }),
)
router = ${api('LMRouter')}()
response = ${api('router.complete')}(request)
print(response.${api('data')})`,
  soUse: () => `for s in response.${api('data')}["sightings"]:
    print(s["count"], s["species"], "at", s["place"])`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', 'Request', ...(uses.config ? ['Config'] : []), ...(uses.stream ? ['ResponseStream'] : []), ...(uses.tool ? ['FunctionTool'] : [])].sort();
    return `${uses.search ? `${dim('import json')}\n\n` : ''}${dim(`from lm15 import ${names.join(', ')}`)}\n\n${body}`;
  },
};

const typescript: Writer = {
  tool: (vague = false) => `const sightingsTool: ${api('FunctionTool')} = {
  type: "function",
  name: ${q(TOUR.tool)},
  description: ${q(TOUR.toolDescription)},
  parameters: {
    type: "object",
    properties: {${vague ? ' query: { type: "string" } ' : `\n      query: { type: "string", description: ${q(TOUR.queryDescription)} },\n    `}},
    required: ["query"],
  },
};`,
  request: (model, p) => [
    'const request = {',
    `  model: ${q(model)},`,
    ...(p.system ? [`  system: ${q(TOUR.system)},`] : []),
    `  messages: [${api('Message.user')}(${q(TOUR.prompt)})],`,
    ...(p.tools ? ['  tools: [sightingsTool],'] : []),
    ...(p.config ? [`  config: { maxTokens: ${val(String(TOUR.maxTokens))} },`] : []),
    '};',
  ].join('\n'),
  router: () => `const router = new ${api('LMRouter')}();`,
  ask: () => `const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}(request);
console.log(response.text);`,
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
  followUp: (model, history) => [
    'const followup = {',
    `  model: ${q(model)},`,
    `  system: ${q(TOUR.system)},`,
    ...(history
      ? ['  messages: [', '    ...request.messages,', '    response.message,', `    ${api('Message.user')}(${q(TOUR.followUp)}),`, '  ],']
      : [`  messages: [${api('Message.user')}(${q(TOUR.followUp)})],`]),
    '};',
    `console.log((await ${api('router.complete')}(followup)).text);`,
  ].join('\n'),
  search: () => [
    'const SIGHTINGS = [',
    ...TOUR.sightings.flatMap(x => [`  { date: ${q(x.date)}, place: ${q(x.place)},`, `    species: ${q(x.species)}, count: ${val(String(x.count))} },`]),
    '];',
    '',
    'function searchSightings(query: string) {',
    '  const q = query.toLowerCase();',
    '  return SIGHTINGS.filter((s) =>',
    '    [s.species, s.place, s.date].includes(q));',
    '}',
  ].join('\n'),
  askTool: model => `const request = {
  model: ${q(model)},
  system: ${q(TOUR.system)},
  messages: [${api('Message.user')}(${q(TOUR.toolQuestion)})],
  tools: [sightingsTool],
};
const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}(request);
console.log(response.finishReason);  ${comment('// "tool_call"')}
for (const call of response.toolCalls) {
  console.log(call.name, call.input);
}`,
  answerTool: () => `const results = Object.fromEntries(
  response.toolCalls.map((call) => [
    call.id,
    JSON.stringify(searchSightings(String(call.input["query"]))),
  ]),
);
const followup = {
  ...request,
  messages: [
    ...request.messages,
    response.message,
    ${api('Message.tool')}(results),
  ],
};
console.log((await ${api('router.complete')}(followup)).text);`,
  toolLoop: model => `const router = new ${api('LMRouter')}();
const messages = [${api('Message.user')}(${q(TOUR.toolQuestion)})];
for (let turn = 0; ; turn++) {
  if (turn === ${val(String(TOUR.maxTurns))}) {
    throw new Error("still calling tools after ${TOUR.maxTurns} turns");
  }
  const response = await ${api('router.complete')}({
    model: ${q(model)},
    system: ${q(TOUR.system)},
    messages,
    tools: [sightingsTool],
  });
  messages.push(response.message);
  if (response.finishReason !== "tool_call") {
    console.log(response.text);
    break;
  }
  const results = Object.fromEntries(
    response.toolCalls.map((call) => [
      call.id,
      JSON.stringify(searchSightings(String(call.input["query"]))),
    ]),
  );
  messages.push(${api('Message.tool')}(results));
}`,
  soNote: key => `const note = \`${lines(X.notes[key])}\`;`,
  soPlain: model => `const request: ${api('Request')} = {
  model: ${q(model)},
  system: ${q(X.system)},
  messages: [${api('Message.user')}(note)],
};
const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}(request);
console.log(response.text);`,
  soSchema: other => `const places = [${placeList(other)}];
const sightingSchema = {
  type: "object",
  properties: {
    sightings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          species: {
            type: "string",
            description: ${q(X.speciesDescription)},
          },
          count: { type: "integer" },
          place: {
            type: "string",
            enum: places,
          },
        },
        required: ["species", "count", "place"],
        additionalProperties: false,
      },
    },
  },
  required: ["sightings"],
  additionalProperties: false,
};`,
  soAsk: model => `const request: ${api('Request')} = {
  model: ${q(model)},
  system: ${q(X.system)},
  messages: [${api('Message.user')}(note)],
  config: {
    responseFormat: {
      type: "json_schema",
      name: "sightings",
      schema: sightingSchema,
      strict: true,
    },
  },
};
const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}(request);
console.log(response.${api('data')});`,
  soUse: () => `type Sighting = { species: string; count: number; place: string };
const data = response.${api('data')} as { sightings: Sighting[] };
for (const s of data.sightings) {
  console.log(s.count, s.species, "at", s.place);
}`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', ...(uses.stream ? ['ResponseStream'] : []), ...(uses.tool ? ['type FunctionTool'] : []), ...(uses.schema || uses.typed ? ['type Request'] : [])];
    return `${dim(`import { ${names.join(', ')} } from "lm15";`)}\n\n${body}`;
  },
};

const rust: Writer = {
  tool: (vague = false) => `let sightings_tool = ${api('Tool::Function')}(${api('FunctionTool::new')}(
    ${q(TOUR.tool)},
    Some(${q(TOUR.toolDescription)}.into()),
    serde_json::from_value(serde_json::json!({
        "type": "object",
        "properties": {${vague ? ' "query": { "type": "string" } ' : `\n            "query": { "type": "string", "description": ${q(TOUR.queryDescription)} }\n        `}},
        "required": ["query"]
    }))?,
)?);`,
  request: (model, p) => [
    `let request = ${api('Request')} {`,
    `    model: ${q(model)}.into(),`,
    ...(p.system ? [`    system: Some(${q(TOUR.system)}.into()),`] : []),
    `    messages: vec![${api('Message::user')}(${q(TOUR.prompt)})?],`,
    ...(p.tools ? ['    tools: vec![sightings_tool],'] : []),
    ...(p.config ? [`    config: ${api('Config')} { max_tokens: Some(${val(String(TOUR.maxTokens))}), ${dim('..Default::default()')} },`] : []),
    // Every field given: nothing left to default.
    ...(p.system && p.tools && p.config ? [] : [`    ${dim('..Default::default()')}`]),
    '};',
  ].join('\n'),
  router: () => `let router = ${api('LMRouter::new')}();`,
  ask: () => `let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
println!("{}", response.${api('text')}().unwrap_or_default());`,
  response: () => `let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
println!("{}", response.${api('text')}().unwrap_or_default());
${comment('// "stop", "length", "tool_call"…')}
println!("{}", response.finish_reason);
let usage = &response.usage;
${comment('// None: not reported')}
println!("{:?} {:?}", usage.input_tokens, usage.output_tokens);`,
  stream: () => `let events = ${api('router.stream')}(&request);
let mut stream = ${api('ResponseStream::new')}(events, &request);
while let Some(text) = stream.${api('text_chunks')}().next().await {
    print!("{}", text?);
}
println!();
let response = ${api('stream.response')}().await?;
if let Some(tokens) = response.usage.output_tokens {
    println!("{tokens} tokens");
}`,
  followUp: (model, history) => [
    ...(history
      ? ['let mut messages = request.messages.clone();', 'messages.push(response.message.clone());', `messages.push(${api('Message::user')}(${q(TOUR.followUp)})?);`]
      : []),
    `let followup = ${api('Request')} {`,
    `    model: ${q(model)}.into(),`,
    `    system: Some(${q(TOUR.system)}.into()),`,
    history ? '    messages,' : `    messages: vec![${api('Message::user')}(${q(TOUR.followUp)})?],`,
    `    ${dim('..Default::default()')}`,
    '};',
    `let answer = ${api('router.complete')}(&followup).await?;`,
    `println!("{}", answer.${api('text')}().unwrap_or_default());`,
  ].join('\n'),
  search: () => [
    'fn search_sightings(input: &JsonObject) -> Vec<Value> {',
    '    let sightings = serde_json::json!([',
    ...TOUR.sightings.flatMap(x => [`        { "date": ${q(x.date)}, "place": ${q(x.place)},`, `          "species": ${q(x.species)}, "count": ${val(String(x.count))} },`]),
    '    ]);',
    '    let query = input.get("query").and_then(|q| q.as_str());',
    '    let query = query.unwrap_or_default().to_lowercase();',
    '    let fields = ["species", "place", "date"];',
    '    sightings.as_array().into_iter().flatten()',
    '        .filter(|s| fields.iter().any(|f| s[*f] == query.as_str()))',
    '        .cloned()',
    '        .collect()',
    '}',
  ].join('\n'),
  askTool: model => `let request = ${api('Request')} {
    model: ${q(model)}.into(),
    system: Some(${q(TOUR.system)}.into()),
    messages: vec![${api('Message::user')}(${q(TOUR.toolQuestion)})?],
    tools: vec![sightings_tool.clone()],
    ${dim('..Default::default()')}
};
let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
println!("{}", response.finish_reason); ${comment('// "tool_call"')}
for call in response.${api('tool_calls')}() {
    let input = serde_json::Value::Object(call.input.clone());
    println!("{} {input}", call.name);
}`,
  answerTool: () => `let mut results = Vec::new();
for call in response.${api('tool_calls')}() {
    let found = search_sightings(&call.input);
    let json = serde_json::to_string(&found)?;
    results.push((call.id.clone(), json));
}
let mut messages = request.messages.clone();
messages.push(response.message.clone());
messages.push(${api('Message::tool_results')}(results)?);
let followup = ${api('Request')} { messages, ..request.clone() };
let answer = ${api('router.complete')}(&followup).await?;
println!("{}", answer.${api('text')}().unwrap_or_default());`,
  toolLoop: model => `let router = ${api('LMRouter::new')}();
let mut messages = vec![${api('Message::user')}(${q(TOUR.toolQuestion)})?];
for turn in 0.. {
    if turn == ${val(String(TOUR.maxTurns))} {
        return Err("still calling tools after ${TOUR.maxTurns} turns".into());
    }
    let request = ${api('Request')} {
        model: ${q(model)}.into(),
        system: Some(${q(TOUR.system)}.into()),
        messages: messages.clone(),
        tools: vec![sightings_tool.clone()],
        ${dim('..Default::default()')}
    };
    let response = ${api('router.complete')}(&request).await?;
    messages.push(response.message.clone());
    if response.finish_reason != ${api('FinishReason::ToolCall')} {
        println!("{}", response.${api('text')}().unwrap_or_default());
        break;
    }
    let mut results = Vec::new();
    for call in response.${api('tool_calls')}() {
        let found = search_sightings(&call.input);
        let json = serde_json::to_string(&found)?;
        results.push((call.id.clone(), json));
    }
    messages.push(${api('Message::tool_results')}(results)?);
}`,
  soNote: key => `let note = r"${lines(X.notes[key])}";`,
  soPlain: model => `let request = ${api('Request')} {
    model: ${q(model)}.into(),
    system: Some(${q(X.system)}.into()),
    messages: vec![${api('Message::user')}(note)?],
    ${dim('..Default::default()')}
};
let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
println!("{}", response.${api('text')}().unwrap_or_default());`,
  soSchema: other => `let places = [${placeList(other)}];
let sighting_schema = serde_json::json!({
    "type": "object",
    "properties": {
        "sightings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "species": {
                        "type": "string",
                        "description": ${q(X.speciesDescription)}
                    },
                    "count": { "type": "integer" },
                    "place": {
                        "type": "string",
                        "enum": places
                    }
                },
                "required": ["species", "count", "place"],
                "additionalProperties": false
            }
        }
    },
    "required": ["sightings"],
    "additionalProperties": false
});`,
  soAsk: model => `let format = serde_json::json!({
    "type": "json_schema",
    "name": "sightings",
    "schema": sighting_schema,
    "strict": true
});
let request = ${api('Request')} {
    model: ${q(model)}.into(),
    system: Some(${q(X.system)}.into()),
    messages: vec![${api('Message::user')}(note)?],
    config: ${api('Config')} {
        response_format: format.as_object().cloned(),
        ${dim('..Default::default()')}
    },
    ${dim('..Default::default()')}
};
let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
let data = response.${api('data')}().unwrap_or_default();
println!("{data}");`,
  soUse: () => `for s in data["sightings"].as_array().into_iter().flatten() {
    let species = s["species"].as_str().unwrap_or_default();
    let place = s["place"].as_str().unwrap_or_default();
    println!("{} {species} at {place}", s["count"]);
}`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', 'Request', ...(uses.config ? ['Config'] : []), ...(uses.tool ? ['FunctionTool', 'Tool'] : []), ...(uses.stream ? ['ResponseStream'] : []), ...(uses.loop ? ['FinishReason'] : []), ...(uses.search ? ['JsonObject'] : [])].sort();
    const deps = ['lm15', 'tokio (macros, rt-multi-thread)', ...(uses.tool || uses.schema ? ['serde_json'] : []), ...(uses.stream ? ['futures-util'] : [])];
    return [
      ...(uses.stream ? [dim('use futures_util::StreamExt;')] : []),
      ...(uses.search ? [dim('use serde_json::Value;')] : []),
      // rustfmt's layout for a long import list.
      dim(`use lm15::{${names.join(', ')}};`.length <= WIDTH ? `use lm15::{${names.join(', ')}};` : `use lm15::{\n${wrapNames(names, '    ')}\n};`),
      '',
      comment(`// Dependencies: ${deps.join(', ')}`),
      dim('#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {'),
      indent(body, '    '),
      dim('    Ok(())\n}'),
    ].join('\n');
  },
};

const go: Writer = {
  tool: (vague = false) => `sightingsTool := ${api('lm15.FunctionTool')}{
    Name:        ${q(TOUR.tool)},
    Description: ${q(TOUR.toolDescription)},
    Parameters: lm15.JSONObject{
        "type": "object",
        "properties": lm15.JSONObject{
            "query": lm15.JSONObject{${vague ? '"type": "string"}' : `
                "type":        "string",
                "description": ${q(TOUR.queryDescription)},
            }`},
        },
        "required": []any{"query"},
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
    ...(p.tools ? [`    Tools:${p.config ? '  ' : ' '}[]${api('lm15.Tool')}{sightingsTool},`] : []),
    ...(p.config ? [`    Config: ${api('lm15.Config')}{MaxTokens: ${api('lm15.I')}(${val(String(TOUR.maxTokens))})},`] : []),
    '}',
  ].join('\n'),
  router: () => `router := ${api('lm15.NewRouter')}()`,
  ask: () => `router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.${api('TextOr')}(""))`,
  response: () => `router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.${api('TextOr')}(""))
fmt.Println(response.FinishReason) ${comment('// "stop", "length", "tool_call"…')}
in, out := response.Usage.InputTokens, response.Usage.OutputTokens
if in != nil && out != nil { ${comment('// nil: not reported')}
    fmt.Println(*in, *out)
}`,
  stream: () => `events := ${api('router.Stream')}(context.Background(), request)
stream := ${api('lm15.NewResponseStream')}(events, request)
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
  followUp: (model, history) => [
    `followup := &${api('lm15.Request')}{`,
    `    Model:  ${q(model)},`,
    `    System: ${api('lm15.System')}(${q(TOUR.system)}),`,
    ...(history
      ? [`    Messages: append(request.Messages, response.Message,`, `        ${api('lm15.UserMessage')}(${q(TOUR.followUp)})),`]
      : [`    Messages: []${api('lm15.Message')}{`, `        ${api('lm15.UserMessage')}(${q(TOUR.followUp)}),`, '    },']),
    '}',
    `answer, err := ${api('router.Complete')}(context.Background(), followup)`,
    dim('if err != nil {\n    panic(err)\n}'),
    `fmt.Println(answer.${api('TextOr')}(""))`,
  ].join('\n'),
  search: () => [
    'sightings := []map[string]any{',
    ...TOUR.sightings.flatMap(x => [`    {"date": ${q(x.date)}, "place": ${q(x.place)},`, `        "species": ${q(x.species)}, "count": ${val(String(x.count))}},`]),
    '}',
    'searchSightings := func(query string) []map[string]any {',
    '    query = strings.ToLower(query)',
    '    found := []map[string]any{}',
    '    for _, s := range sightings {',
    '        if query == s["species"] || query == s["place"] ||',
    '            query == s["date"] {',
    '            found = append(found, s)',
    '        }',
    '    }',
    '    return found',
    '}',
  ].join('\n'),
  askTool: model => `request := &${api('lm15.Request')}{
    Model:  ${q(model)},
    System: ${api('lm15.System')}(${q(TOUR.system)}),
    Messages: []${api('lm15.Message')}{
        ${api('lm15.UserMessage')}(${q(TOUR.toolQuestion)}),
    },
    Tools: []${api('lm15.Tool')}{sightingsTool},
}
router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.FinishReason) ${comment('// "tool_call"')}
for _, call := range response.${api('ToolCalls')}() {
    fmt.Println(call.Name, call.Input)
}`,
  answerTool: () => `var results []${api('lm15.ToolResultPart')}
for _, call := range response.${api('ToolCalls')}() {
    query, _ := call.Input["query"].(string)
    found, err := json.Marshal(searchSightings(query))
${dim('    if err != nil {\n        panic(err)\n    }')}
    result := ${api('lm15.ToolResult')}(call.ID, string(found))
    results = append(results, result)
}
followup := *request
followup.Messages = append(request.Messages, response.Message,
    ${api('lm15.ToolMessageParts')}(results...))
answer, err := ${api('router.Complete')}(context.Background(), &followup)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(answer.${api('TextOr')}(""))`,
  toolLoop: model => `router := ${api('lm15.NewRouter')}()
messages := []${api('lm15.Message')}{
    ${api('lm15.UserMessage')}(${q(TOUR.toolQuestion)}),
}
for turn := 0; ; turn++ {
    if turn == ${val(String(TOUR.maxTurns))} {
        panic("still calling tools after ${TOUR.maxTurns} turns")
    }
    request := &${api('lm15.Request')}{
        Model:    ${q(model)},
        System:   ${api('lm15.System')}(${q(TOUR.system)}),
        Messages: messages,
        Tools:    []${api('lm15.Tool')}{sightingsTool},
    }
    response, err := ${api('router.Complete')}(context.Background(), request)
${dim('    if err != nil {\n        panic(err)\n    }')}
    messages = append(messages, response.Message)
    if response.FinishReason != "tool_call" {
        fmt.Println(response.${api('TextOr')}(""))
        break
    }
    var results []${api('lm15.ToolResultPart')}
    for _, call := range response.${api('ToolCalls')}() {
        query, _ := call.Input["query"].(string)
        found, err := json.Marshal(searchSightings(query))
${dim('        if err != nil {\n            panic(err)\n        }')}
        result := ${api('lm15.ToolResult')}(call.ID, string(found))
        results = append(results, result)
    }
    messages = append(messages, ${api('lm15.ToolMessageParts')}(results...))
}`,
  soNote: key => `note := \`${lines(X.notes[key])}\``,
  soPlain: model => `request := &${api('lm15.Request')}{
    Model:    ${q(model)},
    System:   ${api('lm15.System')}(${q(X.system)}),
    Messages: []${api('lm15.Message')}{${api('lm15.UserMessage')}(note)},
}
router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.${api('TextOr')}(""))`,
  soSchema: other => `places := []any{${placeList(other)}}
sightingSchema := lm15.JSONObject{
    "type": "object",
    "properties": lm15.JSONObject{
        "sightings": lm15.JSONObject{
            "type": "array",
            "items": lm15.JSONObject{
                "type": "object",
                "properties": lm15.JSONObject{
                    "species": lm15.JSONObject{
                        "type":        "string",
                        "description": ${q(X.speciesDescription)},
                    },
                    "count": lm15.JSONObject{"type": "integer"},
                    "place": lm15.JSONObject{
                        "type": "string",
                        "enum": places,
                    },
                },
                "required": []any{"species", "count", "place"},
                "additionalProperties": false,
            },
        },
    },
    "required":             []any{"sightings"},
    "additionalProperties": false,
}`,
  soAsk: model => `request := &${api('lm15.Request')}{
    Model:    ${q(model)},
    System:   ${api('lm15.System')}(${q(X.system)}),
    Messages: []${api('lm15.Message')}{${api('lm15.UserMessage')}(note)},
    Config: ${api('lm15.Config')}{
        ResponseFormat: lm15.JSONObject{
            "type":   "json_schema",
            "name":   "sightings",
            "schema": sightingSchema,
            "strict": true,
        },
    },
}
router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.${api('TextOr')}(""))`,
  soUse: () => `var record struct {
    Sightings []struct {
        Species string \`json:"species"\`
        Count   int    \`json:"count"\`
        Place   string \`json:"place"\`
    } \`json:"sightings"\`
}
if err := response.${api('ParseJSON')}(&record); err != nil {
    panic(err)
}
for _, s := range record.Sightings {
    fmt.Println(s.Count, s.Species, "at", s.Place)
}`,
  program: (body, uses) => [
    dim(`package main\n\nimport (\n    "context"\n${uses?.search ? '    "encoding/json"\n' : ''}    "fmt"\n${uses?.search ? '    "strings"\n' : ''}    lm15 "github.com/lm15-dev/lm15-go"\n)\n\nfunc main() {`),
    indent(body, '    '),
    dim('}'),
  ].join('\n'),
};

const r: Writer = {
  tool: (vague = false) => `sightings_tool <- ${api('function_tool')}(
  ${q(TOUR.tool)},
  description = ${q(TOUR.toolDescription)},
  parameters = ${api('json_object')}(
    type = "object",
    properties = ${api('json_object')}(
      query = ${api('json_object')}(type = "string"${vague ? '' : `, description = ${q(TOUR.queryDescription)}`})
    ),
    required = ${api('json_array')}("query")
  )
)`,
  request: (model, p) => {
    const args = [
      q(model),
      `list(${api('message_user')}(${q(TOUR.prompt)}))`,
      ...(p.system ? [`system = ${q(TOUR.system)}`] : []),
      ...(p.tools ? ['tools = list(sightings_tool)'] : []),
      ...(p.config ? [`config = ${api('config')}(max_tokens = ${val(String(TOUR.maxTokens))})`] : []),
    ];
    return `req <- ${api('request')}(\n${args.map(a => `  ${a}`).join(',\n')}\n)`;
  },
  router: () => `router <- ${api('new_router')}()`,
  ask: () => `router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
${api('response_text')}(response)`,
  response: () => `router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
${api('response_text')}(response)
response$finish_reason  ${comment('# "stop", "length", "tool_call"…')}
response$usage$input_tokens
response$usage$output_tokens`,
  stream: () => `response <- ${api('stream')}(router, req, on_event = function(event) {
  if (event$type == "delta" && event$delta$type == "text") {
    cat(event$delta$text)
  }
})
response$usage$output_tokens`,
  followUp: (model, history) => [
    `followup <- ${api('request')}(`,
    `  ${q(model)},`,
    history
      ? `  c(req$messages, list(response$message, ${api('message_user')}(${q(TOUR.followUp)}))),`
      : `  list(${api('message_user')}(${q(TOUR.followUp)})),`,
    `  system = ${q(TOUR.system)}`,
    ')',
    `${api('response_text')}(${api('complete')}(router, followup))`,
  ].join('\n'),
  search: () => [
    'sightings <- data.frame(',
    `  date = c(${TOUR.sightings.map(x => q(x.date)).join(', ')}),`,
    `  place = c(${TOUR.sightings.map(x => q(x.place)).join(', ')}),`,
    `  species = c(${TOUR.sightings.map(x => q(x.species)).join(', ')}),`,
    `  count = c(${TOUR.sightings.map(x => val(String(x.count))).join(', ')})`,
    ')',
    '',
    'search_sightings <- function(query) {',
    '  query <- tolower(query)',
    '  found <- sightings$species == query | sightings$place == query |',
    '    sightings$date == query',
    '  sightings[found, ]',
    '}',
  ].join('\n'),
  askTool: model => `req <- ${api('request')}(
  ${q(model)},
  list(${api('message_user')}(${q(TOUR.toolQuestion)})),
  system = ${q(TOUR.system)},
  tools = list(sightings_tool)
)
router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
response$finish_reason  ${comment('# "tool_call"')}
for (call in ${api('tool_calls')}(response)) {
  cat(call$name, jsonlite::toJSON(call$input, auto_unbox = TRUE), "\\n")
}`,
  answerTool: () => `results <- lapply(${api('tool_calls')}(response), function(call) {
  found <- jsonlite::toJSON(search_sightings(call$input$query))
  ${api('tool_result_part')}(call$id, list(${api('text_part')}(as.character(found))))
})
followup <- ${api('request')}(
  req$model,
  c(req$messages, list(response$message, ${api('message')}("tool", results))),
  system = req$system,
  tools = req$tools
)
${api('response_text')}(${api('complete')}(router, followup))`,
  toolLoop: model => `router <- ${api('new_router')}()
messages <- list(${api('message_user')}(${q(TOUR.toolQuestion)}))
for (turn in seq_len(${val(String(TOUR.maxTurns))})) {
  response <- ${api('complete')}(router, ${api('request')}(
    ${q(model)},
    messages,
    system = ${q(TOUR.system)},
    tools = list(sightings_tool)
  ))
  messages <- c(messages, list(response$message))
  if (response$finish_reason != "tool_call") break
  results <- lapply(${api('tool_calls')}(response), function(call) {
    found <- jsonlite::toJSON(search_sightings(call$input$query))
    ${api('tool_result_part')}(call$id, list(${api('text_part')}(as.character(found))))
  })
  messages <- c(messages, list(${api('message')}("tool", results)))
}
if (response$finish_reason == "tool_call") {
  stop("still calling tools after ${TOUR.maxTurns} turns")
}
${api('response_text')}(response)`,
  soNote: key => `note <- "${lines(X.notes[key])}"`,
  soPlain: model => `req <- ${api('request')}(
  ${q(model)},
  list(${api('message_user')}(note)),
  system = ${q(X.system)}
)
router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
${api('response_text')}(response)`,
  soSchema: other => `places <- ${api('json_array')}(${placeList(other)})
sighting_schema <- ${api('json_object')}(
  type = "object",
  properties = ${api('json_object')}(
    sightings = ${api('json_object')}(
      type = "array",
      items = ${api('json_object')}(
        type = "object",
        properties = ${api('json_object')}(
          species = ${api('json_object')}(
            type = "string",
            description = ${q(X.speciesDescription)}
          ),
          count = ${api('json_object')}(type = "integer"),
          place = ${api('json_object')}(
            type = "string",
            enum = places
          )
        ),
        required = ${api('json_array')}("species", "count", "place"),
        additionalProperties = FALSE
      )
    )
  ),
  required = ${api('json_array')}("sightings"),
  additionalProperties = FALSE
)`,
  soAsk: model => `req <- ${api('request')}(
  ${q(model)},
  list(${api('message_user')}(note)),
  system = ${q(X.system)},
  config = ${api('config')}(response_format = ${api('json_object')}(
    type = "json_schema",
    name = "sightings",
    schema = sighting_schema,
    strict = TRUE
  ))
)
router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
record <- ${api('parse_json')}(response)
str(record)`,
  soUse: () => `for (s in record$sightings) {
  cat(s$count, s$species, "at", s$place, "\\n")
}`,
  program: body => `${dim('library(lm15)')}\n\n${body}`,
};

const julia: Writer = {
  tool: (vague = false) => `sightings_tool = ${api('FunctionTool')}(
    name=${q(TOUR.tool)},
    description=${q(TOUR.toolDescription)},
    parameters=Dict(
        "type" => "object",
        "properties" => Dict(
            "query" => Dict("type" => "string"${vague ? '' : `, "description" => ${q(TOUR.queryDescription)}`}),
        ),
        "required" => ["query"],
    ),
)`,
  request: (model, p) => {
    const options = [
      ...(p.system ? [`system=${q(TOUR.system)}`] : []),
      ...(p.tools ? ['tools=[sightings_tool]'] : []),
      ...(p.config ? [`config=${api('Config')}(max_tokens=${val(String(TOUR.maxTokens))})`] : []),
    ];
    const user = `    ${api('user')}(${q(TOUR.prompt)})`;
    return [`req = ${api('Request')}(`, `    ${q(model)},`, options.length ? `${user};` : `${user},`, ...options.map(o => `    ${o},`), ')'].join('\n');
  },
  router: () => `router = ${api('LMRouter')}()`,
  ask: () => `router = ${api('LMRouter')}()
response = ${api('complete')}(router, req)
println(${api('text')}(response))`,
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
  followUp: (model, history) => [
    `followup = ${api('Request')}(`,
    `    ${q(model)},`,
    ...(history ? ['    req.messages...,', '    response.message,'] : []),
    `    ${api('user')}(${q(TOUR.followUp)});`,
    `    system=${q(TOUR.system)},`,
    ')',
    `println(${api('text')}(${api('complete')}(router, followup)))`,
  ].join('\n'),
  search: () => [
    'const SIGHTINGS = [',
    ...TOUR.sightings.flatMap(x => [`    (date=${q(x.date)}, place=${q(x.place)},`, `     species=${q(x.species)}, count=${val(String(x.count))}),`]),
    ']',
    '',
    'function search_sightings(query)',
    '    query = lowercase(query)',
    '    filter(s -> query in (s.species, s.place, s.date), SIGHTINGS)',
    'end',
  ].join('\n'),
  askTool: model => `req = ${api('Request')}(
    ${q(model)},
    ${api('user')}(${q(TOUR.toolQuestion)});
    system=${q(TOUR.system)},
    tools=[sightings_tool],
)
router = ${api('LMRouter')}()
response = ${api('complete')}(router, req)
println(response.finish_reason)  ${comment('# "tool_call"')}
for call in ${api('tool_calls')}(response)
    println(call.name, " ", call.input)
end`,
  answerTool: () => `results = map(${api('tool_calls')}(response)) do call
    found = search_sightings(call.input["query"])
    ${api('tool_result')}(call, ${api('tool_content')}(found))
end
followup = ${api('Request')}(req; messages=(
    req.messages..., response.message, ${api('tool_message')}(results...),
))
println(${api('text')}(${api('complete')}(router, followup)))`,
  toolLoop: model => `router = ${api('LMRouter')}()
messages = [${api('user')}(${q(TOUR.toolQuestion)})]
answered = false
for turn in 1:${val(String(TOUR.maxTurns))}
    response = ${api('complete')}(router, ${api('Request')}(
        ${q(model)};
        messages,
        system=${q(TOUR.system)},
        tools=[sightings_tool],
    ))
    push!(messages, response.message)
    if response.finish_reason != "tool_call"
        println(${api('text')}(response))
        global answered = true
        break
    end
    results = map(${api('tool_calls')}(response)) do call
        found = search_sightings(call.input["query"])
        ${api('tool_result')}(call, ${api('tool_content')}(found))
    end
    push!(messages, ${api('tool_message')}(results...))
end
answered || error("still calling tools after ${TOUR.maxTurns} turns")`,
  soNote: key => `note = """${lines(X.notes[key])}"""`,
  soPlain: model => `req = ${api('Request')}(
    ${q(model)},
    ${api('user')}(note);
    system=${q(X.system)},
)
router = ${api('LMRouter')}()
response = ${api('complete')}(router, req)
println(${api('text')}(response))`,
  soSchema: other => `places = [${placeList(other)}]
sighting_schema = Dict(
    "type" => "object",
    "properties" => Dict(
        "sightings" => Dict(
            "type" => "array",
            "items" => Dict(
                "type" => "object",
                "properties" => Dict(
                    "species" => Dict(
                        "type" => "string",
                        "description" => ${q(X.speciesDescription)},
                    ),
                    "count" => Dict("type" => "integer"),
                    "place" => Dict(
                        "type" => "string",
                        "enum" => places,
                    ),
                ),
                "required" => ["species", "count", "place"],
                "additionalProperties" => false,
            ),
        ),
    ),
    "required" => ["sightings"],
    "additionalProperties" => false,
)`,
  soAsk: model => `req = ${api('Request')}(
    ${q(model)},
    ${api('user')}(note);
    system=${q(X.system)},
    config=${api('Config')}(response_format=Dict(
        "type" => "json_schema",
        "name" => "sightings",
        "schema" => sighting_schema,
        "strict" => true,
    )),
)
router = ${api('LMRouter')}()
response = ${api('complete')}(router, req)
record = ${api('parse_json')}(response)
println(record)`,
  soUse: () => `for s in record["sightings"]
    println(s["count"], " ", s["species"], " at ", s["place"])
end`,
  program: body => `${dim('using LM15')}\n\n${body}`,
};

/** A writer whose pieces are fitted to its language's budget (the program frame is not: it only indents). */
function fitted(language: Language, w: Writer): Writer {
  const f = (text: string) => fit(language, text);
  return {
    tool: vague => f(w.tool(vague)),
    request: (model, parts) => f(w.request(model, parts)),
    ask: () => f(w.ask()),
    response: () => f(w.response()),
    stream: () => f(w.stream()),
    followUp: (model, history) => f(w.followUp(model, history)),
    search: () => f(w.search()),
    askTool: model => f(w.askTool(model)),
    answerTool: () => f(w.answerTool()),
    toolLoop: model => f(w.toolLoop(model)),
    soNote: key => f(w.soNote(key)),
    soPlain: model => f(w.soPlain(model)),
    soSchema: other => f(w.soSchema(other)),
    soAsk: model => f(w.soAsk(model)),
    soUse: () => f(w.soUse()),
    program: (body, uses) => w.program(body, uses),
    router: () => f(w.router()),
  };
}

const WRITERS: Record<Language, Writer> = {
  python: fitted('python', python), typescript: fitted('typescript', typescript), rust: fitted('rust', rust),
  go: fitted('go', go), r: fitted('r', r), julia: fitted('julia', julia),
};

/** The marked text a view shows (before `finish`). */
function marked(language: Language, view: TourView, model: string): string {
  const w = WRITERS[language];
  switch (view) {
    case 'request': case 'system': case 'config': return w.request(model, partsOf(view));
    case 'tools': return `${w.tool()}\n\n${w.request(model, partsOf('tools'))}`;
    case 'response': return w.response();
    case 'stream': return w.stream();
    case 'program': return streamProgram(w, model);
    case 'first': return firstProgram(w, model);
    case 'tools-search': return w.search();
    case 'tools-define': return w.tool();
    case 'tools-vague': return w.tool(true);
    case 'tools-ask': return w.askTool(model);
    case 'tools-answer': return w.answerTool();
    case 'tools-loop': return toolLoopProgram(w, model);
    case 'so-note': return w.soNote('stream');
    case 'so-plain': return w.soPlain(model);
    case 'so-schema': return w.soSchema(false);
    case 'so-ask': return w.soAsk(model);
    case 'so-use': return w.soUse();
    case 'so-note-barn': return w.soNote('barn');
    case 'so-schema-other': return w.soSchema(true);
    case 'so-program': return soProgram(w, model, 'stream', true);
    case 'followup': return w.followUp(model, true);
    case 'forgetful': return w.followUp(model, false);
  }
}

/** The tools page's whole program: the records, their search, the tool, the loop. */
function toolLoopProgram(w: Writer, model: string): string {
  return w.program(`${w.search()}\n\n${w.tool()}\n\n${w.toolLoop(model)}`, { tool: true, config: false, stream: false, search: true, loop: true });
}

/** The structured-output page's whole program: the schema, a note, the request, the data used. */
function soProgram(w: Writer, model: string, note: NoteKey, other: boolean): string {
  return w.program(`${w.soSchema(other)}\n\n${w.soNote(note)}\n\n${w.soAsk(model)}\n\n${w.soUse()}`, { tool: false, config: true, stream: false, schema: true });
}

/** The first-request page's first program: the request, sent, its text printed. */
function firstProgram(w: Writer, model: string): string {
  return w.program(`${w.request(model, partsOf('request'))}\n\n${w.ask()}`, { tool: false, config: false, stream: false });
}

/** The whole program the "Putting it together" section shows: every part but the tool, streamed. */
function streamProgram(w: Writer, model: string): string {
  const request = w.request(model, { system: true, tools: false, config: true });
  return w.program(`${w.router()}\n${request}\n\n${w.stream()}`, { tool: false, config: true, stream: true });
}

export function tourCode(language: Language, view: TourView, provider: string, model: string): Code {
  return done(marked(language, view, `${provider}:${model}`));
}

/**
 * Whole programs, one per thing the page shows, for the run test: each step's
 * request read back with the response piece, and the streamed program. Their
 * pieces are the very strings `tourCode` shows.
 */
export interface TourProgram {
  name: string;
  source: string;
  streams: boolean;
  /** How many requests the program sends (default 1). */
  requests?: number;
  /** The stand-in server answers the tools question with a call first. */
  toolCall?: boolean;
  /** What stdout must contain (default: the stand-in's text answer). */
  expect?: string[];
  /** The stand-in answers with the structured-output JSON (TOUR.extract.fixtureAnswer). */
  structured?: boolean;
}

export function tourPrograms(language: Language, provider: string, model: string): TourProgram[] {
  const w = WRITERS[language];
  const id = `${provider}:${model}`;
  const complete = STEPS.map(step => {
    const parts = partsOf(step);
    const body = [...(parts.tools ? [w.tool(), ''] : []), w.request(id, parts), '', w.response()].join('\n');
    return { name: step, source: done(w.program(body, { tool: parts.tools, config: parts.config, stream: false })).text, streams: false };
  });
  // The follow-ups: the first answer, then the second question with or without the conversation.
  const followUps = (['followup', 'forgetful'] as const).map(name => {
    const body = [w.request(id, partsOf('system')), '', w.response(), '', w.followUp(id, name === 'followup')].join('\n');
    return { name, source: done(w.program(body, { tool: false, config: false, stream: false })).text, streams: false, requests: 2 };
  });
  // The tools page: the call printed; the call answered; the loop.
  const tools = { tool: true, config: false, stream: false };
  const toolPrograms: TourProgram[] = [
    { name: 'tools-ask', source: done(w.program(`${w.tool()}\n\n${w.askTool(id)}`, tools)).text, streams: false, toolCall: true, expect: ['search_sightings', 'oak grove'] },
    { name: 'tools-answer', source: done(w.program(`${w.search()}\n\n${w.tool()}\n\n${w.askTool(id)}\n\n${w.answerTool()}`, { ...tools, search: true })).text, streams: false, toolCall: true, requests: 2 },
    { name: 'tools-loop', source: done(toolLoopProgram(w, id)).text, streams: false, toolCall: true, requests: 2 },
  ];
  // The structured-output page: plain text; the schema asked and used; the fixed schema on the barn note.
  const structured: TourProgram[] = [
    { name: 'so-plain', source: done(w.program(`${w.soNote('stream')}\n\n${w.soPlain(id)}`, { tool: false, config: false, stream: false, typed: true })).text, streams: false },
    { name: 'so-ask', source: done(soProgram(w, id, 'stream', false)).text, streams: false, structured: true, expect: ['badger', 'stream'] },
    { name: 'so-fixed', source: done(soProgram(w, id, 'barn', true)).text, streams: false, structured: true, expect: ['badger'] },
  ];
  return [{ name: 'first', source: done(firstProgram(w, id)).text, streams: false }, ...complete, { name: 'program', source: done(streamProgram(w, id)).text, streams: true }, ...followUps, ...toolPrograms, ...structured];
}
