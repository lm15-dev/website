# Positioning LM15 against provider SDKs

Date: 2026-09-11. Applied after the Hormozi review to `../index.md`.
This is a positioning decision and comparison plan, not a completed parity audit.

## The comparison a framework builder actually makes

A reader may want direct control and already be choosing between the official
OpenAI, Anthropic, and Google SDKs—or planning to integrate several of them.

The useful question is not only “Why not use an agent framework?” It is:

> Can I use LM15 in place of separate provider SDK integrations, keep the
> capabilities and control I need, and reduce the cost of that integration?

Official SDKs are therefore a primary comparison set for this audience. Unified
SDKs remain genuine competitors as well; this positioning does not erase them.

## What direct access means

```text
Application → official provider SDK → provider API
Application → LM15                 → provider API
```

These are simplified network relationships, not complete internal call graphs.
For supported direct connections, LM15 implements the provider protocol rather
than delegating to the official SDK. A hosted LM15 gateway is not required.

The inspected Python implementation uses standard-library sockets and TLS with
its own HTTP/1.1 transport. It does not shell out to curl or use libcurl.
“Direct HTTP access” is the accurate general term. Other runtimes may use Fetch
or other HTTP machinery without becoming a provider-SDK wrapper.

Directness establishes that LM15 is an alternative client, not that it has less
internal abstraction, full endpoint parity, or superior performance. Official
SDKs are also direct clients. Access to request previews, custom transports,
provider metadata and extension fields helps substantiate control; a diagram
alone does not establish it.

## Revised opening

**Direct access to model APIs. One SDK across providers.**

The supporting copy identifies protocol implementation, no required hosted LM15
gateway, typed requests/responses/events, and application ownership of policy.

This replaces the earlier framework-maintenance headline, not because it was
wrong, but because it left the native-SDK alternative implicit. Framework makers
remain a primary audience; direct application users can recognize the same choice.

## The coverage table we should publish

Use one provider/API family and one language/version at a time. Do not compare
an official SDK for one provider against the union of all LM15 provider features.

```text
Feature | Official SDK + version | LM15 SDK + version | Behavior / limits | Evidence
```

Candidate rows for the relevant provider's table:

- Endpoint families: Chat Completions, Responses, Messages or generateContent.
- Ordinary completion and streaming.
- Stream completion detection, cancellation, and partial results on failure.
- System/developer instructions and generation limits.
- Function tools and tool-result follow-up turns.
- Parallel tools, forced tool choice, and tool argument handling.
- Each relevant provider-built-in tool, not just a single generic tools checkmark.
- Structured output, schema restrictions, and strict tool arguments.
- Reasoning controls and reported reasoning usage.
- Opaque/signed continuation state and replay across turns.
- Prompt-cache keys, retention, explicit controls and cache-usage fields.
- Image/document/audio/video inputs, separated by modality.
- File upload, download, listing and lifecycle operations.
- Batch submission, results, cancellation and error handling.
- Image, speech and video generation as separate surfaces.
- Realtime sessions and their supported authentication paths.
- API keys, rotating credential callbacks and applicable cloud/subscription auth.
- Error categories, request IDs, retry hints and rate-limit metadata.
- Usage fields, absent values and provider-specific response metadata.
- Custom base URL, transport injection, request inspection and raw extensions.
- Relevant HTTP/runtime capabilities and deployment restrictions.

Do not fill unknown cells with green ticks. Record fully supported behavior,
partial support, extension-only access, missing support, provisional status, and
untested behavior distinctly. “Application-controlled” is a design choice, not
necessarily a missing capability: an automatic retry loop belongs in a different
category from exposing Retry-After correctly.

For each claim, identify the SDK version, endpoint, model where relevant, and
what the evidence proves. A serialization test is different from a live lifecycle
test. The official SDK's published surface alone is not a live server guarantee.

The full table belongs on the comparison/compatibility page. The homepage should
show a scan-friendly summary and link to the details. A long table is valuable
for evaluation, but making every new reader traverse it would delay the example.

## Fair performance comparison

Measure these separately:

1. Required direct and transitive runtime dependencies; optional extras separate.
2. Installed size, using the same byte-compilation and accounting rules.
3. Browser bundle/transfer size separately from installed Node/Python size.
4. Cold startup/import with a stated cache policy and sample distribution.
5. Idle and loaded memory, using consistent baselines.
6. Request construction and response parsing on equivalent inputs/outputs.
7. Streaming decode/assembly with the same recorded frames.
8. Reused-client, steady-state transport overhead under equivalent conditions.
9. Live end-to-end latency only with provider variance and workload context.

Pin actual released packages and record versions, runtime, hardware, configuration,
workloads, sample counts and variability. Report sensible defaults and, where
useful, an explicitly equivalent configuration rather than quietly tuning only
one side. Match pooling, connection reuse, retry settings, compression and HTTP
version where possible; explain differences when equivalence is not possible.

Two separate installation scenarios matter:

- LM15 versus one official SDK for an application using only that provider.
- LM15 versus the actual combined official SDK installation needed by a
  multi-provider framework. Install the combined environment and measure it;
  summing individual footprints can double-count shared dependencies.

For the same feature requirement, include any necessary extras on both sides.
An SDK that does less work is not automatically a better implementation of the
same workload. Compare preservation of tool calls, usage, reasoning state and
error information alongside speed.

## What the current evidence supports

Inspected:

- `lm15-python/lm15/transports/_sync.py`: socket/TLS implementation and pooling.
- `lm15-python/lm15/transports/_http11.py`: HTTP/1.1 codec and explicit transport
  limits, including no HTTP/2 and no content-encoding decompression in that codec.
- `lm15-python/benchmarks/BENCHMARKS.md` and `benchmarks/RESULTS.json`.

The existing benchmark report is dated **2026-06-11**, not the current release
candidate's publication date. It includes official-SDK footprint/import figures,
but its listed request/response hot-path measurements are LM15-only.

Its steady-state comparison is pooled LM15 versus fresh-connection urllib—not
versus equivalently reused official SDK clients. The report itself identifies
connection reuse as the cause. That result cannot support “LM15 is faster than
the provider SDKs.” Similarly, a small first-byte difference against a model
server with much larger variance is not an established performance win.

Current safe statements:

- The inspected LM15 clients implement provider protocols directly.
- The Python core has no required third-party runtime dependencies.
- There is an existing benchmark methodology and historical data to build on.

Claims still requiring current, scoped comparative evidence:

- Lower hot-path overhead than a named official SDK.
- Faster cold startup for the current released versions.
- Lower total deployment footprint for a specified provider/feature set.
- Equivalent coverage for the native features a particular application needs.

## Trade-offs and consequences

- **Native SDKs as a primary comparison:** speaks to readers who want control,
  but requires more rigorous provider-by-provider coverage evidence than comparing
  against a broad agent framework's total dependency graph.
- **Direct HTTP implementation:** avoids an official-SDK dependency, but makes
  LM15 responsible for protocol, transport and provider-change maintenance.
- **A common typed model:** reduces integration duplication, but must retain
  meaningful differences and provide documented extension routes. It does not
  automatically expose every new native endpoint on release day.
- **Detailed comparison tables:** support informed selection, but require versioned
  maintenance. Do not promise parity through a static checkbox list.
- **Performance claims held until measured:** less aggressive immediate copy,
  but avoids mistaking old startup figures or connection-pooling effects for a
  universal speed advantage.
- **Visible gaps:** may lead some readers to choose an official SDK. That is
  preferable to winning adoption through a capability claim their application
  later discovers is false.
