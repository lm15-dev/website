/**
 * Explicit native check (requires Go and the sibling SDK checkout; not part of
 * `npm test`): every Go program the page shows compiles against the SDK, and,
 * run with the one network call swapped for a dump, builds exactly the request
 * the page sends. `go vet` is not run: the dump leaves the call unreachable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { stringifyJson } from "lm15/browser";
import { goExamples, goStories } from "./support/go-examples.ts";

/** The program with `return dump(request)` after the request is built: nothing after it runs, so no provider is called. */
function dumped(source: string): string {
  const at = source.indexOf("lm15.NewRequest(");
  assert.ok(at > 0);
  const tail = source.slice(at).replace(/(\n( +)\)\n\2if err != nil \{ return err \}\n)/, "$1$2return dump(lm, request)\n");
  assert.notEqual(tail, source.slice(at), "the request's error check was not found");
  return source.slice(0, at).replace('    "fmt"\n', '    "encoding/json"\n    "fmt"\n').replace('    "encoding/json"\n    "encoding/json"\n', '    "encoding/json"\n') + tail
    + "\n\nfunc dump(lm lm15.LM, request *lm15.Request) error {\n    _ = lm\n    b, err := json.Marshal(request)\n    if err != nil { return err }\n    fmt.Println(string(b))\n    return nil\n}\n";
}

test("Go displayed programs compile against the SDK and build the page's request without calling a provider", { timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "lm15-go-examples-"));
  const sdk = resolve(process.env["LM15_GO_DIR"] ?? "../lm15-go");
  try {
    writeFileSync(join(dir, "go.mod"), `module example.test/playground\n\ngo 1.26\n\nrequire github.com/lm15-dev/lm15-go v0.0.0\nreplace github.com/lm15-dev/lm15-go => ${sdk}\n`);
    const examples = goExamples();
    for (const [index, example] of examples.entries()) {
      const path = join(dir, `case${index}`); mkdirSync(path);
      writeFileSync(join(path, "main.go"), example.source);
      const run = join(dir, `run${index}`); mkdirSync(run);
      writeFileSync(join(run, "main.go"), dumped(example.source));
    }
    for (const [index, source] of goStories().entries()) { const path = join(dir, `story${index}`); mkdirSync(path); writeFileSync(join(path, "main.go"), source); }
    execFileSync("go", ["build", "-mod=mod", "./..."], { cwd: dir, stdio: "pipe", timeout: 200_000 }); // main is never invoked
    for (const [index, example] of examples.entries()) {
      const out = execFileSync("go", ["run", "-mod=mod", `./run${index}`], { cwd: dir, stdio: "pipe", timeout: 60_000, encoding: "utf-8" });
      assert.deepEqual(JSON.parse(out.trim()), JSON.parse(stringifyJson(example.canonical[0] as Parameters<typeof stringifyJson>[0])), `case ${index}: the shown Go program builds the request the page sends`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
