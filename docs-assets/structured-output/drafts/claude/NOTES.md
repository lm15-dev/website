# Notes: Claude's draft of "Get structured output"

The page goes to `src/content/docs/docs/structured-output.mdx` (its import paths
are written for that place; remove the placeholder `structured-output.md`).
Checked: it builds, the link check passes, it renders in light and dark, and in
Python and Go.

## Choices

- **Order: plain → schema → use → trap → fix → program → providers.** The
  trap comes after the reader has seen the schema work, so the failure is a
  surprise, as it would be in real use. The providers section comes last: it
  is about where the page's code won't work, which matters only once you know
  what it should do.
- **The trap is the centre of the page.** Every model tested fell into it,
  and nothing signals it. It gets its own section and the most words; the fix
  generalises it ("a field the model must fill will get filled").
- **The provider table is built from the recordings** (`providerRows` in the
  page), not typed in: re-recording updates it. The owl's place is computed
  the same way (`owl(s.trap).place`), as are the token counts. Nothing in the
  prose is a number typed by hand.
- **Open question 1 (R and Julia refuse where others adapt):** described the
  common behaviour in one sentence ("Depending on the language, it either
  refuses before sending, or sends the request without the schema and records
  what it left out on the response"). No code for reading adaptations: the
  pack has none, and it wouldn't be true in R or Julia.
- **Open question 2 (the deer):** moved to "Try it yourself", with the
  recorded answer, as good behaviour you shouldn't count on.
- **Open question 3 (the hares):** kept, as one short paragraph: it turns the
  fix into a second lesson (describe what your values mean). The claim "in
  other runs, some models said other" rests on the pack's unrecorded runs.
- **`strict`:** one sentence, as the brief asked.
- **The date:** one sentence in "The whole program" (don't ask a model for
  what you already know), as the brief suggested.
- **JSON Schema words** (object, array, required, additionalProperties,
  description, enum) explained once, in a list, reading the schema from the
  outside in. "enum" itself is never named: the prose says "one of the
  station's places".

## Things I think are wrong or missing in the pack

1. **The answer boxes show the JSON text**, while `so-ask` prints the data
   (a Python dict, a Go text line, a Julia Dict...). A reader in Python sees
   `{'sightings': [...]}` printed, the page shows `{"sightings":[...]}`. Same
   content; worth a one-line caption, or have `CapturedAnswer` pretty-print
   JSON.
2. **The recorded JSON is on one long line.** Pretty-printing it would read
   better (the component could do it for answers that parse as JSON).
3. **"Try it yourself" answers 2 and 3 are predictions, not recordings.** I
   worded them as such ("probably"). Recording them would let the page say
   what happened.
4. **Rust and Go, Z.AI case:** not checked (facts.md says so). My sentence is
   written to be true either way.
5. **The Previous/Next buttons** go from here to Judgments, back to *Make your
   first request*: the menu order ("Generate responses" before "Use tools")
   puts this page before *Call your own functions*, which it builds on. Worth
   reordering the menu, or softening the first paragraph's link.
