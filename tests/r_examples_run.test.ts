/**
 * Explicit native check (requires Nix and the sibling lm15-r checkout; not
 * part of `npm test`): every R program the playground shows parses, and each
 * snapshot and Judge program, run up to its one network call, builds exactly
 * the request the page sends (compared as parsed JSON, as for Go).
 *
 *   node --experimental-strip-types --test tests/r_examples_run.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { stringifyJson } from "@lm15/lm15/browser";
import { DEFAULT_SETTINGS, exampleR } from "../src/playground/experience.ts";
import { rExamples, rStories } from "./support/r-examples.ts";

/** The program up to its call: the line that sends (`response <- ...`) and all after it become a dump of the request. */
function dumped(source: string): string {
  const at = source.indexOf("\nresponse <- ");
  assert.ok(at > 0, "the program's call was not found");
  return `${source.slice(0, at)}\ncat(lm15::as_json(req), "\\n")\n`;
}
const literal = (text: string) => JSON.stringify(text);

test("R displayed programs parse, and build the page's request without calling a provider", { timeout: 600_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "lm15-r-examples-"));
  const sdk = resolve(process.env["LM15_R_DIR"] ?? "../lm15-r");
  try {
    const stories = rStories();
    const examples = rExamples();
    // One R process: each program parses on its own and runs in its own environment.
    const script = [
      'suppressMessages(library(lm15))',
      ...stories.map((source, i) => `invisible(parse(text = ${literal(source)}, keep.source = FALSE)) # story ${i}`),
      ...examples.flatMap((example, i) => [
        `invisible(parse(text = ${literal(example.source)}, keep.source = FALSE))`,
        `cat("<<case ${i}>>")`,
        `local(eval(parse(text = ${literal(dumped(example.source))})))`,
      ]),
    ].join("\n");
    writeFileSync(join(dir, "run.R"), script);
    const lib = join(dir, "lib");
    const out = execFileSync("nix", ["develop", sdk, "-c", "bash", "-c", `mkdir -p ${lib} && R CMD INSTALL --no-test-load --library=${lib} . >/dev/null 2>&1 && R_LIBS=${lib} Rscript --vanilla ${join(dir, "run.R")}`], { cwd: sdk, encoding: "utf-8", timeout: 580_000, maxBuffer: 64 * 1024 * 1024 });
    const built = out.split(/<<case \d+>>/).slice(1).map((text) => text.trim());
    assert.equal(built.length, examples.length, "every program ran");
    for (const [i, example] of examples.entries()) {
      assert.deepEqual(JSON.parse(built[i]!), JSON.parse(stringifyJson(example.canonical as Parameters<typeof stringifyJson>[0])), `case ${i}: the shown R program builds the request the page sends\n${example.source}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("R cannot hold a NUL: the panel says so instead of showing code that would not parse", () => {
  assert.throws(() => exampleR({ provider: "openai", model: "gpt-5-mini", endpoint: "" }, DEFAULT_SETTINGS, [], "a\u0000b"), /NUL character/);
});
