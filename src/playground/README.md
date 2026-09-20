# Playground

The playground belongs to the website. Its SDKs remain in their own repositories.

From the website root:

```sh
npm ci
npm run dev
```

Open `/playground/` in the local preview. Push to `main` to publish changes to
https://lm15.dev/playground/ after the build and link checks pass.

## Files

- `index.html`, `app.css`: the standalone interface.
- `../styles/theme.css`: shared brand colors for the whole website.
- `main.ts`, `picker.ts`, `code-view.ts`: interaction and code display.
- `experience.ts`, `connections.ts`: provider choices, requests, and examples.
- `judge.ts`, `judge-ui.ts`: Judge mode — the question set, the inputs, one
  request per input, the four languages, the results table.
- `credentials.ts`: temporary keys and optional encrypted browser storage.
- `runtimes/`: JavaScript, Python, Rust, and Go execution in the browser.
- `../../scripts/build-playground.mjs`: packages only public assets.
- `../../tests/`: interface, example, runtime, and published-file checks.

The installed `lm15` runtime package contains pinned SDK builds. Ordinary page
edits do not build Python, Rust, or Go. Heavy runtimes download only when selected.

## Interface

The page has two modes, **Chat** and **Judge**, sharing the connection controls
and language tabs. Chat starts on OpenAI; Judge starts on TypeSafe's
`jev-latest`. Each mode keeps its own provider/model selection while the page
is open, so switching back does not overwrite a deliberate choice. Reloading
restores the remembered mode and its default provider; connection selections
are not persisted. The key card and the code panel are single
elements that move between the two layouts.

The chat workspace contains a key field, request settings, chat, and four code
tabs. Provider and model buttons sit beside Send. JavaScript / Python / Rust / Go
select both the displayed code and the SDK that executes the next message;
there is no separate execution selector or New chat button. **Code | Request**
in the panel's corner switches between the program and the request that program
puts on the wire — method, URL, headers and body, built by the selected
runtime's own SDK (`Runtime.wire`) for the current turn or the selected Judge
input, never sent, the key blanked. Python builds it from the shown program's
head (a judge loop unrolled once); Rust and Go use canonical requests with their own SDKs.
Selecting Python, Rust, or Go loads that runtime on demand. Tabs are locked during
a running turn so execution cannot silently change.

Desktop keeps settings and code together; narrow screens retain Settings /
Chat / Code views. There are no welcome cards, duplicate setup buttons, reset
buttons, line numbers, filename labels, or keyboard-hint strips.

**More** contains model discovery, loaded-key management, documentation, source,
and privacy/license links. It closes with Escape, a click outside, or focus
leaving the menu. The short storage notice stays next to the key, and the cost
warning stays next to Send. Missing-key and key-save errors appear at the key
field without discarding the draft.

Temperature and max tokens are optional: clear a number to leave it unset.
Zero temperature is an explicit value; zero max tokens is invalid. An empty
max-token field means no limit supplied by the playground, not unlimited output:
individual SDK adapters/providers may supply a default or require a limit.
Invalid numbers cannot be sent. Code wraps visually without changing copied
source. Loading and failure messages remain; successful loading leaves no
technical status paragraph.

## Judge mode

Judge applies one question set to many inputs, one call per input (MAP-14:
declared keys in, a distribution out). The question set is the JSON Schema
`properties` object that `judgments({...})` takes; the form on the left is a
view over it, reading with the SDK's `judgmentsInSchema` and writing with its
`choice`, `yesNo` and `score`. **{ } JSON** edits the same object directly; a
property the form cannot show is kept verbatim and named.

Inputs have a shape: **Text** (one string each), **Fields** (one JSON object
each, sent as a data part — Jev reads it as structured state; a chat wire
gets it as JSON text) or **Conversation** (one transcript each). Each shape
keeps its own inputs. A question can point at a piece of a structured input
with backticks; the hint above the questions names the path. The code panel
is the whole set as one loop, in the SDK's own spelling; Python executes that
program with one input, the loop body unchanged (`judgeProgram`, given the
spec and input it was built from).

The example set starts with no instructions, so the default request is the
docs' quick start: a string state and the questions, nothing else. On Jev the
state is the one user part, verbatim (contract 2026-09-19-jev-state, D1): Jev
has no system prompt and no conversation, so when instructions are added the
page writes what a caller would — the instructions as the state key
`instructions` (a bare text goes beside it as `text`), a transcript as the
state's `messages` array — and the shown code does exactly that
(`jevState`). A field named `instructions` is refused by name. On a chat
wire the instructions are the system prompt and the turns are the
conversation.

Every provider judges: TypeSafe measures the probability of every declared
key and the outputs draw the distribution (a sparkline per question; hover or
tap for the numbers); a chat wire answers the pick and the row records
`config.probabilities dropped`. Z.AI's wire takes no schema at all: the row
says the questions never reached the model. All four SDKs execute Judge using
complete, never a simulated TypeSafe stream. The custom OpenAI-chat connection
uses the default compatibility capabilities; it does not claim token-trie scoring.

The run is sequential (the shown loop), stops at the first failure with the
input named, offers the relay on a browser-blocked provider and resumes
through it, and judges only inputs that changed since their last verdict.
The set, its verdicts and the chosen mode are remembered on the device
(`lm15.playground.judge`, `lm15.playground.mode`); nothing is written until
the person changes something. **Export CSV** writes one column per declared
key only when something was measured; **Export JSON** is the verdicts as the
SDK returned them.

TypeSafe answers judgments only: choosing it from Chat opens Judge. The Chat
button remains available and restores the previous chat provider rather than
trying to chat with Jev. The former **Ask for judgments** switch in
Chat is gone; judgments are Judge mode.

## Error diagnostics

The JavaScript runtime uses the SDK's error formatter, not just its message,
so request IDs, retry advice and rate-limit headers remain visible. Python
exception translation removes traceback frames but keeps the complete multiline
error message. The page redacts remembered/in-memory credentials after formatting.
A provider that does not expose diagnostic headers through CORS leaves them absent;
the page does not switch endpoints or retry to obtain them. Rust receives all
CORS-visible response headers, and Rust/Go retain their SDK's typed diagnostics.

`tests/error_diagnostics_page.test.ts` checks all four actual runtimes in the
page, for both HTTP 429 and an error inside HTTP 200 SSE.
It uses dummy credentials and intercepted requests only; `SITE_URL` can select
the live deployment for the same test without sending real inference requests.

Node-hosted Pyodide leaves interpreter handles alive after assertions finish.
The unit/integration commands use Node's `--test-force-exit` after test completion;
it does not skip test failures. Browser tests exit normally. Runtime comparisons
use parsed JSON equality as well as body-byte equality: Go serializes maps with
sorted keys, which can produce equivalent requests with different bytes.

## Teaching example

The initial conversation asks what LM15 is, includes one short answer, and has
a follow-up ready in the composer. The system prompt sets an LM15 teacher role.
These are labeled example turns, not replies fetched from a provider. Changing
provider/model or keys starts a fresh conversation with that same example;
language changes preserve the conversation. No inference is performed on arrival.

The joke API key is a visible placeholder and appears in copyable code, but is
never stored or accepted as a real key. Saving a real key does not erase the
teaching example. Plain text turns use short Message constructors in the code;
messages with metadata or continuation state retain the full canonical replay.

Example tests cover provider variants and the teaching conversation without a
token cap. `npm run rust:snippets` updates the standalone Rust example project,
including Judge and DataPart examples; from `examples/rust`, `rcargo check --locked`
verifies them without provider requests. `tests/go_examples_compile.test.ts` separately compiles
Go examples using the Go toolchain and the sibling `../lm15-go` checkout (no main
function is invoked). Go examples are standalone programs using canonical JSON
through the SDK's request decoder. Browser tests intercept inference
requests with fake replies; no real provider keys or paid calls are needed.

## Private local keys

After building the site, `npm run playground:local` opens a separate loopback
server with an explicit, one-use handoff from `../.env`. Ordinary previews and
the public site never read that file. Keys are never printed or placed in the
code panel. Browser storage is not a secure vault: scripts on the same origin
can access keys when the page uses them.

Provider calls go directly from the browser and may cost money. Some providers
block browser calls. The playground does not silently switch languages or use
a proxy when a call fails.

Historical implementation notes are preserved in
`../../planning/previous-playground-notes.md`; their old paths are historical.
