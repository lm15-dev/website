# Asset packs for the docs

One folder per page still to write. Everything that had to be run is here;
the writing is not. Several writers draft each page from its pack, and the
drafts are compared and merged.

Start with [`WRITING.md`](WRITING.md): how to write a page, and the rules.

| Pack | Page | State |
|---|---|---|
| [`structured-output/`](structured-output/) | Get structured output | ready to write |

## What a pack holds

| File | What it is |
|---|---|
| `brief.md` | What the page must teach, where it sits in the story, the recipes and recordings to use, open questions |
| `facts.md` | What was checked, and how: behaviour, provider support, differences between languages |
| `code.md` | Every code example, in all six languages, as run (generated; do not edit) |
| recordings | Real model answers, in `src/data/<page>-captures.json`, written by `scripts/capture-<page>.py` |

## For a maintainer

- Code: the recipes live in `src/data/tour-examples.ts`; `npm run
  test:docs-examples` runs them in six languages, `tests/docs_example_widths.test.ts`
  checks they fit their boxes. After changing them:
  `node --experimental-strip-types scripts/docs-assets-code.ts <pack> <prefix>`.
- Recordings: rerun the pack's capture script (its docstring says how), then
  its `tests/*_captures.test.ts`. New recordings mean the brief's quoted
  answers may no longer match: update them.
