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
- `credentials.ts`: temporary keys and optional encrypted browser storage.
- `runtimes/`: JavaScript, Python, and Rust execution in the browser.
- `../../scripts/build-playground.mjs`: packages only public assets.
- `../../tests/`: interface, example, runtime, and published-file checks.

The installed `lm15` runtime package contains pinned SDK builds. Ordinary page
edits do not build Python or Rust. Heavy runtimes download only when selected.

## Interface

The main workspace contains a key field, request settings, chat, and three code
tabs. Provider and model buttons sit beside Send. JavaScript / Python / Rust
select both the displayed code and the SDK that executes the next message;
there is no separate execution selector, JSON/curl tab, or New chat button.
Selecting Python or Rust loads that runtime on demand. Tabs are locked during
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

`npm test` checks 66 generated request variants per SDK, including the teaching
conversation with no token cap. `npm run rust:snippets` updates the standalone
Rust example project; from `examples/rust`, `rcargo check --locked` verifies its
55 snippets without running provider requests.

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
