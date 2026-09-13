# Reviewing LM15's homepage through Hormozi's value framework

Date: 2026-09-11. Applied to the homepage draft in `../index.md`.
This records that revision; the later [provider-SDK positioning review](provider-sdk-positioning.md)
changes the headline and comparison set while retaining this value framework.

This is an editorial model and a record of decisions, not reader-facing copy.
It is an application of public material, not an endorsement or review by Alex
Hormozi. We are borrowing a way to examine value—not imitating his voice.

## Sources actually read

Read the official Acquisition.com training pages and their public worksheets:

- [The Value Equation lesson](https://www.acquisition.com/training/offers4) and
  its [Pricing & Value checklist](https://www.acquisition.com/files/pricing-value-checklist.pdf).
- [Offer Creation, part 1](https://www.acquisition.com/training/offers5) and
  [part 2](https://www.acquisition.com/training/offers6), with the
  [Offer Creation checklist](https://www.acquisition.com/files/offer-creation-checklist.pdf).
- [Picking Markets](https://www.acquisition.com/training/offers2), with the
  [market/niche checklist](https://www.acquisition.com/files/pick-your-niche-checklist.pdf).
- [Guarantees](https://www.acquisition.com/training/offers8), with the
  [guarantee checklist](https://www.acquisition.com/files/unbeatable-guarantee-checklist.pdf).

The substantive text reviewed was the worksheets. The video landing pages were
inspected, but the videos were not transcribed or reviewed in full. No claim is
made to have read the entire book. Source PDFs remain outside the project and
are not redistributed here.

The value material emphasizes four directions: make the desired result more
valuable and believable, and reduce the wait and effort involved. The offer
material also asks authors to identify obstacles throughout the customer's
journey and prioritize useful solutions. The audience material favors a specific
reader with a specific problem. The guarantee material concerns reducing the
buyer's perceived risk; many of its commercial tactics do not fit an SDK.

## 1. A symbolic model, not a measured law

Represent the value framework as:

```text
                     D × L
Perceived value  ∝  ─────────
                     T × E
```

- `D`: how much the reader wants the outcome.
- `L`: how strongly the reader believes this offer can produce that outcome.
- `T`: how long the reader expects to wait for useful progress and the outcome.
- `E`: the effort and sacrifice the reader expects to contribute.

This is a directional model. The variables do not have calibrated units, are not
independent, and should not be assigned invented scores. The expression is not a
conversion-rate predictor, cannot handle zero denominators literally, and does
not prove that a wording change improves adoption.

The homepage can explain real value, make it assessable, and reduce evaluation
friction. It cannot create SDK coverage, performance, or reliability by describing
those properties more confidently.

### LM15's application

| Variable | Meaning for a framework author | Editorial consequence |
|---|---|---|
| `D` | Support the model providers their users need while retaining their own framework design. | Lead with provider-maintenance work avoided, not only a description of our data representation. |
| `L` | Believe the mappings are correct enough, the required features exist, and the SDK fits their runtime. | Put the contract near the promise, then provide compatibility evidence, executable examples, and precise version/runtime information. |
| `T` | Reach a credible fit check without first migrating an application or securing every provider account. | Offer one complete example and a no-key test-response route; do not promise a production migration in an invented number of minutes. |
| `E` | Learn and integrate another dependency without sacrificing control or inheriting unwanted infrastructure. | Explain the provider boundary, reusable client, custom transport option, lack of a required gateway, and the application policy that remains theirs. |

The first useful outcome of reading the page is an informed technical evaluation.
A successful hello-world request is progress, not proof that an entire framework
migration is complete.

## 2. Why leaving policy to the application can increase value

A framework author already intends to own policy. Under comparable requirements:

```text
Direct integration effort =
    provider integration + provider maintenance + application policy

LM15 integration effort =
    learning LM15 + integrating LM15 + maintaining the binding + application policy
```

The policy term does not automatically become new work merely because LM15 does
not supply an agent loop. The possible benefit is replacing repeated provider
work with one maintained boundary.

This is not a claim that LM15 always wins. An existing framework may already have
excellent adapters, a migration may be expensive, or a higher-level toolkit may
provide exactly the policy the reader wants. The copy should enable that decision,
not obscure its costs.

The comparison is different for an application developer who wants a ready-made
agent: a framework's included policy may save substantial work. Do not generalize
the framework-author value proposition to every buyer or user.

## 3. Constraints on the optimization

Our own adaptation is a constrained editorial objective:

```text
Improve the reader's expected value and ease of evaluation
subject to:
    truthful, scoped claims
    evidence appropriate to the claim
    an accurate mental model
    visible material costs and limitations
    no fabricated urgency, scarcity, adoption, or guarantees
```

For each important claim, require this chain:

```text
Reader problem → practical benefit → actual mechanism → evidence → scope
```

Example:

```text
Maintaining several stream parsers
→ consume a common event representation
→ LM15's provider adapters and stream assembly
→ relevant fixtures and executable tests
→ selected SDK/version and supported endpoint
```

A feature list that stops at the mechanism undersells the value. A promise that
jumps from the problem to an unsupported outcome oversells it.

## 4. Review of the previous draft

The existing headline already names a valuable job and work the reader would
prefer not to repeat. It stays. Changing it merely to sound more forceful would
not improve the reasoning.

The opportunities were below the headline:

| Previous emphasis | Issue through this lens | Revision |
|---|---|---|
| Common representation and low-level foundation | Accurate mechanism, but the maintenance benefit was left for the reader to infer. | Lead with avoiding separate request formats, stream parsers and error mappings. Explain typed representations afterward. |
| Contract mainly near the bottom | Evidence was separated from the strongest architectural promise. | Mention the shared contract and fixtures in the opening, retain the detailed explanation later. |
| First trial requires a provider key | A reader without a key sees a setup obstacle before learning whether the interface fits. | Offer the test-response route beside the live prerequisite; keep paid-call disclosure. |
| Ownership described as a philosophy | The reader may still assume adoption means restructuring their framework. | Suggest evaluating one call and adapting its result before deciding integration scope. Do not promise a drop-in replacement. |
| Capabilities described mostly as nouns | The reader has to infer what the capabilities let their framework do. | Explain stream consumption, controlled tool execution, reasoning-state continuation, and informed retry decisions. |
| Footprint before detailed behavioral evidence | Small size matters, but correctness is more consequential for the primary reader. | Put the deeper contract discussion first. Keep scoped dependency facts and benchmarks visible afterward. |

These are editorial hypotheses, not measured conversion improvements. A later
reader study should check whether maintainers can explain the boundary and find
their setup's limitations more quickly after the revision.

## 5. Trade-offs accepted

- **A more specific opening:** stronger for framework and SDK authors, less broad
  than a generic application toolkit pitch. The simple example preserves direct use.
- **One technical proof statement near the top:** reduces the distance between
  promise and evidence but introduces the contract before the example. Keep that
  statement short; the full explanation remains below.
- **An extra no-key path:** reduces account/setup friction but gives readers a
  choice beside the live example. Keep it a text link, not a competing hero button.
- **Incremental evaluation instead of instant migration:** more credible and useful,
  less dramatic. Adapting result types, lifecycle, auth and errors remains real work.
- **Benefits alongside feature names:** makes capabilities easier to evaluate but
  lengthens some table cells. Preserve technical nouns for scanning and search.
- **Verification before performance:** prioritizes behavioral confidence, with
  footprint farther down. Do not hide benchmarks or imply performance is irrelevant.
- **No numerical marketing score:** avoids false precision, at the cost of not
  having an automatic ranking of headlines. Use reader tasks and real evidence.
- **No adoption guarantees or artificial deadlines:** a public SDK cannot promise
  every model call succeeds, nor invent scarcity around an open-source download.
  Lower the real cost of evaluating it instead.

## 6. Claim ledger for this revision

| Claim or implication | Evidence/boundary |
|---|---|
| Common request/response/event interface | Actual published API; example checked against Python 1.0.0rc1. |
| Provider-specific integration work is delegated to LM15 | Adapter architecture for supported connections; users still configure credentials, select valid models, and integrate their own application policy. |
| No hosted LM15 gateway required | Direct provider clients; does not mean every upstream provider is free or every browser can reach every endpoint. |
| Test responses allow a no-key evaluation | Existing testing facilities and the exact-code offline checks performed for the homepage and README. Not a live-provider test. |
| Shared contract and fixtures | The separate contract repository and per-implementation gates; not evidence of universal feature parity or every target's release readiness. |
| Python core has no required third-party dependencies | Package metadata; WebSocket support is an optional extra. No other SDK's footprint is implied. |
| Less provider maintenance for the reader | An intended architectural benefit, not a measured hours-saved statistic or a claim that dependency maintenance disappears. |

## 7. Follow-through before publication

Persuasive wording cannot substitute for the evaluation path it promises:

1. Write and test the linked no-key example. It must not silently call a provider.
2. Make SDK/runtime/feature status easy to reach from the first example.
3. Connect selector labels, package versions, and displayed source to the same
   example definition; retain direct links and readable static content.
4. Show fixture-based and live verification as separate facts.
5. Use the browser SDK for inspection and replay when it is ready, without
   presenting a planned capability as a published one.
6. Try the page with framework authors: ask them to identify what LM15 owns, what
   they still own, whether their setup is supported, and how to test one call.
   Observe completion and confusion; do not infer success from enthusiasm alone.
