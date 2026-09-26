---
title: "Language and runtime support"
description: Which languages LM15 is available in, how to install each one, which runtimes and platforms it supports, and how far along each language is.
---

LM15 is one design implemented separately in each language. There is no
shared native core underneath: the Python package is pure Python, the Go
module is pure Go, and so on. What keeps them the same is a shared
[contract](https://github.com/lm15-dev/lm15-contract): a written
specification and a corpus of recorded provider traffic that every language
is graded against. Two languages that pass the same contract build the same
request from the same program and read the same answer from the same reply.

This page lists where each language stands. The [Releases](/releases/) page
lists the versions.

## Released languages

These four are published, graded against the current contract, and used in
every example on this site.

| Language | Version | Install | Runs on |
|---|---|---|---|
| **Python** | 1.0.1, stable | `pip install lm15` | Python 3.10 or newer; Linux, macOS, Windows |
| **TypeScript** | 1.0.0-rc.1, release candidate | `npm install @lm15/lm15` | Node.js 22 or newer; browsers (`@lm15/lm15/browser`) |
| **Rust** | 1.0.0-rc.1, release candidate | `cargo add lm15` | stable Rust; native targets and `wasm32` |
| **Go** | v1.1.0-rc.1, release candidate | `go get github.com/lm15-dev/lm15-go@v1.1.0-rc.1` | Go 1.26.2 or newer; Linux, macOS, Windows, `GOOS=js` |

**Stable** means the core won't change in a way that breaks your program
until the next major version. A **release candidate** is the version that
is expected to become stable, published so it can be tried first. For all
four, the core is the same: requests and responses, streaming, tools,
structured output, media inputs, reasoning controls, errors, credentials
and model listing. Files, batches, media generation, stored prompt caches,
realtime sessions, reading OpenAI Chat Completions requests, and signing in
with an account are **provisional** in every language: they may still
change within 1.x, with a notice.

None of the four has a required third-party dependency: each uses its
language's standard library, including for HTTP. Python's realtime
sessions use the optional `websockets` package (`pip install 'lm15[live]'`),
and Rust's examples use Tokio to run `async` code.

### How they are checked

Every change to any of the four is graded by the contract's harness, which
compares the exact requests each language builds and the responses it reads
with recorded provider traffic. Each passes every check of the contract
version it pins (on 2026-09-26: 1,583 checks for TypeScript, Rust and Go,
1,786 for Python, whose pin already includes the next providers). Each language also runs its own tests on Linux,
macOS and Windows, and every example on this site is run in every
language and must send the same request as Python does.

Saved sign-ins are shared across languages: a login saved from Python is
used and renewed from Go, and two programs in different languages renew one
token exactly once. Python 1.0.1 and Go v1.1.0-rc.1 have saved sign-ins;
TypeScript and Rust have them in their source, for their next release.

### In the browser

TypeScript runs in the browser directly. Rust and Go compile to
WebAssembly, and the [playground](/playground/) runs the real Rust and Go
packages that way, as well as Python through Pyodide. In a browser, a
provider must allow requests from web pages (Anthropic needs an explicit
opt-in, which LM15 sends), and sign-in methods that open a local listener
are not available.

## Languages in development

| Language | Where it stands | Install |
|---|---|---|
| **Julia** | Complete against an earlier version of the contract (September 11); being brought up to date. Julia 1.10 or newer. | From GitHub: `Pkg.add(url="https://github.com/lm15-dev/lm15-jl")` |
| **R** | The API is being designed; the examples on this site preview it. | Not yet available |

## Early ports

[Java](https://github.com/lm15-dev/lm15-java),
[Ruby](https://github.com/lm15-dev/lm15-ruby),
[Swift](https://github.com/lm15-dev/lm15-swift) and
[.NET](https://github.com/lm15-dev/lm15-dotnet) exist as ports written
against the contract of September 11. They are not published and are not
kept up to date with the released languages; their repositories say how
far each one got. Use them to evaluate LM15 in those languages, not in
production.
