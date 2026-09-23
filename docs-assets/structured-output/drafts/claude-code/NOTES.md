# Notes on this draft (Claude Code)

## Choices

- **Open question 1 (R and Julia refuse, the others adapt).** I kept Z.AI in,
  because it is the clearest example of why a provider's silent "yes" is
  dangerous, and said the language difference once, plainly: Python and
  TypeScript drop the schema and record why; R and Julia refuse before
  sending. I did not mention Rust and Go by name, since the pack says they
  were not checked for this case. The sentence "either way, you find out from
  your program, not from a row that looks fine" is what is true everywhere.
- **Open question 2 (the deer recording).** Moved to "Try it yourself" as
  exercise 1: it shows good behaviour, and predicting it teaches more than
  seeing it.
- **Open question 3 (the hares).** Left out. It would dilute the trap, which
  is the page's one big lesson. If the merge wants it, it fits as one
  sentence after "Give it a way out".
- **Order.** The trap comes after the reader has used the data, so they feel
  the cost: a wrong row that looks true. The provider table comes late,
  because it is reference-like; the story is done by then.
- **"Don't ask a model for what you already know."** One paragraph, in
  "Describe the shape", where the missing date is visible in the schema.
- **`strict`.** One sentence, as the brief asked.
- **The `so-use` output** is shown as a fixed text block ("3 badger at
  stream"): it is what every language prints for the recorded `ask` answer.
  It is not a recording; if that breaks the rule, replace it with a
  sentence.

## Things I wanted and didn't have

- A `CapturedAnswer` step for the provider recordings. I quoted the Z.AI
  reason and the DeepSeek `json_object` text through inline expressions in a
  `<pre>` box, since a Markdown code fence does not evaluate expressions.
  A `set="structured-output" step="providers.zai…"` form would be cleaner.
- The owl's place per provider is read from the recordings (`owlPlace`), so
  the table stays true after a re-recording. The DeepSeek error string in the
  table is typed by hand from the recording; it could be read the same way.

## Possible problems in the pack

- Rust and Go behaviour for the Z.AI case is stated as "implement the same
  rule" but unchecked. The page's text avoids naming them, but a reader in
  Rust or Go is told nothing. Worth one offline check so the page can say
  "Python, TypeScript, Rust and Go".
- `so-plain` prints the text; the page then says "try to read it as data,
  and you get nothing, or an error". The code doesn't show that attempt. A
  one-line recipe (`print(response.data)` → `None`) would make it concrete,
  but it must be true in all six (R and Julia throw; that is why the
  sentence says "or an error").
