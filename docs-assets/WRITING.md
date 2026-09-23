# Writing a page of the LM15 docs

You are writing one page of the LM15 documentation, from an asset pack in this
folder (`docs-assets/<page>/`). The pack holds everything that had to be run:
code already written and run in six languages, real model answers, checked
facts. Your job is the explanation around them.

Several writers will draft the same page from the same pack; the drafts are
compared and merged. Write the page you think is best. Do not hedge between
options: choose, and say in `NOTES.md` what you chose and why.

## The model: ggplot2

Our model for teaching is the ggplot2 documentation: the book
*ggplot2: Elegant Graphics for Data Analysis* (Wickham, Navarro, Pedersen,
<https://ggplot2-book.org/>) and the package site
(<https://ggplot2.tidyverse.org/>). Read at least the chapter
[First steps](https://ggplot2-book.org/getting-started.html) and the site's
[Get started](https://ggplot2.tidyverse.org/articles/ggplot2.html) before
writing. The finished LM15 pages are listed at the end of this guide as what
exists, not as the style to copy: they were drafted by an AI, and ggplot2 is
the standard.

What ggplot2 does, and what we take from it:

**1. It says what the page is for, then what you will learn.** *First steps*
opens: "The goal of this chapter is to teach you how to produce useful graphics
with ggplot2 as quickly as possible. [...] Here we'll skip the theory and focus
on the practice", followed by "In this chapter you'll learn:" and a list. A
reader knows in ten seconds whether this is their page.

**2. One running example, introduced once, used throughout.** *First steps*
uses one dataset (`mpg`), shows it, explains its columns in plain words, and
asks questions of it: "How are engine size and fuel economy related? Do
certain manufacturers care more about fuel economy than others?" You learn the
tool while answering questions you now care about. The same dataset appears on
the package's home page, in *Get started*, in the reference, and in the FAQ.

Ours is a **field assistant for a wildlife research station**. The story so
far is in the next section. Use it; do not invent a new example.

**3. Name the parts, then label the example with them.** "Every ggplot2 plot
has three key components: data, a set of aesthetic mappings [...], and at
least one layer." Then the smallest example, then which part of the code is
which component. Then: "Pay attention to the structure of this function call
[...] This is an important pattern."

**4. Change one thing at a time, and show the result every time.** Colour,
then facets, then a smoother, each a small change to the previous code, each
followed by its picture. Our "picture" is the model's real answer, which the
pack provides.

**5. Read the result back to the reader.** After a plot: "The plot shows a
strong correlation: as the engine size gets bigger, the fuel economy gets
worse. There are also some interesting outliers [...] What sort of cars do you
think they are?" The next step then answers the question. Don't show an answer
and move on: say what it shows.

**6. Put near-identical versions side by side.**
`geom_point(aes(colour = "blue"))` next to `geom_point(colour = "blue")`, then
why they differ. Our packs often include a deliberate mistake with its real
result (a vague tool description, a missing piece of conversation). These are
the most valuable parts of a page. Keep them.

**7. Be opinionated, and warn about real traps.** "When using aesthetics in a
plot, less is usually more." "We think it's even better to use `geom_point()`."
"It is very important to experiment with the bin width." Say what to do; say
what goes wrong if you don't.

**8. Point ahead instead of teaching everything.** "You'll learn how to
override them in Chapter 11." "For now, we'll stick with the default scales."
A page teaches its one thing; the rest is a link.

**9. Explain words in place, once.** "Geometric elements, geoms for short,
represent what you actually see in the plot." No glossary, no term used before
it is explained.

**10. Exercises that ask the reader to predict.** "See if you can predict what
the plot will look like before running the code." Ours go at the end of a
guide, with expected answers hidden in a `<details>` block.

**11. Reassure where it is hard.** "Don't worry if it doesn't make sense right
away: you'll have many more opportunities to learn about the components."

**The reference is different** (not your job here, but know the difference):
ggplot2's reference page for `geom_point()` opens with two sentences on what
it is for and when to use something else, then usage, arguments, one section
on a common problem ("Overplotting"), and examples each preceded by a comment
saying why it is there. A guide teaches; a reference is looked up. Link to
the reference rather than list every option in a guide.

### How to open a page

The opening is the most important part of a page. ggplot2's companion book,
*R for Data Science* (Wickham, Çetinkaya-Rundel, Grolemund,
<https://r4ds.hadley.nz/>), opens every chapter the same way, and so do we:

1. **A sentence that is true about the reader's work, with a tension in it.**
   It says why the topic matters before naming it.
   - "Visualization is an important tool for generating insight, but it's rare
     that you get the data in exactly the right form you need to make the
     graph you want." (*Data transformation*)
   - "Working with data provided by R packages is a great way to learn data
     science tools, but you want to apply what you've learned to your own data
     at some point." (*Data import*)
   - "One of the best ways to improve your reach as a data scientist is to
     write functions." (*Functions*)
2. **One plain sentence naming the tool and what it does.** "In this chapter,
   you will learn a consistent way to organize your data in R using a system
   called tidy data."
3. **The route, as prose.** "We'll start by…, then…, next… We'll finish
   with…". A reader sees the whole page in four sentences.
4. **Prerequisites,** briefly: what the page builds on, where the answers come
   from.

Don't open inside the story ("Observers at our station don't write rows"): the
story comes after the reader knows why they are reading. Don't open with
"In this guide" or "The goal of this page" unless the next words say something
worth reading.

Examples on our site: `structured-output.mdx` ("Language models are good at
reading text written for people… The trouble is that their answers are written
for people too.") and `function-tools.mdx` ("A model knows a lot, but it knows
nothing about your data.").

### Voice

Write like *R for Data Science* and the ggplot2 book: calm, expository,
confident, warm. Read two chapters of either before you start.

- Talk to the reader as "you"; the authors are "we". Use contractions.
- Explain in full sentences that follow from each other. Let the example carry
  the surprise; state the lesson plainly: "This is a subtle but important
  problem." "A good rule of thumb is…" "It's important to remember that…"
- Key ideas as crisp rules, the way *Data tidying* defines tidy data: "Each
  variable is a column; each column is a variable."
- A little warmth is welcome ("a bit of a mouthful", "(and more!)"); cleverness
  isn't.
- The reader knows their programming language. They do not know LM15, and may
  be new to language-model APIs. A curious sixteen-year-old who can code must
  be able to follow.
- Spelling: American English.
- No marketing words: never "powerful", "seamless", "robust", "simply",
  "just", "easy". Show instead.

**The habits that make text sound machine-written.** Our first drafts had all
of these; the R4DS and ggplot2 books have none:

- dramatic fragments: "Nothing failed." "Exactly the shape we described."
  "Not roe, not fallow.";
- slogans in bold, and aphorisms: "A form with no honest box gets filled in
  anyway." "A field that must be filled will be filled.";
- stage directions: "Look again.", "Notice what's missing:", "Keep an eye on
  those details.", "Hold that thought.";
- "This isn't X. It's Y." and "Not A, but B" constructions;
- a colon in every other sentence, and lists of three for rhythm;
- "Let's dive in", "In this section, we'll explore", summaries that repeat
  the page, rhetorical "Why does this matter?".

## The station, so far

Every page adds one ability to the same small program.

| Page | What the station's assistant learns |
|---|---|
| Overview | The parts of a request; the assistant's instructions and its tool |
| Make your first request | Answers "What might be eating the acorns under our oak trees at night?"; follows up with "Would the same animals eat hazelnuts?" |
| Call your own functions | Searches the station's four recorded sightings (`search_sightings`) |
| Ask for judgments | Scores an observer's field note: identification certainty, behaviour, a juvenile present |
| *next pages* | Each pack's brief says what this page adds |

Shared wording lives in `src/data/tour-text.json` (the instructions, the
questions, the tool, the four sightings). Reuse it exactly.

## Rules that are not negotiable

1. **Code comes from the pack, unchanged.** It has been run in all six
   languages and checked against the provider. If you think the code should
   be different, say so in `NOTES.md`; do not edit it in the page.
2. **Model answers come from the pack's recordings, unchanged,** and are
   labelled with the model and the date (the page's components do this).
   Never invent an answer, a number, a token count or an error message. If
   you want to show something the pack doesn't have, ask for it in
   `NOTES.md`.
3. **The explanation is true in every language.** The reader picks Python,
   TypeScript, Rust, Go, R or Julia; the code changes, your text does not.
   Don't name a function in prose (`response.text`) unless it is spelled the
   same way everywhere; describe it ("the answer's text") instead. When a
   language really differs, say so once, plainly.
4. **Don't overclaim.** A feature LM15 carries still needs a provider and
   model that support it. The pack's facts say which do. "LM15 refuses rather
   than guess" is our rule; describe it, don't sell it.
5. **Link only to pages that exist.** Unfinished pages are hidden and their
   links are removed automatically, so a link to a planned page is fine, but
   never to an external guess.
6. **Every recorded answer you show, you explain.** If you show it, say what
   it shows.

## Format

- The page is an MDX file: `src/content/docs/docs/<page>.mdx`. Front matter:
  `title` (the task, as the menu says it) and `description` (one sentence, for
  search results).
- Code: `<DocsExample recipe="…" />`, with the recipe names in the pack.
- Recorded answers: the components and step names in the pack's `README.md`.
- Headings are tasks or questions, short: "Ask a follow-up", "Describe the
  inputs". Not "Overview of X".
- Length: as long as the page needs. *First steps* is long; each section is
  short.
- Order, unless the brief says otherwise: purpose and "on this page you'll";
  the steps, each with code and a real answer; mistakes and limits; "Try it
  yourself" (predict, then run; answers hidden); "Next".

## What to hand back

- The page (`<page>.mdx`).
- `NOTES.md`: what you chose and why, anything you think is wrong in the
  pack, anything you wanted and didn't have.

## What exists (for reference, not as a model)

- `src/content/docs/docs/index.mdx` (Overview)
- `src/content/docs/docs/first-request.mdx`
- `src/content/docs/docs/function-tools.mdx`
- `src/content/docs/docs/judgments.md`

Read them to know what the reader has already learned. Do not copy their
phrasing.
