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
- `marks.ts`: how the code panel knows what to colour. A generator marks the
  person's values, LM15's calls, comments and plumbing as it writes; `finish`
  yields a `Code` (exact text plus ranges). Nothing re-parses the text, so Go
  and Judge get the same colouring as JavaScript. `code-view.ts` renders one
  block per line with a hanging indent, keeping `textContent` byte-exact for
  Copy.
- `picker.ts`: the provider / model / command list. A provider's row carries
  its key: masked with Forget once one is saved, a field to paste one until
  then, the address for the custom server.
- `story.ts`: the chat program the panel shows — the conversation as a
  person writes it. The transcript is a variable that grows; one `ask` helper
  sends a message, prints the stream and keeps `response.message`; each turn
  that was sent is an `ask(...)` call with the model's answer echoed beneath
  as a comment. Hand-written turns (the teaching example, a reply rewritten
  by hand) are literals, since no call produced them. What the runtimes
  execute is the snapshot in `experience.ts` — the same setup with the
  transcript restored and one call — because re-running the story would ask
  the model again at every turn. The Request view is the snapshot's bytes.
- `experience.ts`, `connections.ts`: provider choices, requests, the snapshot
  programs (executed) and the shared spellings both forms use.
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
are not persisted. The code panel is a single element that moves between the
two layouts.

The chat workspace is two columns: the conversation and the code. There is no
settings column. The system prompt heads the conversation as an editable block;
temperature, max tokens and reasoning effort sit in the composer under the
message; provider and model buttons sit beside Send. Both textareas grow with
their text (no drag handle). **Hide** in the code panel's corner folds it to a
strip so the conversation takes the width; the choice is remembered
(`lm15.playground.code`). JavaScript / Python / Rust / Go
select both the displayed code and the SDK that executes the next message;
there is no separate execution selector or New chat button. **Code | Request**
in the panel's corner switches between the program and the request that program
puts on the wire — method, URL, headers and body, built by the selected
runtime's own SDK (`Runtime.wire`) for the current turn or the selected Judge
input, never sent, the key blanked. Python builds it from the shown program's
head (a judge loop unrolled once); Rust and Go use canonical requests with their own SDKs.
Selecting Python, Rust, or Go loads that runtime on demand. While it loads, a card
over the dimmed code says the phase (downloading, starting, installing) with a
progress bar measured against `vendor/sizes.json`, the real byte sizes the build
writes (the wire is gzipped, so Content-Length would overshoot); Send and Run all
read "Loading Python…". A failure turns the card into the reason and a Retry.
Python's two big files are downloaded once with progress and handed to Pyodide
(`stdLibURL`, and its wasm URL answered from the bytes for the length of the
boot), so nothing is fetched twice and nothing depends on the HTTP cache. The
loaders yield two frames before compiling a module so the card paints first; the
spinner is a compositor animation, so it keeps turning while the main thread is
busy. Tabs are locked during a running turn so execution cannot silently change.

Narrow screens show one panel at a time with a Chat / Code switch (Questions /
Results / Code in Judge); the Hide toggle steps aside there. There are no
welcome cards, duplicate setup buttons, reset buttons, line numbers, filename
labels, keyboard-hint strips, or cost warnings.

Keys live in the provider list. Each row shows the provider's name and, at its
right, the key: a field to paste one (with a link to the provider's key page),
or, once saved, a mask and a warm-coloured **Forget**. Pasting or pressing Enter
saves the key and makes that provider the current one; the list stays open.
A checkbox under the list, *Remember keys on this device (encrypted)*, applies
to keys pasted after it is ticked. Sending without a key opens the list on the
current provider's field with the reason in red; the draft is kept. The example
key is refused there in the same way.

**More** contains model discovery, key management (which providers have a key,
the storage notice, Forget all), relay status, documentation, source, and
privacy/license links. It closes with Escape, a click outside, or focus
leaving the menu.

Hovering or focusing a control on the left lights the value it produced in the
code; hovering a value in the code lights its control on the left, and scrolls
it into view. An unset sampling field (temperature, max tokens, reasoning
effort) is drawn into the code while its field is touched, dimmed, as the
language's own "unset" (`undefined`, `None`, `None`, `nil`), so its place is
visible; it leaves with the pointer.

Temperature and max tokens are optional: clear a number to leave it unset.
Zero temperature is an explicit value; zero max tokens is invalid. An empty
max-token field means no limit supplied by the playground, not unlimited output:
individual SDK adapters/providers may supply a default or require a limit.
Invalid numbers cannot be sent. Code wraps visually without changing copied
source. Loading and failure messages remain; successful loading leaves no
technical status paragraph.

## Judge mode

Judge asks one question set about one state, in one call (MAP-14: declared
keys in, a distribution out). The layout is the chat's: on the left the
**State** (a Text / Fields / Conversation switch on its header; a text box, a
JSON object, or a transcript of turns) above the **Questions**; on the right
the code for that one call. **Judge** beside the provider and model chips makes
the call; the **Result** then appears under the questions — the pick per
question with a sparkline where the provider measured a distribution (hover or
tap for the numbers), or the JSON — and the answer is echoed under the program
as `// →` comments. Editing the state or a question after a call greys the
result and takes the echo out of the code until the next call. Hovering the
state, a question or the result lights its code, and the other way round.

The question set is the JSON Schema `properties` object that
`judgments({...})` takes; the form is a view over it, reading with the SDK's
`judgmentsInSchema` and writing with its `choice`, `yesNo` and `score`.
**{ } JSON** edits the same object directly; a property the form cannot show
is kept verbatim and named. The example is two questions over one field
note from the docs' wildlife station — `id_certainty`, a scale, and
`juvenile_present`, a yes/no; nothing is pre-run.

On Jev the state is the one user part, verbatim (contract 2026-09-19-jev-state,
D1): a text as a string, an object as structured state, a transcript as the
state's `messages` array — and the shown code does exactly that. There is no
instructions box: Jev has no system prompt, and the state is the whole input.
A question can point at a piece of a structured state with backticks; the hint
under the state names the path. On a chat wire the same set goes as the
system-less request with the text, the data part, or the turns as messages;
it answers the pick and the result records `config.probabilities dropped`.
Z.AI's wire takes no schema at all: the result says the questions never
reached the model. All four SDKs execute Judge using `complete`, never a
simulated stream.

The state and the questions are remembered on the device
(`lm15.playground.judge`); a result never is. Reset restores the example.
TypeSafe answers judgments only: choosing it from Chat opens Judge. The Chat
button restores the previous chat provider rather than trying to chat with Jev.

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
These are labeled example turns, not replies fetched from a provider. Every
turn in the transcript — example, yours, or a reply — is a textarea and can be
rewritten; the next request is built from what the transcript says now. A
rewritten reply keeps anything it carried besides its text (reasoning,
continuation state) and, having no call behind it any more, is spelled out in
the story as a literal (`story.ts`). An emptied turn blocks sending and says so in the code
panel until it has text again. Turns are not copyable as a separate action: the
code panel's Copy is the copy. A streaming or failed turn is read-only; a failed
pair is greyed and not part of the next request. Changing provider, model, keys
or language keeps the conversation: the same transcript goes to whatever is
selected next. **Reset**, beside More, is the one way to start over — the
example conversation, the default system prompt and sampling, the example
draft; the connection and keys stay. No inference is performed on arrival.

The joke API key is a visible placeholder and appears in copyable code, but is
never stored or accepted as a real key. Saving a real key does not erase the
teaching example. Plain text turns use short Message constructors in the code. A
model's reply is never source: it is echoed under its `ask` as a comment and
carried by `response.message`. A hand-written reply that carries hidden
reasoning or replay state (an OpenAI reasoning item, an Anthropic signature, a
Gemini thought signature) is spelled with the SDK's own part constructors — `thinking("", { continuation: continuationState(...) })`
and its Python, Rust and Go equivalents — so the reader sees the shape rather
than a JSON blob. Only what those cannot express (tool calls, media, numbers in
an opaque payload, state on the message itself) keeps the canonical JSON replay.

Example tests cover provider variants and the teaching conversation without a
token cap. `npm run rust:snippets` updates the standalone Rust example project,
including Judge and DataPart examples; from `examples/rust`, `rcargo check --locked`
verifies them without provider requests; the story programs are among them. `tests/go_examples_compile.test.ts`
separately compiles every Go program against the Go toolchain and the sibling `../lm15-go`
checkout — the stories compile only; the snapshots also run with their provider call swapped
for a dump, and the request each built must equal the page's canonical request. All four languages show the
SDK's own constructors (`Message.user`, `judgments` / `score` / `choice` / `yes_no` and
their Go and Rust spellings); only a replayed reply the part constructors cannot
express is shown as its canonical JSON, in every language. Browser tests intercept inference
requests with fake replies; no real provider keys or paid calls are needed.

## Private local keys

After building the site, `npm run playground:local` opens a separate loopback
server with an explicit, one-use handoff from `../.env`. Ordinary previews and
the public site never read that file. `HOST=<address> PORT=<port> node
--experimental-strip-types scripts/serve-playground.ts` serves the same built
page on another interface (a Tailscale IP, to open it from another machine);
the key handoff is refused there — paste keys in the page. Keys are never printed or placed in the
code panel. Browser storage is not a secure vault: scripts on the same origin
can access keys when the page uses them.

Provider calls go directly from the browser and may cost money. Some providers
block browser calls. The playground does not silently switch languages or use
a proxy when a call fails.

Historical implementation notes are preserved in
`../../planning/previous-playground-notes.md`; their old paths are historical.
