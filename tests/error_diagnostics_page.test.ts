/** Test the shipped SDKs and actual UI with intercepted replies; no real credentials or inference. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { startDemo } from "../scripts/serve-playground.ts";
import { findBrowsers } from "./support/browser.ts";
import { disableDiscovery, useKey, waitKeyState, waitRuntimeReady } from "./support/playground.ts";

test("playground shows rate-limit diagnostics in all four runtimes, including HTTP-200 stream failures", { timeout: 240_000 }, async (t) => {
  const installed = findBrowsers().find(b => b.name === "chromium");
  assert.ok(installed, "Chromium is required");
  const demo = await startDemo();
  t.after(async () => {
    demo.server.closeAllConnections();
    await new Promise<void>(resolve => demo.server.close(() => resolve()));
  });
  const url = process.env["SITE_URL"] ? new URL("/playground/", process.env["SITE_URL"]).href : demo.url;
  const origin = new URL(url).origin;
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage();
  const key = "dummy-diagnostics-key";
  let streaming = false;
  let calls = 0;
  await page.route("**/*", async route => {
    const target = new URL(route.request().url());
    if (target.origin === origin) return route.continue();
    assert.equal(target.href, "https://api.openai.com/v1/responses", "No other external requests allowed");
    calls++;
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-expose-headers": "retry-after,apim-request-id,x-ratelimit-limit-requests,x-ratelimit-remaining-requests,x-ratelimit-reset-requests",
      "retry-after": "39", "apim-request-id": "request-playground-test",
      "x-ratelimit-limit-requests": "1", "x-ratelimit-remaining-requests": "-1", "x-ratelimit-reset-requests": "105",
    };
    const error = { code: "no_capacity", type: "too_many_requests", message: `busy ${key}` };
    if (streaming) return route.fulfill({ status: 200, headers, contentType: "text/event-stream", body: `event: error\ndata: ${JSON.stringify({ type: "error", error })}\n\n` });
    return route.fulfill({ status: 429, headers, json: { error } });
  });
  try {
    await page.goto(url);
    await waitKeyState(page, "");
    await disableDiscovery(page);
    await useKey(page, "OpenAI", key);
    for (const language of ["JavaScript", "Python", "Rust", "Go"]) {
      await page.getByRole("button", { name: language, exact: true }).click();
      await waitRuntimeReady(page, language);
      for (const stream of [false, true]) {
        streaming = stream;
        await page.getByLabel("Message", { exact: true }).fill(`diagnostic test ${language} ${stream}`);
        await page.getByRole("button", { name: "Send", exact: true }).click();
        try {
          await page.waitForFunction(() => (document.getElementById("alert")?.textContent ?? "").includes("request-playground-test"));
        } catch (error) {
          assert.fail(`${language} stream=${stream}, calls=${calls}: ${await page.locator("#alert").textContent()} (${String(error)})`);
        }
        const shown = await page.locator("#alert").textContent() ?? "";
        assert.match(shown, /RateLimitError/);
        assert.match(shown, /Retry advice: 39|retry_after=39s/, `${language}: its SDK's retry advice remains visible`);
        assert.match(shown, /x-ratelimit-remaining-requests/);
        assert.match(shown, /105/);
        assert.ok(!shown.includes(key), "Saved credentials are redacted after formatting");
        assert.ok(!shown.includes("Traceback"), "Python stack frames are not shown");
      }
    }
    assert.equal(calls, 8, "Exactly one call per submission; no automatic retries");
  } finally {
    await browser.close();
  }
});
