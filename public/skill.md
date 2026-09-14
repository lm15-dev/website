---
name: lm15
description: Build model calls with LM15 using its shared request, response, streaming, and tool contracts. Use when integrating LM15 into an application or framework.
---

# Build with LM15

LM15 translates a shared request format into provider API calls and translates
answers back into shared responses or streaming events. It is a foundation for
applications and frameworks, not an automatic agent loop.

## Start with the user’s setup

1. Identify the programming language, installed SDK version, provider, and model.
2. Read that SDK’s current installation instructions and public API. Do not assume
   Python names or constructors work unchanged in another language.
3. Keep credentials outside source code. Do not print them or put them in URLs.
4. Prefer offline checks first. Ask before making live calls that may cost money.

Find SDK repositories and documentation in [llms.txt](https://lm15.dev/llms.txt).
The [contract](https://github.com/lm15-dev/lm15-contract) defines behavior;
Python is the reference implementation, not a replacement for the contract.
Check the contract version used by the selected SDK when exact behavior matters.

## Build a request

- `model`: a non-empty model identifier. With the router, use `provider:model` to
  name the connection explicitly. The model must be available from that provider.
- `messages`: an ordered, non-empty list of messages, each with a role and typed
  content parts. Use the SDK’s message helpers for plain text.
- `system`: optional instructions, separate from the messages list.
- `tools`: optional function or provider-built-in tool declarations with unique names.
- `config`: optional generation settings. Omission is not zero or an explicit off.

Shared settings still require support from the chosen endpoint and model.
Provider-specific request options belong in `config.extensions`; do not invent
shared fields, silently drop unsupported controls, or rewrite the user’s schema.

## Read the answer and continue

- Inspect the response message, finish reason, and reported usage—not only text.
- Preserve the full assistant message when adding it to conversation history.
  Parts can carry provider-issued state needed for later requests.
- Function calls are requests for your application to act. Validate the tool name
  and inputs, apply the application’s permissions, and return a result with the
  matching call ID. LM15 does not execute functions or run the loop for you.
- Built-in tools run at the provider. Do not execute their work again.
- Unreported usage is unknown, not zero. Providers count cached and reasoning
  tokens differently; do not assume all counters can be added together.
- Response `provider_data` preserves provider-returned material. It is not request
  configuration and should not be copied into `extensions`.

## Streaming and testing

Streaming uses the same Request. Consume typed events, or use the selected SDK’s
response assembler. A successful stream ends with one final end event. Do not
present an interrupted stream as a completed response. Close streams when leaving
early, and keep retry decisions in the application.

For Python, `lm15.testing.FakeLM` supplies scripted responses without network calls.
`FakeTransport` exercises a real adapter against scripted HTTP replies. Check the
selected SDK for its own testing tools; Python helpers are not universal API names.

Files, batches, standalone media generation, stored cache resources, and realtime
sessions are provisional. Check [scope and stability](https://github.com/lm15-dev/lm15-contract/blob/main/spec/SCOPE.md)
and pin versions when relying on them. A passing recorded test does not prove
that every model supports a feature today.
