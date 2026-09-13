# Homepage editorial notes

Draft: 2026-09-11. The reader-facing copy is in `index.md`.
These notes are not part of the published homepage.

The draft has also been reviewed through a value-and-evaluation-friction lens.
See [the Hormozi review](reviews/hormozi-lens.md) for its sources, symbolic model,
claim boundaries, before/after assessment, and additional trade-offs.
The subsequent [provider-SDK positioning review](reviews/provider-sdk-positioning.md)
makes official SDK integrations the primary comparison and defines the coverage
and performance evidence needed to substantiate that positioning.

## Purpose and audience

Primary reader: someone building a framework, SDK, agent runtime, developer tool,
or application that needs a provider integration layer. They want to own their
higher-level API, not maintain every upstream protocol themselves.

Secondary reader: someone making direct model calls. The first example must work
without building a framework or reading the entire architecture first.

The browser SDK is being developed separately. The website will consume it, but
this copy does not announce unreleased browser support or invent its API.

The current Python docs were not used as a writing or information-design model.
Package metadata and public API behavior were checked as technical facts.

## Landing pages re-read

Primary pages fetched and read again for this draft:

| Page | Useful lesson | What not to carry over |
|---|---|---|
| [httr2](https://httr2.r-lib.org/) | Introduce an explicit request, explain how it is changed, then show the response. Inspectability makes the abstraction understandable. | A full survey of request modifiers would make this homepage too long. |
| [ggplot2](https://ggplot2.tidyverse.org/) | Explain the division of work: what the caller supplies and what the library takes care of. Show usage before the deeper philosophy. | Mature-project adoption and stability claims cannot be borrowed by a release candidate. |
| [HTTPX](https://www.python-httpx.org/) | Install, make a useful call, inspect the result, then explain capabilities and dependencies. | Do not turn its test-coverage percentages or HTTP feature list into LM15 claims. |
| [Requests](https://requests.readthedocs.io/en/latest/) | A concrete interaction can teach more than a generic promise. Feature breadth deserves visibility. | Its enormous guide/reference index belongs in navigation, not in our homepage body. |
| [Vercel AI SDK](https://ai-sdk.dev/) | The current page addresses framework/agent builders and immediately demonstrates a selectable operation and connection. | No adoption counters, testimonials, automatic fallback promises, or ecosystem claims without our own evidence. |
| [Mirascope](https://mirascope.com/) | Make tool execution and the application loop visible; provider selection changes a meaningful example. | Tracing, versioning, and automatic execution are not LM15's core promise. |
| [any-llm](https://github.com/mozilla-ai/any-llm) | State the unified-provider job clearly and give a short path to a call. | Do not claim an arbitrary model name or provider-specific option works everywhere. |
| [genai](https://github.com/jeremychone/rust-genai) | A lower-level client can foreground native protocols and deep capabilities without leading with an agent abstraction. | No provider/model counts or beta features transplanted into LM15's coverage claims. |
| [Pydantic AI](https://pydantic.dev/docs/ai/overview/) | Address what readers are building and connect capabilities to real tasks. | LM15 should not present a complete coding agent, workflow engine, or voice application as something its core supplies. |

These are structural lessons, not copied claims or borrowed slogans. The pages
show that breadth and quick usability need not compete: a small example can lead
into a precise explanation of the larger capability set.

## Flow

1. **Name the reader's choice:** direct model-API access through one SDK rather
   than separate provider-SDK integrations.
2. **Make the product concrete:** install and make one request.
3. **Teach the boundary:** request, configured client, response; contrast the
   direct network path with an official SDK's, then introduce streaming.
4. **Make evaluation manageable:** try one provider call before deciding how far
   to integrate; retain application policy without a required hosted gateway.
5. **Show depth as practical benefits:** tools, reasoning state, caching, media,
   errors and telemetry.
6. **Explain the cross-language foundation:** contract, fixtures, and what those
   checks do and do not establish; the opening already introduces this evidence.
7. **State footprint evidence:** one current, scoped dependency fact and a link to
   measured performance rather than a floating speed claim.
8. **Give next actions:** direct integration, framework development, custom server,
   and SDK/runtime selection.
9. **End with personality:** name origin and project links.

## Decisions and trade-offs

| Decision | Benefit | Cost / boundary |
|---|---|---|
| Lead with framework authors | Makes the low-level scope a practical benefit rather than a list of absent features. | Less broad than a generic app-builder pitch; the first example and direct-use sentence keep the entry open. |
| Lead with direct access across providers | Makes the official-SDK alternative explicit instead of comparing only with agent frameworks. | Directness does not establish speed or complete feature parity; those require scoped comparison evidence. |
| Put working code before the detailed contract explanation | Readers can understand the API before evaluating its governance. | A brief contract statement accompanies the opening promise; the fuller distinction appears farther down the page. |
| Use a direct configured client in the first example | Exposes the boundary a framework would accept or construct, without introducing routing conventions. | Slightly more setup than a convenience function; router examples belong in the getting-started guide. |
| Give one complete Python example in plain Markdown | A real, copyable example works now, without fictional selector components. | Temporarily favors one SDK. The future selector must render tested idiomatic variants from the same example definition. |
| Pin the first example to a published release candidate | Readers install the API the snippet was checked against, not an older stable package. | The install line must be generated or reviewed at each release. Do not label this stable 1.0. |
| Show no model output transcript | Avoids fabricating a live result or making variable model wording look guaranteed. | Less visual payoff than a result panel; a later UI can show a clearly attributed capture. |
| Make provider switching explicit | Avoids suggesting that switching a brand name preserves model IDs or capabilities. | Less magical than a one-line-switch claim, but more useful when a reader tries another endpoint. |
| Put tools, caching and hidden-state handling on the homepage | Shows the depth relevant to framework builders, not merely a text wrapper. | More technical vocabulary; descriptions explain the practical object the application receives or controls. |
| Say capability coverage depends on endpoint/model/SDK | Keeps the shared representation distinct from universal feature availability. | Qualified claims are less sweeping; the compatibility page must make the qualification easy to inspect. |
| State dependency scope precisely | The Python core's lack of required third-party dependencies is a verified packaging fact. | No blanket claim for every language/runtime, optional extra, or future browser bundle. Zero dependencies does not itself establish security or speed. |
| Link benchmarks instead of inventing headline numbers | Makes measured performance discoverable without stale or cross-language figures. | No numeric speed badge until we have a current result suitable for the selected SDK/runtime. |
| Keep application policy outside the core pitch | Shows why a framework can use LM15 without adopting a competing runtime. | Users still need orchestration and retry/tool policy; guides, integration examples, and optional higher-level libraries must address that need. |
| Explain an independently authoritative contract | Differentiates a specified common representation from matching method names. | It is not a claim that competitors lack tests, or that fixtures prove every network lifecycle. |
| Put the XKCD reference at the end | Preserves the project's personality without requiring the joke to understand the product. | The opening is deliberately more direct than playful. The logo can carry the handmade visual character. |

## Draft links and implementation boundary

`index.md` is copy, not a deployed site. Relative links are proposed destinations
in the fresh navigation tree. They intentionally do not send readers to prototype
docs as though those were the finished new guides. Destinations must be written
or mapped before this page is published; do not deploy broken placeholder routes.

No website scaffold, navigation behavior, selector implementation, generated API
reference, or browser SDK dependency has been added in this change.

When the site is built:

- Treat the first example as one structured recipe, with separately checked
  language-specific source. Do not generate syntax with naive string replacement.
- Generate its language/provider/model label and install version together with
  the source so the displayed setup cannot disagree with the copied code.
- Keep setup effects local to the example and relevant prose. Do not rewrite a
  provider's factual reference page into another provider's page.
- Add Canonical request and HTTP request views using actual SDK behavior, with
  placeholder credentials and explicit unsupported cases. They are not claimed
  as available by the current Markdown copy.
- Changing selectors must not send model requests or trigger authentication.
- Integrate executable example tests into the website build. An ad hoc local
  verification is not a permanent CI gate.
- Derive SDK availability and performance labels from versioned records. Verify
  provisional labels and browser support against the relevant implementation.
- Measure footprint in the appropriate unit: installed package size is not the
  same measurement as compressed browser transfer size.

## Verification for this draft

- Python core runtime dependencies: inspected `lm15-python/pyproject.toml`; the
  only declared runtime extra is `websockets>=12` under `live`.
- The example targets published `lm15==1.0.0rc1`, not another agent's working tree.
- Executed the exact Python block against that installed release with a scripted
  transport and network disabled: passed. Checked imports, construction, the
  destination and request body, response parsing, and printed output. This was
  not an authenticated live provider call.
- No captured inference output, speed ratio, install-size number, test count,
  adoption counter, or universal feature claim was added.
