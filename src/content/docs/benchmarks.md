---
title: "Benchmarks"
description: What the LM15 benchmarks measure, how, and where to find the results and raw data for each language.
---

The charts on the homepage come from the measurements on these pages. Each
language has its own page, with the method, the machine, every raw sample, and
the files needed to run the measurement again.

| Language | What is measured | Compared with |
| --- | --- | --- |
| [Python](/docs/benchmarks/python/) | Installed size, dependencies, import time, memory after import | LiteLLM, Google GenAI, OpenAI, Anthropic |
| [TypeScript on Node.js](/docs/benchmarks/node/) | Installed size, dependencies, import time, memory after import | Vercel AI SDK, Google GenAI, OpenAI, Anthropic |
| [Rust](/docs/benchmarks/rust/) | Program size, clean build time, local request time, memory | async-openai, genai, Rig |
| [Go](/docs/benchmarks/go/) | Program size, clean build time, local request time, memory | OpenAI, Anthropic, Google GenAI |

R and Julia have not been measured yet. Their homepage charts are labelled as
illustrative and do not show real results.

## What these numbers do and don't tell you

They measure the cost of **the library itself**: how much it adds to your
install, how long it takes to load, and, for Rust and Go, how much time it adds
to a request answered by a local test server. No real model is called, so they
say nothing about how fast a model answers or how long the network takes.

The libraries do different amounts of work. A smaller or faster library does
not necessarily support the same features. Check [feature coverage](/compatibility/)
for what each one supports.

Compare bars within one language only. Python import time and Rust request
time measure different things.

## How they were run

Every measurement ran on the same server. Each process was pinned to one CPU
core, with no internet access and no real API keys. Each library ran in 40
fresh processes (Rust and Go builds: 5 clean builds each), and the pages report
the median. The pages also
give the middle 50% of results, so you can see how much runs varied.
Nothing was dropped. A failed build or a wrong answer stops the results from
being published at all.

Each page lists the exact versions measured, the date, and the scripts used.
The results apply to those versions only.
