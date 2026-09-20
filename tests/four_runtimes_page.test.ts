/** Real packaged wasm runtimes; every provider request is intercepted, with dummy keys only. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { startDemo } from "../scripts/serve-playground.ts";
import { findBrowsers } from "./support/browser.ts";
import { disableDiscovery, waitRuntimeReady } from "./support/playground.ts";
import { judgeReplyFor, streamFor } from "./support/replies.ts";

for (const language of ["rust", "go"] as const) test(`${language}: lazy boot, real wire preview, stream, TypeSafe Judge, diagnostic failure and cancellation`, { timeout: 180_000 }, async (t) => {
  const installed = findBrowsers().find((b) => b.name === "chromium"); assert.ok(installed);
  const demo = await startDemo();
  t.after(() => { demo.server.closeAllConnections(); return new Promise<void>((resolve) => demo.server.close(() => resolve())); });
  const browser = await chromium.launch({ executablePath: installed.bin }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const origin = new URL(demo.url).origin;
  const calls: Array<{ url: string; body: Record<string, unknown>; raw: string }> = [];
  const assets: string[] = [];
  const errors: string[] = [];
  let mode: "ok" | "fail" | "hold" = "ok";
  let release: (() => void) | undefined;
  let firstWasm = true;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === origin) {
      assets.push(url.pathname);
      if (firstWasm && url.pathname.endsWith(language === "go" ? "/vendor/go/lm15-go.wasm" : "/vendor/rust/lm15.wasm")) {
        firstWasm = false;
        return route.fulfill({ status: 503, body: "offline boot failure" });
      }
      return route.continue();
    }
    if (!url.href.includes("/responses") && !url.href.includes("/systemone")) return route.abort();
    calls.push({ url: url.href, body: request.postDataJSON() as Record<string, unknown>, raw: request.postData() ?? "" });
    if (mode === "hold") { await new Promise<void>((resolve) => { release = resolve; }); return route.abort().catch(() => {}); }
    if (mode === "fail") return route.fulfill({ status: 429, headers: { "content-type": "application/json", "x-request-id": "req-four-runtime", "retry-after": "2", "access-control-expose-headers": "x-request-id,retry-after" }, body: JSON.stringify({ error: { message: "offline quota", type: "rate_limit_error" } }) });
    if (url.href.includes("/systemone")) {
      const reply = judgeReplyFor(url.href);
      return route.fulfill({ status: 200, contentType: "application/json", body: await reply.text() });
    }
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: streamFor(url.href, "Hello 🍷 from wasm") });
  });
  t.after(() => release?.());
  await page.goto(demo.url); await disableDiscovery(page);
  assert.equal(await page.locator("[data-language]").count(), 4);
  assert.equal(assets.some((path) => path.includes("/vendor/go/") || path.includes("/vendor/rust/")), false);
  await page.getByLabel("API key", { exact: true }).fill("offline-dummy-key");
  await page.getByRole("button", { name: "Use key for this provider" }).click();
  await page.locator(`[data-language="${language}"]`).click();
  await page.waitForFunction(() => document.getElementById("runtime-status")?.textContent?.includes("Could not load"));
  await page.locator("#retry-runtime").click();
  await waitRuntimeReady(page, language);
  if (language === "go") assert.equal(assets.filter((path) => path.endsWith("/vendor/go/wasm_exec.js")).length, 1, "retry reuses one Go support script");
  await page.getByRole("button", { name: "Request", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.startsWith("Built by"));
  const preview = await page.locator("#code").textContent() ?? "";
  const expected = JSON.parse(preview.slice(preview.indexOf("\n\n{" ) + 2));
  assert.equal(calls.length, 0, "wire preview sends nothing");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("transcript")?.textContent?.includes("Hello 🍷 from wasm"));
  await waitRuntimeReady(page, language);
  assert.deepEqual(calls[0]!.body, expected);
  assert.equal(calls[0]!.body["stream"], true);

  await page.getByRole("button", { name: "Judge", exact: true }).click();
  await page.getByLabel("API key", { exact: true }).fill("offline-jev-key");
  await page.getByRole("button", { name: "Use key for this provider" }).click();
  await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.includes("for input 1"));
  const judgePreview = await page.locator("#code").textContent() ?? "";
  const judgeExpected = JSON.parse(judgePreview.slice(judgePreview.indexOf("\n\n{") + 2));
  await page.getByRole("button", { name: "Run all", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("judge-out-count")?.textContent === "3 of 3 judged");
  assert.equal(calls.length, 4, "one chat HTTP exchange plus one complete per judged input");
  assert.deepEqual(calls[1]!.body, judgeExpected);
  assert.ok(calls.slice(1).every((call) => !("stream" in call.body)));
  assert.match(await page.locator("#judge-results").textContent() ?? await page.locator("body").textContent() ?? "", new RegExp(language, "i"));

  await page.getByRole("button", { name: "Chat", exact: true }).click();
  mode = "fail";
  await page.locator("#prompt").fill("offline error");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("offline quota"));
  assert.match(await page.locator("body").textContent() ?? "", /req-four-runtime/);
  mode = "hold";
  await page.locator("#prompt").fill("cancel me");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await page.locator("#stop").isEnabled(), true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await waitRuntimeReady(page, language);
  release?.();
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-view-target="code"]').click();
  assert.equal(await page.locator('[data-language="go"]').isVisible(), true);
  await page.locator(`[data-language="${language}"]`).press("End");
  await waitRuntimeReady(page, "go");
  assert.equal(await page.evaluate(() => localStorage.getItem("lm15.playground.runtime")), "go");
});
