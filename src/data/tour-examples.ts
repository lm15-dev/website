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
  | 'so-note' | 'so-plain' | 'so-schema' | 'so-ask' | 'so-use' | 'so-note-barn' | 'so-schema-other' | 'so-program'
  | 'conn-switch' | 'conn-key' | 'conn-local' | 'conn-custom'
  | 'conv-start' | 'conv-parts' | 'conv-loop' | 'conv-save' | 'conv-load'
  | 'err-catch' | 'err-retry' | 'err-use'
  | 'gen-short' | 'gen-temperature' | 'gen-stop' | 'gen-adapt' | 'gen-plan' | 'gen-refuse'
  | 'media-photo' | 'media-log';

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
  /** The question, as a variable (the connect page). */
  connQuestion(): string;
  /** The same question to several models; only the model name changes. */
  connLoop(models: readonly string[]): string;
  /** A router given `provider`'s key explicitly, read from TOUR.connect.keyVariable. */
  connKeyRouter(provider: string): string;
  /** A router that sends `server`'s requests to `url`. */
  connUrlRouter(server: string, url: string): string;
  /** The conversation page: the first question, sent with a list of messages the program keeps. */
  convStart(model: string): string;
  /** The kind of each part of the model's message. */
  convParts(): string;
  /** Three questions in a loop, the list growing; each answer and its input tokens printed. */
  convLoop(model: string): string;
  /** The conversation (after convLoop) saved to a JSON file. */
  convSave(): string;
  /** The next day: the saved conversation read back, and one more question. */
  convLoad(): string;
  /** The errors page: send the request (made just before), and catch the provider's "no such model". */
  errCatch(): string;
  /** A function that sends a request, retrying what is worth retrying, after the provider's advised wait. */
  errRetry(): string;
  /** Use it: a router, the call, the answer printed. */
  errUse(): string;
  /** The generation page: a request with the station's instructions and the given settings. */
  genRequest(model: string, question: GenQuestion, cfg: GenConfig): string;
  /** Send it; print the answer and its finish reason. */
  genShow(): string;
  /** The same question at temperature 0 and at 1, twice each. */
  genTemperature(model: string): string;
  /** Send it; print the answer, then each recorded adaptation's field and action. */
  genAdapt(): string;
  /** Preview the adaptations with no request sent. */
  genPlan(): string;
  /** A router that refuses instead of adapting. */
  genRefuse(): string;
  /** The media page: a file from disk, as a part, and a request asking about it; sent, its answer and input tokens printed. */
  mediaAsk(model: string, which: MediaKind): string;
  /** A whole program around `body`: imports, and whatever the language needs to run it. */
  program(body: string, uses: Uses): string;
  /** The line that makes the router, when the program streams. */
  router(): string;
}
interface Uses { media?: MediaKind; generation?: boolean; errors?: 'catch' | 'retry'; serde?: boolean; tool: boolean; config: boolean; stream: boolean; search?: boolean; loop?: boolean; schema?: boolean; typed?: boolean; env?: boolean; routerConfig?: boolean }
const C = TOUR.connect;
type NoteKey = keyof typeof TOUR.extract.notes;
const X = TOUR.extract;
const V = TOUR.conversation;
const G = TOUR.generation;
const MEDIA = TOUR.media;
type MediaKind = 'photo' | 'log';
type GenQuestion = 'prompt' | 'list';
interface GenConfig { maxTokens?: number; temperature?: number; seed?: number; stop?: string[] }
const genSystem = (question: GenQuestion) => question === 'list' ? G.listSystem : TOUR.system;
const genText = (question: GenQuestion) => question === 'list' ? G.listQuestion : TOUR.prompt;
/** A number as the language writes a float literal (1.5, 1.0). */
const float = (n: number) => Number.isInteger(n) ? `${n}.0` : String(n);
const FILE = () => q(V.file);
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
  connQuestion: () => `question = ${q(TOUR.prompt)}`,
  connLoop: models => `router = ${api('LMRouter')}()
for model in [
${models.map(m => `    ${q(m)},`).join('\n')}
]:
    request = ${api('Request')}(
        model=model,
        system=${q(TOUR.system)},
        messages=[${api('Message.user')}(question)],
    )
    print(model, "->", ${api('router.complete')}(request).text)`,
  connKeyRouter: provider => `router = ${api('LMRouter')}(${api('RouterConfig')}(
    api_keys={${q(provider)}: os.environ[${q(C.keyVariable)}]},
))`,
  connUrlRouter: (server, url) => `router = ${api('LMRouter')}(${api('RouterConfig')}(
    base_urls={${q(server)}: ${q(url)}},
))`,
  mediaAsk: (model, which) => {
    const m = MEDIA[which], name = which === 'photo' ? 'photo' : 'logbook', fn = which === 'photo' ? 'image' : 'document';
    const line = `${name} = ${api(fn)}(path=${q(m.file)}, media_type=${q(m.mediaType)})`;
    const part = plain(line).length <= WIDTH ? line : `${name} = ${api(fn)}(
    path=${q(m.file)}, media_type=${q(m.mediaType)},
)`;
    return `${part}
request = ${api('Request')}(
    model=${q(model)},
    system=${q(TOUR.system)},
    messages=[${api('Message.user')}([
        ${q(m.question)},
        ${name},
    ])],
)
router = ${api('LMRouter')}()
response = ${api('router.complete')}(request)
print(response.text)
print(response.usage.input_tokens, "tokens in")`;
  },
  genRequest: (model, question, cfg) => {
    const args = [
      ...(cfg.maxTokens !== undefined ? [`max_tokens=${val(String(cfg.maxTokens))}`] : []),
      ...(cfg.temperature !== undefined ? [`temperature=${val(float(cfg.temperature))}`] : []),
      ...(cfg.seed !== undefined ? [`seed=${val(String(cfg.seed))}`] : []),
      ...(cfg.stop ? [`stop=[${cfg.stop.map(q).join(', ')}]`] : []),
    ];
    return `request = ${api('Request')}(
    model=${q(model)},
    system=${q(genSystem(question))},
    messages=[${api('Message.user')}(${q(genText(question))})],
    config=${api('Config')}(${args.join(', ')}),
)`;
  },
  genShow: () => `router = ${api('LMRouter')}()
response = ${api('router.complete')}(request)
print(response.text)
print(response.finish_reason)`,
  genTemperature: model => `router = ${api('LMRouter')}()
for temperature in [${val('0.0')}, ${val('1.0')}]:
    for run in range(2):
        response = ${api('router.complete')}(${api('Request')}(
            model=${q(model)},
            system=${q(TOUR.system)},
            messages=[${api('Message.user')}(${q(TOUR.prompt)})],
            config=${api('Config')}(temperature=temperature),
        ))
        print(temperature, response.text)`,
  genAdapt: () => `router = ${api('LMRouter')}()
response = ${api('router.complete')}(request)
print(response.text)
for a in response.${api('adaptations')}:
    print(a.field, a.action)`,
  genPlan: () => `for a in ${api('router.plan')}(request):
    print(a.field, a.action)`,
  genRefuse: () => `strict = ${api('LMRouter')}(${api('RouterConfig')}(adaptations=${q('refuse')}))
try:
    print(strict.complete(request).text)
except ${api('UnsupportedFeatureError')} as error:
    print("Refused:", error.feature)`,
  errCatch: () => `router = ${api('LMRouter')}()
try:
    response = ${api('router.complete')}(request)
    print(response.text)
except ${api('UnsupportedModelError')} as error:
    print("No such model at", error.provider)
    print(error)`,
  errRetry: () => `def complete_with_retries(router, request, attempts=4):
    for attempt in range(1, attempts + 1):
        try:
            return ${api('router.complete')}(request)
        except ${api('RETRYABLE_ERRORS')} as error:
            if attempt == attempts:
                raise
            wait = error.${api('retry_after')}
            if wait is None:
                wait = 2 ** attempt
            print(f"{type(error).__name__}, waiting {wait} s")
            time.sleep(wait)`,
  errUse: () => `router = ${api('LMRouter')}()
response = complete_with_retries(router, request)
print(response.text)`,
  convStart: model => `router = ${api('LMRouter')}()
messages = [${api('Message.user')}(${q(TOUR.prompt)})]
response = ${api('router.complete')}(${api('Request')}(
    model=${q(model)},
    system=${q(TOUR.system)},
    messages=messages,
))
messages.append(response.message)
print(response.text)`,
  convParts: () => `for part in response.message.parts:
    print(part.type)`,
  convLoop: model => `router = ${api('LMRouter')}()
model = ${q(model)}
instructions = ${q(TOUR.system)}
messages = []
for question in [
${V.questions.map(x => `    ${q(x)},`).join('\n')}
]:
    messages.append(${api('Message.user')}(question))
    response = ${api('router.complete')}(${api('Request')}(
        model=model, system=instructions, messages=messages,
    ))
    messages.append(response.message)
    print(">", question)
    print(response.text)
    print(response.usage.input_tokens, "tokens in")`,
  convSave: () => `saved = ${api('Request')}(model=model, system=instructions, messages=messages)
with open(${FILE()}, "w") as f:
    json.dump(${api('request_to_dict')}(saved), f)`,
  convLoad: () => `with open(${FILE()}) as f:
    saved = ${api('request_from_dict')}(json.load(f))
followup = ${api('Request')}(
    model=saved.model,
    system=saved.system,
    messages=[*saved.messages, ${api('Message.user')}(${q(V.nextDay)})],
)
router = ${api('LMRouter')}()
print(${api('router.complete')}(followup).text)`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', 'Request', ...(uses.config ? ['Config'] : []), ...(uses.stream ? ['ResponseStream'] : []), ...(uses.tool ? ['FunctionTool'] : [])].sort();
    const std = [...(uses.search || uses.serde ? ['import json'] : []), ...(uses.env ? ['import os'] : []), ...(uses.errors === 'retry' ? ['import time'] : [])];
    const errorNames = [...(uses.media ? [] : []), ...(uses.errors === 'catch' ? ['UnsupportedModelError'] : uses.errors === 'retry' ? ['RETRYABLE_ERRORS'] : []), ...(uses.generation ? ['Config', 'RouterConfig', 'UnsupportedFeatureError'] : [])];
    const lm15 = [...new Set([...names, ...errorNames, ...(uses.routerConfig ? ['RouterConfig'] : [])])].sort();
    const serde = uses.serde ? `\n${dim('from lm15.serde import request_from_dict, request_to_dict')}` : uses.media ? `\n${dim(`from lm15.types import ${uses.media === 'photo' ? 'image' : 'document'}`)}` : '';
    // A long import list wraps the way black writes it.
    const line = `from lm15 import ${lm15.join(', ')}`;
    const imports = line.length <= WIDTH ? line : `from lm15 import (\n${wrapNames(lm15, '    ')}\n)`;
    return `${std.length ? `${dim(std.join('\n'))}\n\n` : ''}${dim(imports)}${serde}\n\n${body}`;
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
  connQuestion: () => `const question = ${q(TOUR.prompt)};`,
  connLoop: models => `const router = new ${api('LMRouter')}();
for (const model of [
${models.map(m => `  ${q(m)},`).join('\n')}
]) {
  const response = await ${api('router.complete')}({
    model,
    system: ${q(TOUR.system)},
    messages: [${api('Message.user')}(question)],
  });
  console.log(model, "->", response.text);
}`,
  connKeyRouter: provider => `const router = new ${api('LMRouter')}({
  apiKeys: { ${q(provider)}: process.env[${q(C.keyVariable)}] ?? "" },
});`,
  connUrlRouter: (server, url) => `const router = new ${api('LMRouter')}({
  baseUrls: { ${q(server)}: ${q(url)} },
});`,
  mediaAsk: (model, which) => {
    const m = MEDIA[which], name = which === 'photo' ? 'photo' : 'logbook', fn = which === 'photo' ? 'image' : 'document';
    return `const ${name} = ${api(fn)}({
  path: ${q(m.file)},
  mediaType: ${q(m.mediaType)},
});
const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}({
  model: ${q(model)},
  system: ${q(TOUR.system)},
  messages: [${api('Message.user')}([
    ${q(m.question)},
    ${name},
  ])],
});
console.log(response.text);
console.log(response.usage.inputTokens, "tokens in");`;
  },
  genRequest: (model, question, cfg) => {
    const fields = [
      ...(cfg.maxTokens !== undefined ? [`maxTokens: ${val(String(cfg.maxTokens))}`] : []),
      ...(cfg.temperature !== undefined ? [`temperature: ${val(String(cfg.temperature))}`] : []),
      ...(cfg.seed !== undefined ? [`seed: ${val(String(cfg.seed))}`] : []),
      ...(cfg.stop ? [`stop: [${cfg.stop.map(q).join(', ')}]`] : []),
    ];
    return `const request = {
  model: ${q(model)},
  system: ${q(genSystem(question))},
  messages: [${api('Message.user')}(${q(genText(question))})],
  config: { ${fields.join(', ')} },
};`;
  },
  genShow: () => `const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}(request);
console.log(response.text);
console.log(response.finishReason);`,
  genTemperature: model => `const router = new ${api('LMRouter')}();
for (const temperature of [${val('0')}, ${val('1')}]) {
  for (let run = 0; run < 2; run++) {
    const response = await ${api('router.complete')}({
      model: ${q(model)},
      system: ${q(TOUR.system)},
      messages: [${api('Message.user')}(${q(TOUR.prompt)})],
      config: { temperature },
    });
    console.log(temperature, response.text);
  }
}`,
  genAdapt: () => `const router = new ${api('LMRouter')}();
const response = await ${api('router.complete')}(request);
console.log(response.text);
for (const a of response.${api('adaptations')}) {
  console.log(a.field, a.action);
}`,
  genPlan: () => `for (const a of await ${api('router.plan')}(request)) {
  console.log(a.field, a.action);
}`,
  genRefuse: () => `const strict = new ${api('LMRouter')}({ adaptations: ${q('refuse')} });
try {
  console.log((await strict.complete(request)).text);
} catch (error) {
  if (!(error instanceof ${api('UnsupportedFeatureError')})) throw error;
  console.log("Refused:", error.feature);
}`,
  errCatch: () => `const router = new ${api('LMRouter')}();
try {
  const response = await ${api('router.complete')}(request);
  console.log(response.text);
} catch (error) {
  if (!(error instanceof ${api('UnsupportedModelError')})) throw error;
  console.log("No such model at", error.provider);
  console.log(error.message);
}`,
  errRetry: () => `async function completeWithRetries(
  router: ${api('LMRouter')}, request: ${api('Request')}, attempts = 4,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ${api('router.complete')}(request);
    } catch (error) {
      if (!(error instanceof ${api('LM15Error')})) throw error;
      if (!error.${api('retryable')} || attempt === attempts) throw error;
      const wait = error.${api('retryAfter')} ?? 2 ** attempt;
      console.log(\`\${error.name}, waiting \${wait} s\`);
      await new Promise((done) => setTimeout(done, wait * 1000));
    }
  }
}`,
  errUse: () => `const router = new ${api('LMRouter')}();
const response = await completeWithRetries(router, request);
console.log(response.text);`,
  convStart: model => `const router = new ${api('LMRouter')}();
const messages = [${api('Message.user')}(${q(TOUR.prompt)})];
const response = await ${api('router.complete')}({
  model: ${q(model)},
  system: ${q(TOUR.system)},
  messages,
});
messages.push(response.message);
console.log(response.text);`,
  convParts: () => `for (const part of response.message.parts) {
  console.log(part.type);
}`,
  convLoop: model => `const router = new ${api('LMRouter')}();
const model = ${q(model)};
const instructions = ${q(TOUR.system)};
const messages: ${api('Message')}[] = [];
for (const question of [
${V.questions.map(x => `  ${q(x)},`).join('\n')}
]) {
  messages.push(${api('Message.user')}(question));
  const response = await ${api('router.complete')}({
    model, system: instructions, messages,
  });
  messages.push(response.message);
  console.log(">", question);
  console.log(response.text);
  console.log(response.usage.inputTokens, "tokens in");
}`,
  convSave: () => `const saved = { model, system: instructions, messages };
const json = JSON.stringify(${api('Request.toJSON')}(saved));
writeFileSync(${FILE()}, json);`,
  convLoad: () => `const json = readFileSync(${FILE()}, "utf8");
const saved = ${api('Request.fromJSON')}(JSON.parse(json));
const followup = {
  model: saved.model,
  system: saved.system,
  messages: [...saved.messages, ${api('Message.user')}(${q(V.nextDay)})],
};
const router = new ${api('LMRouter')}();
console.log((await ${api('router.complete')}(followup)).text);`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', ...(uses.stream ? ['ResponseStream'] : []), ...(uses.tool ? ['type FunctionTool'] : []), ...(uses.serde ? ['Request'] : uses.schema || uses.typed || uses.errors === 'retry' ? ['type Request'] : []), ...(uses.errors === 'catch' ? ['UnsupportedModelError'] : uses.errors === 'retry' ? ['LM15Error'] : []), ...(uses.generation ? ['UnsupportedFeatureError'] : []), ...(uses.media === 'photo' ? ['image'] : uses.media === 'log' ? ['document'] : [])];
    const fs = uses.serde ? `${dim('import { readFileSync, writeFileSync } from "node:fs";')}\n` : '';
    return `${fs}${dim(`import { ${names.join(', ')} } from "@lm15/lm15";`)}\n\n${body}`;
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
  connQuestion: () => `let question = ${q(TOUR.prompt)};`,
  connLoop: models => `let router = ${api('LMRouter::new')}();
for model in [
${models.map(m => `    ${q(m)},`).join('\n')}
] {
    let request = ${api('Request')} {
        model: model.into(),
        system: Some(${q(TOUR.system)}.into()),
        messages: vec![${api('Message::user')}(question)?],
        ${dim('..Default::default()')}
    };
    let response = ${api('router.complete')}(&request).await?;
    println!("{model} -> {}", response.${api('text')}().unwrap_or_default());
}`,
  connKeyRouter: provider => `let key = std::env::var(${q(C.keyVariable)})?;
let router = ${api('LMRouter::with_config')}(
    ${api('RouterConfig::new')}().${api('api_key')}(${q(provider)}, key),
)?;`,
  connUrlRouter: (server, url) => `let router = ${api('LMRouter::with_config')}(
    ${api('RouterConfig::new')}().${api('base_url')}(${q(server)}, ${q(url)}),
)?;`,
  mediaAsk: (model, which) => {
    const m = MEDIA[which], name = which === 'photo' ? 'photo' : 'logbook', T = which === 'photo' ? 'ImagePart' : 'DocumentPart', V = which === 'photo' ? 'Image' : 'Document';
    return `let ${name} = ${api(T)} {
    media_type: ${q(m.mediaType)}.into(),
    path: Some(${q(m.file)}.into()),
    ..Default::default()
};
let request = ${api('Request')} {
    model: ${q(model)}.into(),
    system: Some(${q(TOUR.system)}.into()),
    messages: vec![${api('Message::user')}(vec![
        ${api('Part::text')}(${q(m.question)}),
        ${api(`Part::${V}`)}(${name}),
    ])?],
    ..Default::default()
};
let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
println!("{}", response.text().unwrap_or_default());
if let Some(tokens) = response.usage.input_tokens {
    println!("{tokens} tokens in");
}`;
  },
  genRequest: (model, question, cfg) => {
    const fields = [
      ...(cfg.maxTokens !== undefined ? [`max_tokens: Some(${val(String(cfg.maxTokens))}),`] : []),
      ...(cfg.temperature !== undefined ? [`temperature: Some(${val(float(cfg.temperature))}),`] : []),
      ...(cfg.seed !== undefined ? [`seed: Some(${val(String(cfg.seed))}),`] : []),
      ...(cfg.stop ? [`stop: vec![${cfg.stop.map(x => `${q(x)}.into()`).join(', ')}],`] : []),
    ];
    return `let request = ${api('Request')} {
    model: ${q(model)}.into(),
    system: Some(${q(genSystem(question))}.into()),
    messages: vec![${api('Message::user')}(${q(genText(question))})?],
    config: ${api('Config')} {
${fields.map(f => `        ${f}`).join('\n')}
        ..Default::default()
    },
    ..Default::default()
};`;
  },
  genShow: () => `let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
println!("{}", response.text().unwrap_or_default());
println!("{}", response.finish_reason);`,
  genTemperature: model => `let router = ${api('LMRouter::new')}();
for temperature in [${val('0.0')}, ${val('1.0')}] {
    for _run in 0..2 {
        let request = ${api('Request')} {
            model: ${q(model)}.into(),
            system: Some(${q(TOUR.system)}.into()),
            messages: vec![${api('Message::user')}(${q(TOUR.prompt)})?],
            config: ${api('Config')} {
                temperature: Some(temperature),
                ..Default::default()
            },
            ..Default::default()
        };
        let response = ${api('router.complete')}(&request).await?;
        let text = response.text().unwrap_or_default();
        println!("{temperature} {text}");
    }
}`,
  genAdapt: () => `let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&request).await?;
println!("{}", response.text().unwrap_or_default());
for a in &response.${api('adaptations')} {
    println!("{} {}", a.field, a.action);
}`,
  genPlan: () => `for a in ${api('router.plan')}(&request)? {
    println!("{} {}", a.field, a.action);
}`,
  genRefuse: () => `let strict = ${api('LMRouter::with_config')}(
    ${api('RouterConfig::new')}().${api('adaptations')}(${api('AdaptationPolicy::Refuse')}),
)?;
match strict.complete(&request).await {
    Ok(response) => {
        println!("{}", response.text().unwrap_or_default());
    }
    Err(e) if e.${api('is_a')}(${api('ErrorClass::UnsupportedFeatureError')}) => {
        println!("Refused: {}", e.${api('feature')}().unwrap_or_default());
    }
    Err(e) => return Err(e.into()),
}`,
  errCatch: () => `let router = ${api('LMRouter::new')}();
match ${api('router.complete')}(&request).await {
    Ok(response) => {
        println!("{}", response.text().unwrap_or_default());
    }
    Err(error) if error.${api('is_a')}(${api('ErrorClass::UnsupportedModelError')}) => {
        let provider = error.provider().unwrap_or_default();
        println!("No such model at {provider}");
        println!("{error}");
    }
    Err(error) => return Err(error.into()),
}`,
  errRetry: () => `async fn complete_with_retries(
    router: &${api('LMRouter')},
    request: &${api('Request')},
    attempts: i32,
) -> Result<${api('Response')}, ${api('Lm15Error')}> {
    for attempt in 1.. {
        let error = match ${api('router.complete')}(request).await {
            Err(e) if e.${api('is_retryable')}() && attempt < attempts => e,
            result => return result,
        };
        let backoff = 2f64.powi(attempt);
        let wait = error.${api('retry_after')}().unwrap_or(backoff);
        println!("{}, waiting {wait} s", error.class_name());
        let pause = std::time::Duration::from_secs_f64(wait);
        tokio::time::sleep(pause).await;
    }
    unreachable!()
}`,
  errUse: () => `let router = ${api('LMRouter::new')}();
let response = complete_with_retries(&router, &request, 4).await?;
println!("{}", response.text().unwrap_or_default());`,
  convStart: model => `let router = ${api('LMRouter::new')}();
let mut messages = vec![${api('Message::user')}(${q(TOUR.prompt)})?];
let request = ${api('Request')} {
    model: ${q(model)}.into(),
    system: Some(${q(TOUR.system)}.into()),
    messages: messages.clone(),
    ..Default::default()
};
let response = ${api('router.complete')}(&request).await?;
messages.push(response.message.clone());
println!("{}", response.text().unwrap_or_default());`,
  convParts: () => `for part in &response.message.parts {
    println!("{}", part.${api('type_name')}());
}`,
  convLoop: model => `let router = ${api('LMRouter::new')}();
let model = ${q(model)};
let instructions = ${q(TOUR.system)};
let mut messages = Vec::new();
for question in [
${V.questions.map(x => `    ${q(x)},`).join('\n')}
] {
    messages.push(${api('Message::user')}(question)?);
    let request = ${api('Request')} {
        model: model.into(),
        system: Some(instructions.into()),
        messages: messages.clone(),
        ..Default::default()
    };
    let response = ${api('router.complete')}(&request).await?;
    messages.push(response.message.clone());
    println!("> {question}");
    println!("{}", response.text().unwrap_or_default());
    if let Some(tokens) = response.usage.input_tokens {
        println!("{tokens} tokens in");
    }
}`,
  convSave: () => `let saved = ${api('Request')} {
    model: model.into(),
    system: Some(instructions.into()),
    messages,
    ..Default::default()
};
let json = serde_json::to_string(&saved)?;
std::fs::write(${FILE()}, json)?;`,
  convLoad: () => `let json = std::fs::read_to_string(${FILE()})?;
let saved: ${api('Request')} = serde_json::from_str(&json)?;
let mut messages = saved.messages.clone();
messages.push(${api('Message::user')}(${q(V.nextDay)})?);
let followup = ${api('Request')} { messages, ..saved };
let router = ${api('LMRouter::new')}();
let response = ${api('router.complete')}(&followup).await?;
println!("{}", response.text().unwrap_or_default());`,
  program: (body, uses) => {
    const names = ['LMRouter', 'Message', 'Request', ...(uses.config ? ['Config'] : []), ...(uses.tool ? ['FunctionTool', 'Tool'] : []), ...(uses.stream ? ['ResponseStream'] : []), ...(uses.loop ? ['FinishReason'] : []), ...(uses.search ? ['JsonObject'] : []), ...(uses.routerConfig ? ['RouterConfig'] : []), ...(uses.errors === 'catch' ? ['ErrorClass'] : uses.errors === 'retry' ? ['Lm15Error', 'Response'] : []), ...(uses.generation ? ['AdaptationPolicy', 'Config', 'ErrorClass', 'RouterConfig'] : []), ...(uses.media === 'photo' ? ['ImagePart', 'Part'] : uses.media === 'log' ? ['DocumentPart', 'Part'] : [])].filter((n, i, all) => all.indexOf(n) === i).sort();
    const deps = ['lm15', uses.errors === 'retry' ? 'tokio (macros, rt-multi-thread, time)' : 'tokio (macros, rt-multi-thread)', ...(uses.tool || uses.schema || uses.serde ? ['serde_json'] : []), ...(uses.stream ? ['futures-util'] : [])];
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
    Parameters: ${api('lm15.JSONObject')}{
        ${api('lm15.KV')}("type", "object"),
        ${api('lm15.KV')}("properties", lm15.JSONObject{
            lm15.KV("query", lm15.JSONObject{
                lm15.KV("type", "string"),${vague ? '' : `
                lm15.KV("description", ${q(TOUR.queryDescription)}),`}
            }),
        }),
        lm15.KV("required", []any{"query"}),
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
    query, _ := call.Input.${api('Get')}("query").(string)
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
        query, _ := call.Input.${api('Get')}("query").(string)
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
${comment('// Keys keep their order: the model fills them in that order.')}
sightingSchema := ${api('lm15.JSONObject')}{
    ${api('lm15.KV')}("type", "object"),
    lm15.KV("properties", lm15.JSONObject{
        lm15.KV("sightings", lm15.JSONObject{
            lm15.KV("type", "array"),
            lm15.KV("items", lm15.JSONObject{
                lm15.KV("type", "object"),
                lm15.KV("properties", lm15.JSONObject{
                    lm15.KV("species", lm15.JSONObject{
                        lm15.KV("type", "string"),
                        lm15.KV("description", ${q(X.speciesDescription)}),
                    }),
                    lm15.KV("count", lm15.JSONObject{
                        lm15.KV("type", "integer"),
                    }),
                    lm15.KV("place", lm15.JSONObject{
                        lm15.KV("type", "string"),
                        lm15.KV("enum", places),
                    }),
                }),
                lm15.KV("required", []any{
                    "species", "count", "place",
                }),
                lm15.KV("additionalProperties", false),
            }),
        }),
    }),
    lm15.KV("required", []any{"sightings"}),
    lm15.KV("additionalProperties", false),
}`,
  soAsk: model => `request := &${api('lm15.Request')}{
    Model:    ${q(model)},
    System:   ${api('lm15.System')}(${q(X.system)}),
    Messages: []${api('lm15.Message')}{${api('lm15.UserMessage')}(note)},
    Config: ${api('lm15.Config')}{
        ResponseFormat: lm15.JSONObject{
            lm15.KV("type", "json_schema"),
            lm15.KV("name", "sightings"),
            lm15.KV("schema", sightingSchema),
            lm15.KV("strict", true),
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
  connQuestion: () => `question := ${q(TOUR.prompt)}`,
  connLoop: models => `router := ${api('lm15.NewRouter')}()
for _, model := range []string{
${models.map(m => `    ${q(m)},`).join('\n')}
} {
    request := &${api('lm15.Request')}{
        Model:    model,
        System:   ${api('lm15.System')}(${q(TOUR.system)}),
        Messages: []${api('lm15.Message')}{${api('lm15.UserMessage')}(question)},
    }
    response, err := ${api('router.Complete')}(context.Background(), request)
${dim('    if err != nil {\n        panic(err)\n    }')}
    fmt.Println(model, "->", response.${api('TextOr')}(""))
}`,
  connKeyRouter: provider => `router, err := ${api('lm15.NewRouterWithConfig')}(${api('lm15.RouterConfig')}{
    APIKeys: map[string]${api('lm15.CredentialLike')}{
        ${q(provider)}: os.Getenv(${q(C.keyVariable)}),
    },
})
${dim('if err != nil {\n    panic(err)\n}')}`,
  connUrlRouter: (server, url) => `router, err := ${api('lm15.NewRouterWithConfig')}(${api('lm15.RouterConfig')}{
    BaseURLs: map[string]string{${q(server)}: ${q(url)}},
})
${dim('if err != nil {\n    panic(err)\n}')}`,
  mediaAsk: (model, which) => {
    const m = MEDIA[which], name = which === 'photo' ? 'photo' : 'logbook', fn = which === 'photo' ? 'lm15.Image' : 'lm15.Document';
    return `${name} := ${api(fn)}(${api('lm15.WithPath')}(${q(m.file)}))
request := &${api('lm15.Request')}{
    Model:  ${q(model)},
    System: ${api('lm15.System')}(${q(TOUR.system)}),
    Messages: []${api('lm15.Message')}{
        ${api('lm15.UserParts')}(
            ${api('lm15.Text')}(${q(m.question)}),
            ${name},
        ),
    },
}
router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.TextOr(""))
if in := response.Usage.InputTokens; in != nil {
    fmt.Println(*in, "tokens in")
}`;
  },
  genRequest: (model, question, cfg) => {
    const entries: [string, string][] = [
      ...(cfg.maxTokens !== undefined ? [['MaxTokens', `${api('lm15.I')}(${val(String(cfg.maxTokens))})`] as [string, string]] : []),
      ...(cfg.temperature !== undefined ? [['Temperature', `${api('lm15.F')}(${val(String(cfg.temperature))})`] as [string, string]] : []),
      ...(cfg.seed !== undefined ? [['Seed', `${api('lm15.I')}(${val(String(cfg.seed))})`] as [string, string]] : []),
      ...(cfg.stop ? [['Stop', `[]string{${cfg.stop.map(q).join(', ')}}`] as [string, string]] : []),
    ];
    const pad = Math.max(...entries.map(([k]) => k.length)) + 1;
    const fields = entries.map(([k, v]) => `${`${k}:`.padEnd(pad + 1)}${v}`);
    return `request := &${api('lm15.Request')}{
    Model:  ${q(model)},
    System: ${api('lm15.System')}(${q(genSystem(question))}),
    Messages: []${api('lm15.Message')}{
        ${api('lm15.UserMessage')}(${q(genText(question))}),
    },
    Config: ${api('lm15.Config')}{
${fields.map(f => `        ${f},`).join('\n')}
    },
}`;
  },
  genShow: () => `router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.TextOr(""))
fmt.Println(response.FinishReason)`,
  genTemperature: model => `router := ${api('lm15.NewRouter')}()
ctx := context.Background()
for _, temperature := range []float64{${val('0')}, ${val('1')}} {
    for run := 0; run < 2; run++ {
        request := &${api('lm15.Request')}{
            Model:  ${q(model)},
            System: ${api('lm15.System')}(${q(TOUR.system)}),
            Messages: []${api('lm15.Message')}{
                ${api('lm15.UserMessage')}(${q(TOUR.prompt)}),
            },
            Config: ${api('lm15.Config')}{Temperature: ${api('lm15.F')}(temperature)},
        }
        response, err := ${api('router.Complete')}(ctx, request)
${dim('        if err != nil {\n            panic(err)\n        }')}
        fmt.Println(temperature, response.TextOr(""))
    }
}`,
  genAdapt: () => `router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.TextOr(""))
for _, a := range response.${api('Adaptations')} {
    fmt.Println(a.Field, a.Action)
}`,
  genPlan: () => `records, err := ${api('router.Plan')}(request)
${dim('if err != nil {\n    panic(err)\n}')}
for _, a := range records {
    fmt.Println(a.Field, a.Action)
}`,
  genRefuse: () => `strict, err := ${api('lm15.NewRouterWithConfig')}(${api('lm15.RouterConfig')}{
    ${api('Adaptations')}: ${q('refuse')},
})
${dim('if err != nil {\n    panic(err)\n}')}
answer, err := strict.Complete(context.Background(), request)
var lmErr *${api('lm15.Error')}
refused := errors.As(err, &lmErr) &&
    lmErr.Kind.${api('IsA')}(${api('lm15.KindUnsupportedFeature')})
switch {
case err == nil:
    fmt.Println(answer.TextOr(""))
case refused:
    fmt.Println("Refused:", lmErr.${api('Feature')})
default:
    panic(err)
}`,
  errCatch: () => `router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), request)
var lmErr *${api('lm15.Error')}
unsupported := errors.As(err, &lmErr) &&
    lmErr.Kind.${api('IsA')}(${api('lm15.KindUnsupportedModel')})
switch {
case err == nil:
    fmt.Println(response.TextOr(""))
case unsupported:
    fmt.Println("No such model at", lmErr.Provider)
    fmt.Println(lmErr)
default:
    panic(err)
}`,
  errRetry: () => `completeWithRetries := func(
    router *${api('lm15.LMRouter')}, request *${api('lm15.Request')}, attempts int,
) (*${api('lm15.Response')}, error) {
    ctx := context.Background()
    for attempt := 1; ; attempt++ {
        response, err := ${api('router.Complete')}(ctx, request)
        var lmErr *${api('lm15.Error')}
        if !errors.As(err, &lmErr) || !lmErr.${api('Retryable')}() {
            return response, err
        }
        if attempt == attempts {
            return response, err
        }
        wait := math.Pow(2, float64(attempt))
        if lmErr.${api('RetryAfter')} != nil {
            wait = *lmErr.${api('RetryAfter')}
        }
        fmt.Printf("%s, waiting %v s\\n", lmErr.Kind, wait)
        time.Sleep(time.Duration(wait * float64(time.Second)))
    }
}`,
  errUse: () => `router := ${api('lm15.NewRouter')}()
response, err := completeWithRetries(router, request, 4)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.TextOr(""))`,
  convStart: model => `router := ${api('lm15.NewRouter')}()
messages := []${api('lm15.Message')}{
    ${api('lm15.UserMessage')}(${q(TOUR.prompt)}),
}
request := &${api('lm15.Request')}{
    Model:    ${q(model)},
    System:   ${api('lm15.System')}(${q(TOUR.system)}),
    Messages: messages,
}
response, err := ${api('router.Complete')}(context.Background(), request)
${dim('if err != nil {\n    panic(err)\n}')}
messages = append(messages, response.Message)
fmt.Println(response.TextOr(""))`,
  convParts: () => `for _, part := range response.Message.Parts {
    fmt.Println(part.${api('Type')}())
}`,
  convLoop: model => `router := ${api('lm15.NewRouter')}()
model := ${q(model)}
instructions := ${q(TOUR.system)}
var messages []${api('lm15.Message')}
for _, question := range []string{
${V.questions.map(x => `    ${q(x)},`).join('\n')}
} {
    messages = append(messages, ${api('lm15.UserMessage')}(question))
    request := &${api('lm15.Request')}{
        Model:    model,
        System:   ${api('lm15.System')}(instructions),
        Messages: messages,
    }
    response, err := ${api('router.Complete')}(context.Background(), request)
${dim('    if err != nil {\n        panic(err)\n    }')}
    messages = append(messages, response.Message)
    fmt.Println(">", question)
    fmt.Println(response.TextOr(""))
    if in := response.Usage.InputTokens; in != nil {
        fmt.Println(*in, "tokens in")
    }
}`,
  convSave: () => `saved := &${api('lm15.Request')}{
    Model:    model,
    System:   ${api('lm15.System')}(instructions),
    Messages: messages,
}
data, err := json.Marshal(${api('lm15.RequestToDict')}(saved))
${dim('if err != nil {\n    panic(err)\n}')}
err = os.WriteFile(${FILE()}, data, 0o600)
${dim('if err != nil {\n    panic(err)\n}')}`,
  convLoad: () => `data, err := os.ReadFile(${FILE()})
${dim('if err != nil {\n    panic(err)\n}')}
var dict ${api('lm15.JSONObject')}
${dim('if err := json.Unmarshal(data, &dict); err != nil {\n    panic(err)\n}')}
saved, err := ${api('lm15.RequestFromDict')}(dict)
${dim('if err != nil {\n    panic(err)\n}')}
saved.Messages = append(saved.Messages, ${api('lm15.UserMessage')}(
    ${q(V.nextDay)},
))
router := ${api('lm15.NewRouter')}()
response, err := ${api('router.Complete')}(context.Background(), saved)
${dim('if err != nil {\n    panic(err)\n}')}
fmt.Println(response.TextOr(""))`,
  program: (body, uses) => [
    dim(`package main\n\nimport (\n    "context"\n${uses?.search || uses?.serde ? '    "encoding/json"\n' : ''}${uses?.errors || uses?.generation ? '    "errors"\n' : ''}    "fmt"\n${uses?.errors === 'retry' ? '    "math"\n' : ''}${uses?.env || uses?.serde ? '    "os"\n' : ''}${uses?.search ? '    "strings"\n' : ''}${uses?.errors === 'retry' ? '    "time"\n' : ''}    lm15 "github.com/lm15-dev/lm15-go"\n)\n\nfunc main() {`),
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
  connQuestion: () => `question <- ${q(TOUR.prompt)}`,
  connLoop: models => `router <- ${api('new_router')}()
for (model in c(
${models.map((m, i) => `  ${q(m)}${i < models.length - 1 ? ',' : ''}`).join('\n')}
)) {
  response <- ${api('complete')}(router, ${api('request')}(
    model,
    list(${api('message_user')}(question)),
    system = ${q(TOUR.system)}
  ))
  cat(model, "->", ${api('response_text')}(response), "\\n")
}`,
  connKeyRouter: provider => `router <- ${api('new_router')}(
  api_keys = list(${q(provider)} = Sys.getenv(${q(C.keyVariable)}))
)`,
  connUrlRouter: (server, url) => `router <- ${api('new_router')}(
  base_urls = list(${q(server)} = ${q(url)})
)`,
  mediaAsk: (model, which) => {
    const m = MEDIA[which], name = which === 'photo' ? 'photo' : 'logbook', fn = which === 'photo' ? 'image_part' : 'document_part';
    return `${name} <- ${api(fn)}(
  path = ${q(m.file)},
  media_type = ${q(m.mediaType)}
)
req <- ${api('request')}(
  ${q(model)},
  list(${api('message_user')}(list(
    ${q(m.question)},
    ${name}
  ))),
  system = ${q(TOUR.system)}
)
router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
${api('response_text')}(response)
response$usage$input_tokens`;
  },
  genRequest: (model, question, cfg) => {
    const args = [
      ...(cfg.maxTokens !== undefined ? [`max_tokens = ${val(String(cfg.maxTokens))}`] : []),
      ...(cfg.temperature !== undefined ? [`temperature = ${val(String(cfg.temperature))}`] : []),
      ...(cfg.seed !== undefined ? [`seed = ${val(String(cfg.seed))}`] : []),
      ...(cfg.stop ? [`stop = list(${cfg.stop.map(q).join(', ')})`] : []),
    ];
    return `req <- ${api('request')}(
  ${q(model)},
  list(${api('message_user')}(${q(genText(question))})),
  system = ${q(genSystem(question))},
  config = ${api('config')}(${args.join(', ')})
)`;
  },
  genShow: () => `router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
${api('response_text')}(response)
response$finish_reason`,
  genTemperature: model => `router <- ${api('new_router')}()
for (temperature in c(${val('0')}, ${val('1')})) {
  for (run in 1:2) {
    req <- ${api('request')}(
      ${q(model)},
      list(${api('message_user')}(${q(TOUR.prompt)})),
      system = ${q(TOUR.system)},
      config = ${api('config')}(temperature = temperature)
    )
    cat(temperature, ${api('response_text')}(${api('complete')}(router, req)), "\\n")
  }
}`,
  genAdapt: () => `router <- ${api('new_router')}()
response <- ${api('complete')}(router, req)
${api('response_text')}(response)
for (a in response$${api('adaptations')}) cat(a$field, a$action, "\\n")`,
  genPlan: () => `for (a in ${api('plan')}(router, req)) cat(a$field, a$action, "\\n")`,
  genRefuse: () => `strict <- ${api('new_router')}(adaptations = ${q('refuse')})
tryCatch(
  ${api('response_text')}(${api('complete')}(strict, req)),
  ${api('UnsupportedFeatureError')} = function(error) {
    cat("Refused:", error$feature, "\\n")
  }
)`,
  errCatch: () => `router <- ${api('new_router')}()
tryCatch(
  ${api('response_text')}(${api('complete')}(router, req)),
  ${api('UnsupportedModelError')} = function(error) {
    cat("No such model at", error$provider, "\\n")
    cat(conditionMessage(error), "\\n")
  }
)`,
  errRetry: () => `complete_with_retries <- function(router, req, attempts = 4) {
  for (attempt in seq_len(attempts)) {
    result <- tryCatch(${api('complete')}(router, req), ${api('LM15Error')} = identity)
    if (!inherits(result, "LM15Error")) return(result)
    if (!${api('retryable')}(result) || attempt == attempts) stop(result)
    wait <- result$${api('retry_after')} %||% 2^attempt
    cat(class(result)[[1]], ", waiting ", wait, " s\\n", sep = "")
    Sys.sleep(wait)
  }
}`,
  errUse: () => `router <- ${api('new_router')}()
response <- complete_with_retries(router, req)
${api('response_text')}(response)`,
  convStart: model => `router <- ${api('new_router')}()
messages <- list(${api('message_user')}(${q(TOUR.prompt)}))
response <- ${api('complete')}(router, ${api('request')}(
  ${q(model)},
  messages,
  system = ${q(TOUR.system)}
))
messages <- c(messages, list(response$message))
${api('response_text')}(response)`,
  convParts: () => `vapply(response$message$parts, function(part) part$type, "")`,
  convLoop: model => `router <- ${api('new_router')}()
model <- ${q(model)}
instructions <- ${q(TOUR.system)}
messages <- list()
for (question in c(
${V.questions.map((x, i) => `  ${q(x)}${i < V.questions.length - 1 ? ',' : ''}`).join('\n')}
)) {
  messages <- c(messages, list(${api('message_user')}(question)))
  req <- ${api('request')}(model, messages, system = instructions)
  response <- ${api('complete')}(router, req)
  messages <- c(messages, list(response$message))
  cat(">", question, "\\n")
  cat(${api('response_text')}(response), "\\n")
  cat(response$usage$input_tokens, "tokens in\\n")
}`,
  convSave: () => `saved <- ${api('request')}(model, messages, system = instructions)
writeLines(${api('as_json')}(saved), ${FILE()})`,
  convLoad: () => `json <- paste(readLines(${FILE()}), collapse = "\\n")
saved <- ${api('from_json')}(json, "request")
followup <- ${api('request')}(
  saved$model,
  c(saved$messages, list(${api('message_user')}(${q(V.nextDay)}))),
  system = saved$system
)
router <- ${api('new_router')}()
${api('response_text')}(${api('complete')}(router, followup))`,
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
  connQuestion: () => `question = ${q(TOUR.prompt)}`,
  connLoop: models => `router = ${api('LMRouter')}()
for model in [
${models.map(m => `    ${q(m)},`).join('\n')}
]
    req = ${api('Request')}(
        model,
        ${api('user')}(question);
        system=${q(TOUR.system)},
    )
    println(model, " -> ", ${api('text')}(${api('complete')}(router, req)))
end`,
  connKeyRouter: provider => `router = ${api('LMRouter')}(${api('RouterConfig')}(
    api_keys=Dict(${q(provider)} => ENV[${q(C.keyVariable)}]),
))`,
  connUrlRouter: (server, url) => `router = ${api('LMRouter')}(${api('RouterConfig')}(
    base_urls=Dict(${q(server)} => ${q(url)}),
))`,
  mediaAsk: (model, which) => {
    const m = MEDIA[which], name = which === 'photo' ? 'photo' : 'logbook', fn = which === 'photo' ? 'image' : 'document';
    const line = `${name} = ${api(fn)}(path=${q(m.file)}, media_type=${q(m.mediaType)})`;
    const part = plain(line).length <= WIDTH ? line : `${name} = ${api(fn)}(
    path=${q(m.file)}, media_type=${q(m.mediaType)},
)`;
    return `${part}
req = ${api('Request')}(
    ${q(model)},
    ${api('user')}([
        ${q(m.question)},
        ${name},
    ]);
    system=${q(TOUR.system)},
)
router = ${api('LMRouter')}()
response = ${api('complete')}(router, req)
println(${api('text')}(response))
println(response.usage.input_tokens, " tokens in")`;
  },
  genRequest: (model, question, cfg) => {
    const args = [
      ...(cfg.maxTokens !== undefined ? [`max_tokens=${val(String(cfg.maxTokens))}`] : []),
      ...(cfg.temperature !== undefined ? [`temperature=${val(float(cfg.temperature))}`] : []),
      ...(cfg.seed !== undefined ? [`seed=${val(String(cfg.seed))}`] : []),
      ...(cfg.stop ? [`stop=[${cfg.stop.map(q).join(', ')}]`] : []),
    ];
    return `req = ${api('Request')}(
    ${q(model)},
    ${api('user')}(${q(genText(question))});
    system=${q(genSystem(question))},
    config=${api('Config')}(${args.join(', ')}),
)`;
  },
  genShow: () => `router = ${api('LMRouter')}()
response = ${api('complete')}(router, req)
println(${api('text')}(response))
println(response.finish_reason)`,
  genTemperature: model => `router = ${api('LMRouter')}()
for temperature in (${val('0.0')}, ${val('1.0')}), run in 1:2
    req = ${api('Request')}(
        ${q(model)},
        ${api('user')}(${q(TOUR.prompt)});
        system=${q(TOUR.system)},
        config=${api('Config')}(; temperature),
    )
    println(temperature, " ", ${api('text')}(${api('complete')}(router, req)))
end`,
  genAdapt: () => `router = ${api('LMRouter')}()
response = ${api('complete')}(router, req)
println(${api('text')}(response))
for a in response.${api('adaptations')}
    println(a.field, " ", a.action)
end`,
  genPlan: () => `for a in ${api('plan')}(router, req)
    println(a.field, " ", a.action)
end`,
  genRefuse: () => `strict = ${api('LMRouter')}(${api('RouterConfig')}(adaptations=${q('refuse')}))
try
    println(${api('text')}(${api('complete')}(strict, req)))
catch error
    error isa ${api('UnsupportedFeatureError')} || rethrow()
    println("Refused: ", error.feature)
end`,
  errCatch: () => `router = ${api('LMRouter')}()
try
    println(${api('text')}(${api('complete')}(router, req)))
catch error
    error isa ${api('UnsupportedModelError')} || rethrow()
    println("No such model at ", error.provider)
    println(error)
end`,
  errRetry: () => `function complete_with_retries(router, req; attempts=4)
    for attempt in 1:attempts
        try
            return ${api('complete')}(router, req)
        catch error
            (${api('retryable')}(error) && attempt < attempts) || rethrow()
            wait = something(error.${api('retry_after')}, 2.0^attempt)
            println(nameof(typeof(error)), ", waiting ", wait, " s")
            sleep(wait)
        end
    end
end`,
  errUse: () => `router = ${api('LMRouter')}()
response = complete_with_retries(router, req)
println(${api('text')}(response))`,
  convStart: model => `router = ${api('LMRouter')}()
messages = [${api('user')}(${q(TOUR.prompt)})]
response = ${api('complete')}(router, ${api('Request')}(
    ${q(model)};
    messages,
    system=${q(TOUR.system)},
))
push!(messages, response.message)
println(${api('text')}(response))`,
  convParts: () => `for part in response.message.parts
    println(part.type)
end`,
  convLoop: model => `router = ${api('LMRouter')}()
model = ${q(model)}
instructions = ${q(TOUR.system)}
messages = ${api('Message')}[]
for question in [
${V.questions.map(x => `    ${q(x)},`).join('\n')}
]
    push!(messages, ${api('user')}(question))
    req = ${api('Request')}(model; messages, system=instructions)
    response = ${api('complete')}(router, req)
    push!(messages, response.message)
    println("> ", question)
    println(${api('text')}(response))
    println(response.usage.input_tokens, " tokens in")
end`,
  convSave: () => `saved = ${api('Request')}(model; messages, system=instructions)
write(${FILE()}, ${api('to_json')}(saved))`,
  convLoad: () => `saved = ${api('from_json')}(${api('Request')}, read(${FILE()}, String))
followup = ${api('Request')}(
    saved.model;
    messages=[saved.messages..., ${api('user')}(${q(V.nextDay)})],
    system=saved.system,
)
router = ${api('LMRouter')}()
println(${api('text')}(${api('complete')}(router, followup)))`,
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
    connQuestion: () => f(w.connQuestion()),
    connLoop: models => f(w.connLoop(models)),
    connKeyRouter: provider => f(w.connKeyRouter(provider)),
    connUrlRouter: (server, url) => f(w.connUrlRouter(server, url)),
    mediaAsk: (model, which) => f(w.mediaAsk(model, which)),
    genRequest: (model, question, cfg) => f(w.genRequest(model, question, cfg)),
    genShow: () => f(w.genShow()),
    genTemperature: model => f(w.genTemperature(model)),
    genAdapt: () => f(w.genAdapt()),
    genPlan: () => f(w.genPlan()),
    genRefuse: () => f(w.genRefuse()),
    errCatch: () => f(w.errCatch()),
    errRetry: () => f(w.errRetry()),
    errUse: () => f(w.errUse()),
    convStart: model => f(w.convStart(model)),
    convParts: () => f(w.convParts()),
    convLoop: model => f(w.convLoop(model)),
    convSave: () => f(w.convSave()),
    convLoad: () => f(w.convLoad()),
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
    case 'conn-switch': return `${w.connQuestion()}\n\n${w.connLoop(C.models)}`;
    case 'conn-key': return connKey(w, model);
    case 'conn-local': return `${w.request(C.localModel, partsOf('request'))}\n\n${w.ask()}`;
    case 'conn-custom': return connCustom(w, C.serverUrl);
    case 'media-photo': return w.mediaAsk(model, 'photo');
    case 'media-log': return w.mediaAsk(model, 'log');
    case 'gen-short': return `${w.genRequest(model, 'prompt', { maxTokens: G.shortLimit })}\n\n${w.genShow()}`;
    case 'gen-temperature': return w.genTemperature(model);
    case 'gen-stop': return `${w.genRequest(model, 'list', { stop: [G.stop] })}\n\n${w.genShow()}`;
    case 'gen-adapt': return `${w.genRequest(model, 'prompt', { temperature: G.hot, seed: G.seed })}\n\n${w.genAdapt()}`;
    case 'gen-plan': return w.genPlan();
    case 'gen-refuse': return w.genRefuse();
    case 'err-catch': return errCatch(w, model);
    case 'err-retry': return w.errRetry();
    case 'err-use': return w.errUse();
    case 'conv-start': return w.convStart(model);
    case 'conv-parts': return w.convParts();
    case 'conv-loop': return w.convLoop(model);
    case 'conv-save': return w.convSave();
    case 'conv-load': return w.convLoad();
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

/** A router with an explicit key, then the reader's request, sent. */
function connKey(w: Writer, model: string): string {
  return `${w.connKeyRouter(model.split(':')[0]!)}\n\n${w.request(model, partsOf('request'))}\n${call(w)}`;
}
/** A router pointed at your own server, then a request for a model it serves. */
function connCustom(w: Writer, url: string): string {
  return `${w.connUrlRouter(C.server, url)}\n\n${w.request(C.serverModel, partsOf('request'))}\n${call(w)}`;
}
/** The errors page's model: the reader's provider, and a model it does not have. */
export const MISSING_MODEL = 'no-such-model';
/** The request, for a model the provider does not have, sent and its refusal caught. */
function errCatch(w: Writer, model: string): string {
  return `${w.request(`${model.split(':')[0]}:${MISSING_MODEL}`, partsOf('request'))}\n\n${w.errCatch()}`;
}
/** The retry function, the request (for `model`), and the call. */
function errRetryProgram(w: Writer, model: string): string {
  return `${w.errRetry()}\n\n${w.request(model, partsOf('system'))}\n\n${w.errUse()}`;
}
/** Whole programs for the media page, for a real provider: what the capture script runs. */
export function mediaPrograms(language: Language, provider: string, model: string): Record<MediaKind, string> {
  const w = WRITERS[language];
  const program = (which: MediaKind) => done(w.program(w.mediaAsk(`${provider}:${model}`, which), { tool: false, config: false, stream: false, media: which })).text;
  return { photo: program('photo'), log: program('log') };
}

/** Whole programs for the generation page, for a real provider: what the capture script runs. */
export function generationPrograms(language: Language, provider: string, model: string): Record<string, string> {
  const w = WRITERS[language];
  const id = `${provider}:${model}`;
  // Only the program that refuses needs the refusal's names.
  const program = (body: string, refuses = false) => done(w.program(body, { tool: false, config: true, stream: false, generation: refuses })).text;
  return {
    short: program(`${w.genRequest(id, 'prompt', { maxTokens: G.shortLimit })}\n\n${w.genShow()}`),
    temperature: program(w.genTemperature(id)),
    stop: program(`${w.genRequest(id, 'list', { stop: [G.stop] })}\n\n${w.genShow()}`),
    adapt: program(`${w.genRequest(id, 'prompt', { temperature: G.hot, seed: G.seed })}\n\n${w.genAdapt()}\n\n${w.genPlan()}\n\n${w.genRefuse()}`, true),
  };
}

/** Whole programs for the errors page, for a real provider: what the capture script runs. */
export function errorPrograms(language: Language, provider: string, model: string): { catch: string; retry: string } {
  const w = WRITERS[language];
  const plainUses = { tool: false, config: false, stream: false };
  return {
    catch: done(w.program(errCatch(w, `${provider}:${model}`), { ...plainUses, errors: 'catch' })).text,
    retry: done(w.program(errRetryProgram(w, `${provider}:${model}`), { ...plainUses, errors: 'retry' })).text,
  };
}

/** `ask` without the line that makes a router (the router already exists). */
const call = (w: Writer) => w.ask().split('\n').slice(1).join('\n');

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
  /** The stand-in answers "no such model" (404), as Ollama does for a model it has not pulled. */
  notFound?: boolean;
  /** The stand-in answers the first request with a rate limit (429, Retry-After: 0), then normally. */
  rateLimitedFirst?: boolean;
  /** Files the program reads, copied from public/docs-media into its folder before it runs. */
  files?: string[];
  /** The program must be refused before anything is sent: it fails, sends nothing, and says this. */
  refuses?: RegExp;
}

/** Where the run test's stand-in server listens (scripts/docs-fixture-server.py). */
const STAND_IN = 'http://127.0.0.1:11434/v1';
/** What the stand-in answers (scripts/docs-fixture-server.py). */
const STAND_IN_REPLY = 'Probably wood mice.';
/** A model the stand-in rate-limits once before answering (scripts/docs-fixture-server.py). */
const BUSY_MODEL = 'busy-model';

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
  // The connect page: the loop (over stand-in models), an explicit key, a local model, a server at an address.
  const plainUses = { tool: false, config: false, stream: false };
  const connect: TourProgram[] = [
    { name: 'conn-switch', source: done(w.program(`${w.connQuestion()}\n\n${w.connLoop([id, id])}`, plainUses)).text, streams: false, requests: 2 },
    { name: 'conn-key', source: done(w.program(connKey(w, id), { ...plainUses, env: true, routerConfig: true })).text, streams: false },
    { name: 'conn-local', source: done(w.program(`${w.request(C.localModel, partsOf('request'))}\n\n${w.ask()}`, plainUses)).text, streams: false },
    { name: 'conn-custom', source: done(w.program(connCustom(w, STAND_IN), { ...plainUses, routerConfig: true })).text, streams: false },
  ];
  // The conversation page: the first turn and its parts; three turns, saved, read back and continued.
  // The next day's code runs in its own block in TypeScript and Go, as it would in its own program.
  const scoped = (code: string) => language === 'typescript' ? `{\n${indent(code, '  ')}\n}` : language === 'go' ? `{\n${indent(code, '    ')}\n}` : code;
  const conversation: TourProgram[] = [
    { name: 'conv-start', source: done(w.program(`${w.convStart(id)}\n\n${w.convParts()}`, plainUses)).text, streams: false, expect: [STAND_IN_REPLY, 'text'] },
    { name: 'conv-save', source: done(w.program(`${w.convLoop(id)}\n\n${w.convSave()}\n\n${scoped(w.convLoad())}`, { ...plainUses, serde: true })).text, streams: false, requests: 4 },
  ];
  // The errors page: "no such model" caught; a rate limit, waited out and retried.
  const errorsPage: TourProgram[] = [
    { name: 'err-catch', source: errorPrograms(language, provider, model).catch, streams: false, notFound: true, expect: [`No such model at ${provider}`] },
    { name: 'err-retry', source: done(w.program(errRetryProgram(w, `${provider}:${BUSY_MODEL}`), { ...plainUses, errors: 'retry' })).text, streams: false, rateLimitedFirst: true, requests: 2, expect: ['RateLimitError, waiting', STAND_IN_REPLY] },
  ];
  // The generation page: a length limit, temperature, a stop sequence; adaptations, their preview, and refusing them.
  const gen = generationPrograms(language, provider, model);
  const generationPage: TourProgram[] = [
    { name: 'gen-short', source: gen.short!, streams: false, expect: [STAND_IN_REPLY, 'stop'] },
    { name: 'gen-temperature', source: gen.temperature!, streams: false, requests: 4 },
    { name: 'gen-stop', source: gen.stop!, streams: false },
    { name: 'gen-adapt', source: gen.adapt!, streams: false, requests: 2 },
  ];
  // The media page: a photo, which every wire carries; a PDF, which the Chat Completions wire
  // (the stand-in speaks it) has no slot for, so every language must refuse it before sending.
  const media = mediaPrograms(language, provider, model);
  const mediaPage: TourProgram[] = [
    { name: 'media-photo', source: media.photo, streams: false, files: [MEDIA.photo.file] },
    { name: 'media-log', source: media.log, streams: false, files: [MEDIA.log.file], requests: 0, refuses: /document/i },
  ];
  return [{ name: 'first', source: done(firstProgram(w, id)).text, streams: false }, ...complete, { name: 'program', source: done(streamProgram(w, id)).text, streams: true }, ...followUps, ...toolPrograms, ...structured, ...connect, ...conversation, ...errorsPage, ...generationPage, ...mediaPage];
}
