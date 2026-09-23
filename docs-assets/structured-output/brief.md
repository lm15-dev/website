# Brief: Get structured output

Read [`../WRITING.md`](../WRITING.md) first. The facts behind this brief are in
[`facts.md`](facts.md); the code, in six languages, in [`code.md`](code.md).

## The page

- File: `src/content/docs/docs/structured-output.mdx` (replaces the
  placeholder `structured-output.md`).
- Menu title: **Get structured output**.
- Already linked from: the Judgments page ("Read more"), the Overview
  ("What else you can express").

## Where it sits in the story

The reader has asked the station's assistant questions, held a conversation,
and let it search the station's four recorded sightings with a tool
(*Call your own functions*). Those sightings are rows: date, place, species,
count.

**This page:** observers don't write rows. They write notes, in their own
words. The station wants each note turned into rows it can store, count and
search, so the assistant must answer in a shape a program can read, not in
prose. By the end, a note goes in and data comes out, reliably.

(The program adds the date itself: it knows when the note was filed. The model
is asked only for what the note says. That is a design choice worth one
sentence: don't ask a model for what you already know.)

## What the page must teach

1. A plain answer is for people. Asked to turn a note into records, the model
   produced a Markdown **table**: pleasant to read, useless to a program.
2. A **schema** describes the shape you want: a list of sightings, each with a
   species, a count and a place. The request carries it as the answer format.
3. The answer then **is** that shape, and the program reads it as data: one
   line per sighting, with no text parsing. In Go, it fills your own struct.
4. **The trap: a closed list forces a pick.** The schema allows three places.
   A note from the old barn doesn't fit, and the model filed the owl under a
   place it wasn't: no error, a wrong row. Every model tested did this.
5. **The fix: leave the model a way to say "none of these".** Adding `"other"`
   to the places, the owl went under "other". General lesson: a schema is also
   a way of telling the model what it may answer; give it an honest way out.
6. **Providers differ**, and what LM15 does about it:
   - most providers enforce the schema (OpenAI, Anthropic, Gemini, OpenRouter:
     LM15 translates it into each one's own form);
   - some refuse it themselves (DeepSeek answers with an error);
   - some would accept it and silently ignore it; LM15 knows which, and tells
     you (see facts.md, "Z.AI": this differs by language, see Open questions).
7. Pointer: *Ask for judgments with probabilities* is structured output for
   decisions (a choice, a scale, yes/no) with a probability per answer.

Not on this page: every JSON Schema keyword, `strict` in depth, streaming
structured answers. Mention that `strict` asks the provider to follow the
schema exactly (the code sets it) in one sentence at most.

## Recipes (code) in order of use

| Recipe | What it shows |
|---|---|
| `so-note` | The field note from the stream camera, as a string |
| `so-plain` | Ask with no answer format; print the text |
| `so-schema` | The sightings schema (places: oak grove, stream, meadow) |
| `so-ask` | The same request with the schema as its answer format; print the data |
| `so-use` | One line per sighting, from the data |
| `so-note-barn` | The barn note (same code, a different note) |
| `so-schema-other` | The schema with "other" added to the places |
| `so-program` | The whole program, with the fixed schema |

## Recordings to show

Component: `<CapturedAnswer set="structured-output" step="…" />`, with
`show="text"` (default) or `show="read"` (adds finish reason and tokens).
Recorded with `gpt-5.6-sol` through OpenAI Codex, 23 September 2026.

| Step | Note, schema | What came back |
|---|---|---|
| `plain` | stream, none | A Markdown table: Species, Count, Time observed, Condition/notes, Detection method. 131 output tokens. |
| `ask` | stream, three places | `{"sightings":[{"species":"badger","count":3,"place":"stream"},{"species":"fox","count":1,"place":"stream"}]}`, 41 output tokens |
| `trap` | barn, three places | tawny owl, 1, **oak grove**; hare, 2, meadow |
| `fixed` | barn, with "other" | tawny owl, 1, **other**; hare, 2, meadow |
| `deer` | deer note, with "other" | deer, 2, oak grove (the note says "roe or fallow"; the model did not guess) |

Across providers (for a table or a sentence; import
`src/data/structured-output-captures.json`, keys `providers` and `extras`):
the barn trap misplaced the owl on every provider that enforced the schema.

## Open questions for the writer

1. **R and Julia refuse where the others adapt.** For a provider that would
   ignore the schema (Z.AI), Python and TypeScript drop it and record why on
   the response; R and Julia refuse before sending. The page's text must be
   true in every language. Options: describe only what is common ("LM15 won't
   let a schema be ignored silently: depending on the language, it refuses,
   or drops it and records why on the response"), or leave Z.AI out of the page
   and link to the compatibility page. Choose, and say why in NOTES.md.
2. Whether to show the `deer` recording at all. It shows good behaviour, not
   a trap; it may belong in "Try it yourself" instead.
3. The hares: the note says "the barn field". With "other" available, models
   split between "meadow" and "other" (facts.md). Is that worth one sentence
   ("a schema can't settle what your places mean; describe them"), or a
   distraction?
