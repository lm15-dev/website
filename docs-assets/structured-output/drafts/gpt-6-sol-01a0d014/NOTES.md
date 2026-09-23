# Notes for the merge

This is a complete candidate for `src/content/docs/docs/structured-output.mdx`, **not** an edit to the live page. Copy it to that path when chosen; its component import paths are written for the final path, not this drafts folder. I did not change the verified recipes or recordings.

## Editorial choices

- The arc comes from ggplot2 *First steps*: introduce the station's note as its `mpg` dataset; show the smallest request and its actual result; name the few parts of a schema, then show one change and its result. The second note gives us the book's side-by-side contrast (like `aes(colour = "blue")` vs `colour = "blue")`: the same request with three places, then with `other`.
- I kept the **wrong owl record** at the center. A schema promises a shape, not truth; the wrong answer has all required fields. This is a more memorable lesson than reciting JSON Schema keywords.
- I showed the `deer` capture only in one sentence near the trap and in the exercises. It illustrates honest uncertainty without introducing another large example or a fourth code block.
- I included the **hare ambiguity** after the fix: `other` solves the owl's forced choice, but `meadow` is not an agreed meaning of “barn field.” The writer shouldn't sell the fix as total correctness. If we need to preserve “old barn roof,” we need a free-text location field or a richer schema.
- I included **provider differences** in a short section after the tutorial, rather than disrupting the central story. R and Julia refuse Z.AI; Python and TypeScript drop and report it. Since the prose cannot ask all languages to inspect `adaptations`, it states the common rule: don't trust that an unsupported schema was enforced. Rust/Go were not tested for this particular provider, so neither is named in that sentence.
- The page ends by pointing to Judgments: it is already written and shares the idea of structured answers.

## Verify before publishing the merged page

- Build at its final path (`npm run build`), and read the light/dark and phone views. The candidate lives outside Astro content so it is not built here.
- Check the six-language test: `npm run test:docs-examples`. The recipes were previously run, but this draft's exact MDX needs its own build check.
- The recorded `so-ask` response is JSON **text**, whereas the snippet prints parsed data. `CapturedAnswer` shows the received text, not literal stdout from every language; the paragraph after it makes that distinction.
- If the recording is refreshed, recheck the prose: the token counts, the wrong owl location and the hare ambiguity come from the 23 September 2026 capture.
- Provider coverage is scoped to these recorded calls, not all endpoints or model versions. Avoid changing “returned the requested sighting shape” into “guarantees schema enforcement.”
- Consider replacing the final provider paragraph with a link to Compatibility when that page exists; R/Julia's mismatch is a parity issue, not the main lesson.
