# Editorial notes for the merge

## Main choice

The page's argument is **readable output → predictable structure → useful data → shape is not truth**. The barn example is the turning point, not an optional warning after the tutorial. It gives the reader a reason to understand `enum` rather than memorize its syntax.

## What I borrowed from ggplot2

- *First steps*, §§2.2–2.4: introduce the data, name the components, show the smallest example, interpret the result, and change one thing. Here the initial table is not called useless: it is useful to a person but an unstable format for this program.
- The `aes(colour = "blue")` / `colour = "blue"` comparison: almost identical code with importantly different consequences. Here the comparison is the three-location enum versus the same enum with `other`.
- The package Get started article: explain the components independently, then provide a complete assembled example.
- Reference pages such as `geom_point`: explain relevant limitations where the reader encounters them, rather than cataloguing every feature.

Sources: https://ggplot2-book.org/getting-started.html and https://ggplot2.tidyverse.org/articles/ggplot2.html . These are inspiration, not templates whose wording should be copied.

## Trade-offs

- **More reasoning, fewer repeated results.** Every main recording is shown once. No token-count comparison: the point is predictable fields, not a claim that structured output is always cheaper.
- **The long schema appears twice.** The pack provides the whole fixed schema, not a tested one-line modification per language. I kept the verified recipes unchanged; showing only the changed enum would be less repetitive, but needs a new verified recipe.
- **The full program is at the end.** Readers inspecting the topic can follow the smaller pieces; readers running it can use the complete block. The opening explicitly says the fragments build on one another and need the complete program's imports.
- **Z.AI differences are disclosed once, in a disclosure box.** Omitting them would hide a genuine failure mode; putting language distinctions in the main explanation would derail the lesson. I do not claim Rust and Go were checked for this particular case.
- **The hares remain in the explanation.** Calling `other` a complete fix would overclaim. The remaining `meadow` assignment distinguishes a general habitat from a named survey site.
- **The deer recording informs an exercise**, not a sixth output box. It teaches restraint without inventing a failure that the captured model did not make.
- **No new model calls or shared code changes.** This draft uses only the pack, and does not replace or publish the live page.

## Corrections to assumptions in the pack

- A Markdown table is not literally impossible for software to read. It is an unstable interface for this task. The draft says that, rather than calling it useless.
- JSON parsing is not schema validation. TypeScript's type assertion is not runtime validation; Rust's default values/empty iteration can mask malformed answers. I did not alter the verified examples, but added the shared warning before moving into semantic correctness. A separate verified defensive-reading example would improve production guidance.
- The schema does not prove biological facts. The owl note is only a tentative tawny identification; the captured model nevertheless says `tawny owl`. The draft doesn't present that species claim as independently confirmed.
- A filing date is not necessarily the observation date. The brief suggests attaching a known date; I omitted this tangent rather than imply these are interchangeable.
- Repeated identical model requests can produce identical results; variability is possible, not guaranteed. This draft avoids promises about what every rerun will say.

## Handoff

- `structured-output.mdx`: source draft, with component imports written for its eventual destination at `src/content/docs/docs/structured-output.mdx`.
- `tutorial.md`: readable rendering of this draft with the pack's Python examples expanded and recordings inserted verbatim. The final MDX supports all six language choices; this review copy shows Python only.

No provider claims beyond the checked model/request combinations should be inferred. Existing recordings and facts retain their original dates.
