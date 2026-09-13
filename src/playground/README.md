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

The main workspace contains provider/model selection, a key field, request
settings, chat, execution language, and the code preview. Desktop keeps the
settings and code together; narrow screens retain Settings / Chat / Code views.
There are no welcome cards, example prompts, duplicate setup buttons, reset
buttons, line numbers, filename labels, or keyboard-hint strips.

**More** contains model discovery, loaded-key management, documentation, source,
and privacy/license links. It closes with Escape, a click outside, or focus
leaving the menu. The short storage notice stays next to the key, and the cost
warning stays next to Send. Missing-key and key-save errors appear at the key
field without discarding the draft.

Temperature is optional: clear the number to use the provider default; `0` is
an explicit value. Invalid numbers are shown as errors and cannot be sent.
Code wraps visually without changing copied source. Viewing another code
language does not change the execution language. Loading and failure messages
remain; successful runtime loading leaves no technical status paragraph.

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
