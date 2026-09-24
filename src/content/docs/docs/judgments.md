---
title: "Ask for judgments with probabilities"
description: Declare the answers you accept — a set of keys, ordered levels, yes/no — and get the pick plus a probability per option, from TypeSafe's Jev natively and from other models honestly.
---

Sometimes you don't want a model to write, you want it to decide: which
category something belongs to, where it falls on a scale, yes or no. And you
often want to know how sure it was, so you can sort the confident answers from
the doubtful ones, or put the numbers in a table. TypeSafe's Jev answers these
questions directly, with a probability for every option. Other models can
answer them too, without the probabilities. LM15 sends both the same request,
and tells you which numbers were actually measured.

:::note[Status]
Ratified 2026-09-17 ([contract entry](https://github.com/lm15-dev/lm15-contract/blob/main/changes/2026-09-17-judgments.md),
mapping rule MAP-14). Implemented in Python, TypeScript, Rust, and Go. The
examples on this page are in Python for now.
:::

## Describe the answers as a schema

A judgment is an ordinary `json_schema` `response_format` whose properties
declare their answer set. Three shapes count:

- a string `enum` (or `anyOf` of `const` with descriptions) — **choice**
- `type: boolean` — **yes/no**
- an integer `enum` `0..n-1` (or `anyOf` of `const` with `title`/`description`) — **ordered levels**

The helpers only emit that schema. A hand-written `{"enum": ["a", "b"]}`
already qualifies.

The example follows the one used throughout these guides: an assistant for a
[wildlife research station](/docs/#the-example-well-build). Here it reads an
observer's field note and answers three questions about it: how sure the
identification is, what the animals were doing, and whether a young one was
there.

```python
from lm15 import LMRouter, Request, Message, Config, judgments, choice, score, yes_no

note = "Dusk, edge of the oak grove. Two deer browsing on fallen acorns, one small with spots still showing. Too far to be sure of the species: roe or fallow. They moved off into the trees when a dog barked."

answers = judgments(
    certainty=score("How sure is the species identification, according to the note?", {
        "unknown": "Species not identified",
        "guess": "A guess",
        "probable": "Probable - some features described",
        "confident": "Confident - clear features described",
        "certain": "Certain - unmistakable, or confirmed",
    }),
    behaviour=choice("What were the animals mainly doing?",
                     {"feeding": "Feeding or foraging", "moving": "Moving or travelling", "other": None}),
    juvenile=yes_no("Does the note say a juvenile was present?"),
)

router = LMRouter()
r = router.complete(Request(
    model="jev-latest",
    messages=[Message.user("Field note:\n" + note)],
    config=Config(response_format=answers, probabilities="if_available"),
))

r.data                        # {'certainty': 1, 'behaviour': 'feeding', 'juvenile': True}
r.probabilities["certainty"]  # {'0': 0.19, '1': 0.74, '2': 0.07, '3': 0.0, '4': 0.0}
r.expected("certainty")       # 0.88  — Σ p·i over the 0..4 levels
r.method                      # 'provider_classification'
```

The comments show one real run (`jev-1.13.0`, 2026-09-23); a rerun can differ
slightly. `r.data` is a plain dict: an ordered judgment answers with its level
index (`1` = `guess`), a choice with its key, a yes/no with a bool.
`r.probabilities` holds one distribution per judgment over the keys you
declared — or `None` when nothing was measured. Never a made-up one.

## The same program on other models

Only the model string changes.

```python
r = router.complete(Request(model="gpt-5-mini", ...))
r.data            # the pick
r.probabilities   # None
r.adaptations     # (Adaptation(field='config.probabilities', action='dropped', ...),)

r = router.complete(Request(model="vllm:LiquidAI/LFM2.5-2.6B", ...))   # a vLLM ≥ 0.29 server
r.method                      # 'candidate_sequence_likelihood'
r.provider_data["coverage"]   # how much probability the model put on your keys at all
```

| provider | pick | probabilities | how |
|---|---|---|---|
| `typesafe` (Jev) | native | native, `provider_classification` | each judgment becomes one Jev question over your messages |
| `openai`, `openai-chat`, `anthropic`, `gemini` | native structured output | absent | the schema goes as-is; Anthropic and Gemini receive the equivalent form their wire honours |
| `openai-chat` on vLLM ≥ 0.29 | from the distribution | exact, `candidate_sequence_likelihood` | every key is scored as a token path in one batched call |

`probabilities` has three values: `off` (default: spend nothing extra),
`if_available` (a wire that can't measure them records `dropped`), and
`required` (such a wire refuses before sending, with
`feature="config.probabilities"`).

## Why the method travels with the numbers

A Jev distribution and a token-likelihood distribution have the same shape
and are not the same measurement. Neither is calibrated on your data until
you check. So `method` is on the answer, not in a warning you can switch
off, and a model swap can never silently change what a `0.8` means.

Jev's own `confidence` is kept verbatim in `provider_data["typesafe"]`;
the expected level is computed from the distribution, never stored.

## Into a table

```python
import pandas as pd

rows = [router.complete(Request(model="jev-latest", messages=[Message.user(n)],
                                config=Config(response_format=answers, probabilities="if_available")))
        for n in notes]
df = pd.DataFrame([r.data | {"certainty_expected": r.expected("certainty")} for r in rows])
df["certainty"] = pd.Categorical(df.certainty, categories=range(5), ordered=True)
```

## Structured input, and what Jev takes

`Message.user(data({...}))` sends a JSON value as the state, verbatim. Jev
reads it as such (so backticked paths like `` `ticket.text` `` in a question
resolve); a text-only wire gets it as compact JSON in a text slot.

Jev's state is **the one user message, one part, exactly as you wrote it**
— a string, an object, or an array — and nothing else. Jev has no system
prompt and no conversation, so the SDK never invents one:

- Context that a system prompt would carry goes **in the state as a named
  key** (`data({"policy": "...", "note": "..."})`) or in the question's own
  description. A `system` on a Jev request is refused, with those two
  places named.
- A transcript goes in the state as your own object
  (`data({"messages": [{"from": "customer", "text": "..."}]})`), where a
  question can point at a turn. Several messages are refused.

The same request, sent to a chat model, gets you the pick (the data part
travels as JSON text). Contract:
[2026-09-19 · Jev's state](https://github.com/lm15-dev/lm15-contract/blob/main/changes/2026-09-19-jev-state.md).

## Read more

- [Contract entry and receipts](https://github.com/lm15-dev/lm15-contract/blob/main/changes/2026-09-17-judgments.md)
- [Python cookbook](https://github.com/lm15-dev/lm15-python/blob/main/docs/cookbooks/20-judgments.md)
- [Get structured output](/docs/structured-output/)
