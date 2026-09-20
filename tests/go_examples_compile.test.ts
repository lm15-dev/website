/** Explicit native check: requires Go and the sibling SDK checkout; not part of npm test. */
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { goExamples } from "./support/go-examples.ts";

test("Go displayed programs compile against the SDK without executing provider calls", { timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "lm15-go-examples-"));
  const sdk = resolve(process.env["LM15_GO_DIR"] ?? "../lm15-go");
  try {
    writeFileSync(join(dir, "go.mod"), `module example.test/playground\n\ngo 1.26\n\nrequire github.com/lm15-dev/lm15-go v0.0.0\nreplace github.com/lm15-dev/lm15-go => ${sdk}\n`);
    for (const [index, example] of goExamples().entries()) {
      const path = join(dir, `case${index}`); mkdirSync(path);
      writeFileSync(join(path, "main.go"), example.source);
    }
    execFileSync("go", ["test", "-mod=mod", "./..."], { cwd: dir, stdio: "pipe", timeout: 110_000 }); // main is never invoked
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
