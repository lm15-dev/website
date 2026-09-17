---
title: "Ask for judgments with probabilities"
description: Declare the answers you accept — a set of keys, ordered levels, yes/no — and get the pick plus a probability per option, from TypeSafe's Jev natively and from other models honestly.
---

Sometimes you don't want a model to write. You want it to *decide*: which of
these categories, where on a scale you defined, yes or no — for many items,
with a probability per option you can put in a table. TypeSafe's Jev does
exactly that natively. Ordinary models can be made to answer the same
questions. LM15 gives both one request shape and is honest about which
numbers were measured.

:::note[Status]
Ratified 2026-09-17 ([contract entry](https://github.com/lm15-dev/lm15-contract/blob/main/changes/2026-09-17-judgments.md),
mapping rule MAP-14). Implemented in the Python reference; the TypeScript
port carries the data types so far, the other ports follow.
:::

## Describe the answers as a schema

A judgment is an ordinary `json_schema` `response_format` whose properties
declare their answer set. Three shapes count:

- a string `enum` (or `anyOf` of `const` with descriptions) — **choice**
- `type: boolean` — **yes/no**
- an integer `enum` `0..n-1` (or `anyOf` of `const` with `title`/`description`) — **ordered levels**

The helpers only emit that schema, the way `tool(fn)` emits a tool schema.
A hand-written `{"enum": ["a", "b"]}` already qualifies.

```python
from lm15 import LMRouter, Request, Message, Config, judgments, choice, score, yes_no

note = "Ripe blackberry and cassis, toasty oak, firm tannins. Long finish; will reward a decade in the cellar."

answers = judgments(
    quality=score("How good is this wine, according to the note?", {
        "faulty": "Faulty or unpleasant",
        "simple": "Simple and sound",
        "good": "Good, well made",
        "excellent": "Excellent - complex and structured",
        "profound": "Profound - the note treats it as exceptional",
    }),
    style=choice("What is the dominant style described?",
                 {"fruit": "Fruit-forward", "oak": "Oak-driven", "other": None}),
    ageing=yes_no("Does the note say the wine will improve with age?"),
)

router = LMRouter()
r = router.complete(Request(
    model="jev-latest",
    messages=[Message.user("Tasting note:\n" + note)],
    config=Config(response_format=answers, probabilities="if_available"),
))

r.data                    # {'quality': 3, 'style': 'fruit', 'ageing': True}
r.probabilities["style"]  # {'fruit': 1.0, 'oak': 0.0, 'other': 0.0}
r.expected("quality")     # 3.02  — Σ p·i over the 0..4 levels
r.method                  # 'provider_classification'
```

`r.data` is a plain dict: an ordered judgment answers with its level index
(`3` = `excellent`), a choice with its key, a yes/no with a bool.
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
df = pd.DataFrame([r.data | {"quality_expected": r.expected("quality")} for r in rows])
df["quality"] = pd.Categorical(df.quality, categories=range(5), ordered=True)
```

## Structured input

`Message.user(data({...}))` sends a JSON object as the state. Jev reads it
as such (so backticked paths like `` `ticket.text` `` in a question resolve);
text-only wires get it as JSON.

## Read more

- [Contract entry and receipts](https://github.com/lm15-dev/lm15-contract/blob/main/changes/2026-09-17-judgments.md)
- [Python cookbook](https://github.com/lm15-dev/lm15-python/blob/main/docs/cookbooks/20-judgments.md)
- [Get structured output](/docs/structured-output/)
