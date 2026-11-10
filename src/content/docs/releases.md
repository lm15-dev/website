---
title: "Releases"
description: The current version of LM15 in each language, what each release contains, and how versions are numbered.
---

## Current versions

| Language | Version | Released | Package |
|---|---|---|---|
| Python | **2.3.0** (stable) | 2026-11-10 | [`lm15` on PyPI](https://pypi.org/project/lm15/) |
| TypeScript | **2.3.0** (stable) | 2026-11-10 | [`@lm15/lm15` on npm](https://www.npmjs.com/package/@lm15/lm15) |
| Rust | **2.3.0** (stable) | 2026-11-10 | [`lm15` on crates.io](https://crates.io/crates/lm15) |
| Go | **v2.3.0** (stable) | 2026-11-10 | [`github.com/lm15-dev/lm15-go/v2`](https://pkg.go.dev/github.com/lm15-dev/lm15-go/v2) |
| R | **2.3.0** (stable) | 2026-11-10 | [`lm15-dev/lm15-r` on GitHub](https://github.com/lm15-dev/lm15-r) (on its way to CRAN) |

The examples on this site are written for these versions, and the
[playground](/playground/) runs them.
Julia 2.3.0 (the package `LanguageModel15`) is in Julia's package registry
and still in development; see
[Language and runtime support](/compatibility/languages/).

## Version numbers

LM15 follows semantic versioning in every language. Within a major version,
the core — requests and responses, streaming, tools, structured output,
media inputs, reasoning, errors, credentials and model listing — keeps
working as documented. Provisional features (files, batches, media
generation, stored prompt caches, realtime sessions, reading OpenAI Chat
Completions requests, and account sign-in) may change within a major
version; such a change is announced in the release notes and in the
[contract's change log](https://github.com/lm15-dev/lm15-contract/tree/main/changes).

**The major version is the same in every language.** It counts the
generations of the [contract](https://github.com/lm15-dev/lm15-contract)
that every language is graded against: a change that can break programs
raises it in all of them together, so "LM15 2" means the same thing in
Python and in Go. The numbers after it are each language's own, because
each is released on its own schedule, and each release's notes name the
contract version it passes.

**Go writes the major version in the import path.** From version 2, Go
programs import `github.com/lm15-dev/lm15-go/v2`. Go's 1.x releases were
numbered from 1.1, because an early prototype was tagged `v1.0.0` by
mistake; Go's module mirror keeps every version forever, so that tag is
retracted.

## Release notes

### 2.3.0 in every language: Tinker — 2026-11-10

Python, TypeScript, Rust, R and Julia 2.3.0 and Go v2.3.0, released
together; each passes all 2,266 checks of contract `18b3788`. Nothing is
removed and no field changes meaning.

- **[Tinker (Thinking Machines)](/compatibility/providers/tinker/) is a
  provider.** `tinker` reaches Tinker's base models and the models you
  trained there, with one key; `tinker-anthropic` is the same service
  through the Anthropic Messages format. A model you trained is named by
  its path, `tinker://…`.
- **Thinking is switched the way each model family takes it**, and a model
  you trained follows the model it came from when you name that model.
- **Error messages from FastAPI servers are kept.** A server that answers
  an error as `{"detail": "…"}` used to produce an error with an empty
  message.
- **A stop sequence means the same everywhere.** Tinker returns the
  sequence it stopped at; LM15 removes it.
- **Rust only:** some settings types gained fields and options. A program
  that lists every field or every option of one of them needs the new
  ones; the Rust notes name them.
- Notes: [Python](https://github.com/lm15-dev/lm15-python/releases/tag/v2.3.0),
  [TypeScript](https://github.com/lm15-dev/lm15-ts/releases/tag/v2.3.0),
  [Rust](https://github.com/lm15-dev/lm15-rs/releases/tag/v2.3.0),
  [Go](https://github.com/lm15-dev/lm15-go/releases/tag/v2.3.0),
  [R](https://github.com/lm15-dev/lm15-r/releases/tag/v2.3.0).

### 2.2.0 in every language: Claude shows its thinking when asked — 2026-11-07

Each passes all 2,140 checks of contract `9d8e1ce`.

- **Asking Claude for a reasoning summary returns one.** Since Opus 4.7,
  Anthropic returns empty thinking unless the request asks to see it; on
  Opus 4.7, Opus 4.8 and every Claude 5 model, a summary asked through
  LM15 came back empty. LM15 now sends the setting whenever a summary is
  asked for. Without a summary nothing changes.
- Known, not changed: turning reasoning off does not stop Claude 5 from
  thinking.
- Notes: [Python](https://github.com/lm15-dev/lm15-python/releases/tag/v2.2.0),
  [TypeScript](https://github.com/lm15-dev/lm15-ts/releases/tag/v2.2.0),
  [Rust](https://github.com/lm15-dev/lm15-rs/releases/tag/v2.2.0),
  [Go](https://github.com/lm15-dev/lm15-go/releases/tag/v2.2.0),
  [R](https://github.com/lm15-dev/lm15-r/releases/tag/v2.2.0).

### 2.1.0 in every language: streams deliver everything, once — 2026-11-05

Each passes all 2,132 checks of contract `77f22f4`.

- **Parallel tool calls on the ChatGPT (Codex) subscription arrive with
  their inputs.** That service sends each call's arguments only in the
  call's final copy; LM15 read only the pieces and returned empty inputs.
  A stream's final copy now completes what its pieces did not deliver, and
  a piece that contradicts it is an error.
- **Gemini's parallel calls stay separate** when Gemini sends them one per
  chunk (Gemini 2.5 Pro, Gemini 3 Flash).
- A streamed reasoning summary keeps its line breaks, and an OpenAI stream
  cut short by the length limit ends cleanly with its token counts.
- Notes: [Python](https://github.com/lm15-dev/lm15-python/releases/tag/v2.1.0),
  [TypeScript](https://github.com/lm15-dev/lm15-ts/releases/tag/v2.1.0),
  [Rust](https://github.com/lm15-dev/lm15-rs/releases/tag/v2.1.0),
  [Go](https://github.com/lm15-dev/lm15-go/releases/tag/v2.1.0),
  [R](https://github.com/lm15-dev/lm15-r/releases/tag/v2.1.0).

### Julia is in its package registry — 2026-11-04

`LanguageModel15` 2.0.0 was accepted into Julia's General registry:
`Pkg.add("LanguageModel15")`. Julia has followed every release since.

### R 2.0.0 is stable — 2026-11-01

LM15 for R 2.0.0 is now stable, with no code change: within version 2 the
core keeps working as documented. Before this, R had been checked against
recorded traffic and a local model server, but had made only one paid call.
It has now made real calls to ten providers with API keys and five saved
sign-ins (chat, streaming, structured output, tools, pictures, reasoning,
prompt caching with exact token counts and costs), with no problem in R.
R is still installed from GitHub; it is on its way to CRAN.

- [The live run](https://github.com/lm15-dev/lm15-r/blob/main/receipts/2026-11-01-live-smoke/SUMMARY.md)

### Rust 2.0.0 and Go v2.0.0 — 2026-11-01

The first stable releases of LM15 for Rust and Go, the same code as that
morning's release candidates. LM15 is now stable in Python, TypeScript,
Rust and Go (R followed the same day): within version 2 the core keeps working as documented (see
[Version numbers](#version-numbers)). Both pass all 1,968 checks of
contract `cfc3edc`.

- Notes: [Rust](https://github.com/lm15-dev/lm15-rs/releases/tag/v2.0.0),
  [Go](https://github.com/lm15-dev/lm15-go/releases/tag/v2.0.0).

### Version 2 in every language: Python 2.0.0, TypeScript 2.0.0, Rust 2.0.0-rc.1, Go v2.0.0-rc.1, R 2.0.0 — 2026-11-01

Released together; each passes all 1,968 checks of contract `cfc3edc`.
**This breaks programs that read token counts or estimate costs.**

- **A token count means the same thing on every provider.** The input
  count is every token the model read, cached tokens included; the output
  count is every token it wrote, reasoning included; the cache, reasoning
  and audio counts are parts of those two, and the total is their sum.
  Before, each count was the provider's own, so the same field meant
  different things. Anthropic's input now includes cache reads and writes;
  Gemini's output now includes its thinking; xAI's output now includes
  reasoning; OpenAI's counts don't change. The provider's own numbers are
  still in `provider_data`.
- **A count is exact or empty.** A count the provider didn't fully report
  is left empty (`None`, `undefined`, `NULL`, `nil`), never a partial sum,
  and so is one whose numbers don't add up.
- **Cost estimates are exact or empty**, and price long prompts at the
  provider's higher rate. The old estimate charged cached tokens twice on
  OpenAI, Gemini and xAI, and missed Gemini's and xAI's reasoning.
- **Go's import path is now `github.com/lm15-dev/lm15-go/v2`** (see
  [Version numbers](#version-numbers)).
- Notes: [Python](https://github.com/lm15-dev/lm15-python/releases/tag/v2.0.0),
  [TypeScript](https://github.com/lm15-dev/lm15-ts/releases/tag/v2.0.0),
  [Rust](https://github.com/lm15-dev/lm15-rs/releases/tag/v2.0.0-rc.1),
  [Go](https://github.com/lm15-dev/lm15-go/releases/tag/v2.0.0-rc.1),
  [R](https://github.com/lm15-dev/lm15-r/releases/tag/v2.0.0).

### TypeScript 1.0.0 — 2026-10-31

The first stable release of LM15 for TypeScript and JavaScript, after eleven
release candidates. The code is 1.0.0-rc.11's: judgments, pictures for Jev,
bounding boxes, saved sign-ins. Within 1.x the core now keeps working as
documented (see [Version numbers](#version-numbers)). It passes all 1,921
checks of contract `6dc1c5c`, the same as the other languages.

- [Full notes](https://github.com/lm15-dev/lm15-ts/releases/tag/v1.0.0)

### Python 1.5.0, TypeScript and Rust 1.0.0-rc.11, Go v1.1.0-rc.10, R 1.4.0 — 2026-10-15

Released together; each passes all 1,921 checks of contract `6dc1c5c`.

- **Bounding boxes: ask where something is in a picture.** A new judgment
  (`bounding_box`; `boundingBox` in TypeScript, `BoundingBox` in Go) answers
  with four edges, each a fraction of the picture. On TypeSafe it is Jev
  1.14's Box question; on other models the same request becomes ordinary
  structured output, so one program runs everywhere. See
  [Judgments](/docs/judgments/).
- Notes: [Python](https://github.com/lm15-dev/lm15-python/releases/tag/v1.5.0),
  [TypeScript](https://github.com/lm15-dev/lm15-ts/releases/tag/v1.0.0-rc.11),
  [Rust](https://github.com/lm15-dev/lm15-rs/releases/tag/v1.0.0-rc.11),
  [Go](https://github.com/lm15-dev/lm15-go/releases/tag/v1.1.0-rc.10),
  [R](https://github.com/lm15-dev/lm15-r/releases/tag/v1.4.0).

### Python 1.4.1, TypeScript and Rust 1.0.0-rc.10, Go v1.1.0-rc.9, R 1.3.1 — 2026-10-15

- **A saved cloud login's settings are used.** A Google Cloud login saved
  with its project and location now sends them; before, the router fell
  back to the environment and the defaults. Found and fixed by Rolf
  Fredheim ([lm15-python#21](https://github.com/lm15-dev/lm15-python/pull/21)).
- `settings` accepts either spelling of a provider name
  (`vertex_anthropic` or `vertex-anthropic`).

### Python 1.4.0, TypeScript and Rust 1.0.0-rc.9, Go v1.1.0-rc.8, R 1.3.0 — 2026-10-14

- **Jev reads pictures.** A PNG or JPEG in the message sent to TypeSafe's Jev
  can be judged ("Is there a person in the image?"). TypeSafe calls images
  beta: check answers on pictures you know first.

### Python 1.3.0, TypeScript and Rust 1.0.0-rc.8, Go v1.1.0-rc.7, R 1.2.0 — 2026-10-12

- **The Meta sign-in reaches the Muse Code subscription**, Muse Wonder Full
  included. It stays *unverified*: Meta's terms reserve this key for Muse
  Code, so using it from LM15 puts the account at risk.
- Python 1.3.0 and TypeScript 1.0.0-rc.8 were tagged but not published;
  the next versions include them.

### Python 1.2.3, TypeScript and Rust 1.0.0-rc.7, Go v1.1.0-rc.6, R 1.1.2 — 2026-10-10

Each includes the version tagged earlier that day (Python 1.2.2,
TypeScript 1.0.0-rc.6, Go v1.1.0-rc.5, R 1.1.1).

- **A wrong or expired key is an authentication error on every provider**
  (Gemini and xAI answer such a key with HTTP 400).
- **A structured answer reads through `text`** when the reply came back as
  data (a schema with a yes/no or a fixed list of choices).
- **A thinking budget alone is enough**: the effort level is filled in from
  it.
- Error messages name the fix: `effort="none"` says LM15 spells it `"off"`.

### Python 1.2.1, TypeScript and Rust 1.0.0-rc.5, Go v1.1.0-rc.4, R 1.1.0 — 2026-10-06

- **Long streamed replies no longer fail at the last moment.** Streams take
  an event of any size; before, a long answer or system prompt could fail
  after it had been generated and billed.
- **A tool with no description works on every provider** (Anthropic and
  Groq refused one).
- R also gains `provider_definition()`, to use a provider LM15 doesn't list.

### Python 1.2.0, TypeScript and Rust 1.0.0-rc.4, Go v1.1.0-rc.3, R 1.0.1 — 2026-09-30

Released together; each passes all 1,838 checks of the same contract
version (`57e33d1`).

- **The Claude Code release is current and settable.** Signing in with
  Claude Code, LM15 tells Anthropic which Claude Code release it is, and
  newer models refuse old ones: Claude Opus 5.5 refused the release LM15
  named before (2.1.170). LM15 now names 2.1.285. When a model needs a newer
  release before LM15's next one, set `LM15_CLAUDE_CODE_VERSION` (read by the
  router) or the `client_version` setting for `claude-code`; no code change
  or new LM15 release is needed. The Codex sign-in takes the same setting
  (`LM15_CODEX_CLIENT_VERSION`). The auth doctor shows the release in use and
  where it came from.
- **The refusal says what to change.** Updating the `claude` program does
  not change what LM15 sends; the error now says so and names the setting.
- **Claude's default `max_tokens` is the model's own limit**: 128,000 for
  current models, 64,000 for the 4.5 generation (it was 16,384, which replies
  with reasoning on often ran out of). Other models on Anthropic-style
  servers keep 16,384. The response records it as `defaulted`, as before.
- **A setting a provider doesn't read is an error** instead of being
  ignored.
- Reading OpenAI Chat Completions requests accepts `input_audio` in ogg,
  opus, flac, aac, aiff, webm and mpeg.
- Notes: [Python](https://github.com/lm15-dev/lm15-python/releases/tag/v1.2.0),
  [TypeScript](https://github.com/lm15-dev/lm15-ts/releases/tag/v1.0.0-rc.4),
  [Rust](https://github.com/lm15-dev/lm15-rs/releases/tag/v1.0.0-rc.4),
  [Go](https://github.com/lm15-dev/lm15-go/releases/tag/v1.1.0-rc.3),
  [R](https://github.com/lm15-dev/lm15-r/releases/tag/v1.0.1).

### R 1.0.0 — 2026-09-26

The first release of LM15 for R. It passes all 1,788 checks of the same
contract version as the releases below, including judgments, the four open-model
hosts, the Google Cloud pass and saved sign-ins, which it shares with the
other languages: a login saved in R is used and renewed from Python, and the
other way round. It runs in the browser through webR, and the
[playground](/playground/) runs it there.

- Install from GitHub: `remotes::install_github("lm15-dev/lm15-r")`. It is
  on its way to CRAN; once accepted, `install.packages("lm15")`.
- `complete()` and `stream()` take the client first, as R's functions do;
  a stream calls your function with each event.
- [Full notes](https://github.com/lm15-dev/lm15-r/releases/tag/v1.0.0)

### Rust 1.0.0-rc.3 — 2026-09-26

A fix for Amazon Bedrock. In 1.0.0-rc.2 and earlier, AWS refused the
signature of every request through `bedrock-mantle-chat` and
`bedrock-anthropic`: the Rust client sent the address of the server twice,
and AWS then checked the signature against the wrong address. Nothing else
changed. See [Use AWS](/docs/aws/).

- [Full notes](https://github.com/lm15-dev/lm15-rs/releases/tag/v1.0.0-rc.3)

### Python 1.1.0, TypeScript and Rust 1.0.0-rc.2, Go v1.1.0-rc.2 — 2026-09-26

Released together; each passes all 1,788 checks of the same contract
version.

- **Four new providers**: [DeepInfra](/compatibility/providers/deepinfra/),
  [Together AI](/compatibility/providers/together/),
  [Fireworks AI](/compatibility/providers/fireworks/) and
  [Parasail](/compatibility/providers/parasail/), hosts that run open models
  from many vendors. Each rule LM15 applies to them was measured against the
  real service: for example, a model's reasoning is sent back where the
  host reads it, and a request a host would silently ignore is refused
  with an error instead.
- **Google Cloud**: LM15 finds your project where Google's own tools do
  (gcloud's configuration, the credential file, the machine it runs on), a
  Vertex API key works on the regular `vertex` door, and every Google
  sign-in failure says how to fix it. See
  [Use Google Cloud](/docs/google-cloud/).
- **TypeScript and Rust** also ship saved sign-ins and the Gemini schema
  fields (below), which were in their source since 1.0.0-rc.1.
- Notes: [Python](https://github.com/lm15-dev/lm15-python/releases/tag/v1.1.0),
  [TypeScript](https://github.com/lm15-dev/lm15-ts/releases/tag/v1.0.0-rc.2),
  [Rust](https://github.com/lm15-dev/lm15-rs/releases/tag/v1.0.0-rc.2),
  [Go](https://github.com/lm15-dev/lm15-go/releases/tag/v1.1.0-rc.2).

### Go v1.1.0-rc.1 — 2026-09-26

The first release of LM15 for Go.

- JSON objects keep their key order (`lm15.JSONObject`, built with
  `lm15.KV`). A structured-output schema reaches the model with its fields
  in the order you wrote them, which is the order the model fills them in.
- Passes all 1,583 checks of the contract it pins (2026-09-26).
- [Full notes](https://github.com/lm15-dev/lm15-go/releases/tag/v1.1.0-rc.1)

### Contract — 2026-09-26

Two changes, made in all four languages the same day. They are in Go
v1.1.0-rc.1, and in Python 1.1.0 and TypeScript and Rust 1.0.0-rc.2.

- **Gemini schema fields.** Gemini has two places for a JSON schema: one
  that reads only Google's own schema format, and one that reads full JSON
  Schema. LM15 now sends each schema where it can be read, for tools as
  well as structured output, so a tool schema with
  `"additionalProperties": false` (which OpenAI's strict mode requires) also
  works on Gemini. Schemas that worked before are sent as before.
- **Key order is checked.** The contract now checks that the JSON you pass
  in (schemas, tool arguments, extra settings) reaches the provider with its
  keys in your order.

### Python 1.0.1 — 2026-09-25

The first stable release of LM15. No `--pre` needed: `pip install lm15`.
[Notes](https://github.com/lm15-dev/lm15-python/releases/tag/v1.0.1)

### TypeScript and Rust 1.0.0-rc.1 — 2026-09-25

The first published versions, as release candidates.
