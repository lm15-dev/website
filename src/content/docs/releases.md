---
title: "Releases"
description: The current version of LM15 in each language, what each release contains, and how versions are numbered.
---

## Current versions

| Language | Version | Released | Package |
|---|---|---|---|
| Python | **1.0.1** (stable) | 2026-09-25 | [`lm15` on PyPI](https://pypi.org/project/lm15/) |
| TypeScript | **1.0.0-rc.1** (release candidate) | 2026-09-25 | [`@lm15/lm15` on npm](https://www.npmjs.com/package/@lm15/lm15) |
| Rust | **1.0.0-rc.1** (release candidate) | 2026-09-25 | [`lm15` on crates.io](https://crates.io/crates/lm15) |
| Go | **v1.1.0-rc.1** (release candidate) | 2026-09-26 | [`github.com/lm15-dev/lm15-go`](https://pkg.go.dev/github.com/lm15-dev/lm15-go) |

The examples on this site use these versions. Julia and R are in
development; see [Language and runtime support](/compatibility/languages/).

## Version numbers

LM15 follows semantic versioning in every language. Within a major version,
the core — requests and responses, streaming, tools, structured output,
media inputs, reasoning, errors, credentials and model listing — keeps
working as documented. Provisional features (files, batches, media
generation, stored prompt caches, realtime sessions, reading OpenAI Chat
Completions requests, and account sign-in) may change within 1.x; such a
change is announced in the release notes and in the
[contract's change log](https://github.com/lm15-dev/lm15-contract/tree/main/changes).

The languages don't share version numbers, because each is released on its
own schedule. They share behavior instead: every release is graded against
the same [contract](https://github.com/lm15-dev/lm15-contract), and its
notes name the contract version it passes.

**Why Go starts at 1.1.** An early prototype of the Go module was tagged
`v1.0.0` in June by mistake. Go's module mirror keeps every published
version forever, so that tag is retracted (Go warns anyone who uses it and
never selects it on its own) and the first real release is numbered 1.1.

## Release notes

### Go v1.1.0-rc.1 — 2026-09-26

The first release of LM15 for Go.

- JSON objects keep their key order (`lm15.JSONObject`, built with
  `lm15.KV`). A structured-output schema reaches the model with its fields
  in the order you wrote them, which is the order the model fills them in.
- Passes all 1,583 checks of the contract it pins (2026-09-26).
- [Full notes](https://github.com/lm15-dev/lm15-go/releases/tag/v1.1.0-rc.1)

### Contract — 2026-09-26

Two changes, made in all four languages the same day. They are in Go
v1.1.0-rc.1; Python, TypeScript and Rust have them in their source and will
ship them in their next release.

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
