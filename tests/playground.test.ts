/** Provider-neutral UI and private credential handoff. Only dummy keys and intercepted traffic. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { CONNECTIONS } from "../src/playground/connections.ts";
import { DEFAULT_SETTINGS, EXAMPLE_API_KEY, EXAMPLE_ANSWER, EXAMPLE_DRAFT, EXAMPLE_QUESTION } from "../src/playground/experience.ts";
import { startDemo } from "../scripts/serve-playground.ts";
import { findBrowsers } from "./support/browser.ts";
import { closePicker, disableDiscovery, focusSettings, forgetKey, keyState, openMore, openProviders, useKey, waitKeyState, waitRuntimeReady } from "./support/playground.ts";

const choices = CONNECTIONS.filter((c) => c.env);
const key = (id: string) => `dummy-${id}-key`;
async function fixture(run: (envFile: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "lm15-provider-ui-"));
  try {
    const file = join(dir, ".env");
    writeFileSync(file, choices.map((c) => `export ${c.env}="${key(c.id)}"`).join("\n") + '\nUNRELATED_PASSWORD="never-transfer"\n', { mode: 0o600 });
    await run(file);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function close(server: Awaited<ReturnType<typeof startDemo>>["server"]) {
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close((e) => e ? reject(e) : done()));
}

test("private test keys require an opted-in, same-origin, one-use capability; files are not exposed", async () => {
  await fixture(async (envFile) => {
    const demo = await startDemo({ envFile });
    try {
      const url = new URL("/__lm15_test_credentials", demo.url);
      const token = new URLSearchParams(new URL(demo.browserUrl).hash.slice(1)).get("local-test")!;
      const headers = { "X-LM15-Test-Token": token };
      assert.equal((await fetch(url)).status, 403);
      assert.equal((await fetch(url, { headers: { ...headers, Origin: "https://other.example" } })).status, 403);
      const wrongHostStatus = await new Promise<number | undefined>((done, reject) => {
        const req = httpRequest(url, { headers: { ...headers, Host: "other.example" } }, (res) => { res.resume(); done(res.statusCode); });
        req.on("error", reject); req.end();
      });
      assert.equal(wrongHostStatus, 403);
      assert.equal((await fetch(url, { headers: { "X-LM15-Test-Token": "é".repeat(token.length) } })).status, 403);
      assert.equal((await fetch(new URL("/.env", demo.url))).status, 404);
      assert.equal((await fetch(new URL("/package.json", demo.url))).status, 404);
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.deepEqual(await response.json(), Object.fromEntries(choices.map((c) => [c.id, key(c.id)])));
      assert.equal((await fetch(url, { headers })).status, 403);
    } finally { await close(demo.server); }
    const plain = await startDemo();
    try {
      assert.equal(plain.browserUrl, plain.url);
      assert.equal((await fetch(new URL("/__lm15_test_credentials", plain.url))).status, 403);
    } finally { await close(plain.server); }
  });
});

test("discovery failures and stale provider replies cannot block manual model selection or leak into the new connection", { timeout: 60_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  await fixture(async (envFile) => {
    const demo = await startDemo({ envFile });
    const browser = await chromium.launch({ executablePath: installed.bin });
    const page = await browser.newPage();
    let release = () => {};
    const delayed = new Promise<void>((done) => { release = done; });
    let signalStarted = () => {};
    const started = new Promise<void>((done) => { signalStarted = done; });
    let lists = 0;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(demo.url).origin) return route.continue();
      assert.equal(route.request().method(), "GET", "Commands and discovery must never infer");
      lists++;
      if (url.hostname === "api.openai.com") {
        signalStarted(); await delayed;
        return route.fulfill({ json: { data: [{ id: "stale-openai-model" }] } });
      }
      return route.fulfill({ status: 503, json: { error: { message: "Test discovery failure" } } });
    });
    try {
      await page.goto(demo.browserUrl);
      await started;
      await page.getByLabel("Message", { exact: true }).fill("/provider anth");
      await page.getByLabel("Message", { exact: true }).press("Enter");
      await page.waitForFunction(() => document.getElementById("model-status")?.textContent?.startsWith("Model discovery failed"));
      await page.getByLabel("Message", { exact: true }).fill("/model manual-model");
      await page.getByLabel("Message", { exact: true }).press("Enter");
      assert.equal(await page.locator("#model-name").textContent(), "manual-model");
      const replied = page.waitForResponse((response) => new URL(response.url()).hostname === "api.openai.com");
      release(); await replied;
      await page.getByRole("button", { name: "Choose model", exact: true }).click();
      assert.match(await page.locator("#picker-status").textContent() ?? "", /Model discovery failed/);
      assert.equal(await page.locator("#picker-results").getByText("stale-openai-model", { exact: true }).count(), 0);
      await page.getByRole("combobox", { name: "Search choices" }).press("Escape");
      await disableDiscovery(page);
      await page.getByLabel("Message", { exact: true }).fill("/provider groq");
      await page.getByLabel("Message", { exact: true }).press("Enter");
      await page.getByRole("button", { name: "Choose model", exact: true }).click();
      await page.getByRole("combobox", { name: "Search choices" }).fill("custom-on-groq");
      await page.getByRole("combobox", { name: "Search choices" }).press("Enter");
      assert.equal(lists, 2, "Discovery stays off while typing and picking");
      await page.getByLabel("Message", { exact: true }).fill("Keep this draft");
      await page.getByRole("button", { name: "Choose provider", exact: true }).click();
      await page.getByRole("combobox", { name: "Search choices" }).press("ArrowDown");
      await page.getByRole("combobox", { name: "Search choices" }).press("Escape");
      assert.equal(await page.getByLabel("Message", { exact: true }).inputValue(), "Keep this draft");
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal page overflow on mobile");
    } finally { release(); await browser.close(); await close(demo.server); }
  });
});

function sse(url: URL): string {
  let frames: unknown[];
  if (url.pathname.endsWith("/responses")) {
    frames = [
      { type: "response.created", response: { id: "r", model: "test-model" } },
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.completed", response: { id: "r", status: "completed", output: [], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } },
    ];
  } else if (url.pathname.endsWith("/messages")) {
    frames = [
      { type: "message_start", message: { id: "r", model: "test-model", usage: { input_tokens: 2 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ];
  } else if (url.pathname.includes("streamGenerateContent")) {
    frames = [{ candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } }];
  } else {
    assert.ok(url.pathname.endsWith("/chat/completions"));
    frames = [
      { id: "r", model: "test-model", choices: [{ delta: { role: "assistant", content: "Hello" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
    ];
  }
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

/** TypeSafe answers the example's one judgment over the state. */
const JEV_ANSWER = { model: "jev-test", answers: { quality: { type: "score", probabilities: { "0": 0, "1": 0, "2": 0.1, "3": 0.8, "4": 0.1 } } }, usage: { input_tokens: 40, output_tokens: 9 } };

test("ten local keys load privately; each provider receives only its key; manual keys, clearing, and reload work", { timeout: 120_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed, "Put Chromium on PATH to run browser tests");
  await fixture(async (envFile) => {
    const demo = await startDemo({ envFile });
    const browser = await chromium.launch({ executablePath: installed.bin });
    const page = await browser.newPage();
    const origin = new URL(demo.url).origin;
    let selected = "openai";
    let expectedKey = key(selected);
    let sent = 0;
    let modelLists = 0;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      const headers = request.headers();
      const credential = headers["authorization"]?.replace(/^Bearer /, "") ?? headers["x-api-key"] ?? headers["x-goog-api-key"] ?? url.searchParams.get("key");
      assert.equal(credential, expectedKey);
      if (selected === "anthropic") assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
      if (request.method() === "GET") {
        modelLists++;
        // Gemini lists `models/<id>` and strips the prefix; TypeSafe lists bare names.
        const names = url.hostname === "api.typesafe.ai" ? [{ name: "model-one" }, { name: "model-two" }] : [{ name: "models/model-one" }, { name: "models/model-two" }];
        return route.fulfill({ json: { data: [{ id: "model-one" }, { id: "model-two" }], models: names }, headers: { "Access-Control-Allow-Origin": origin } });
      }
      sent++;
      if (url.pathname.endsWith("/v1/systemone")) return route.fulfill({ json: JEV_ANSWER, headers: { "Access-Control-Allow-Origin": origin } });
      return route.fulfill({ contentType: "text/event-stream", body: sse(url), headers: { "Access-Control-Allow-Origin": origin } });
    });
    try {
      await page.goto(demo.browserUrl);
      await page.waitForFunction(() => document.getElementById("loaded")?.textContent?.includes("Moonshot"));
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(sent, 0, "Loading keys never starts inference");
      await page.waitForFunction(() => document.getElementById("model-status")?.textContent?.includes("model IDs listed"));
      assert.equal(modelLists, 1, "Only the selected connection is discovered");
      assert.equal(await page.locator("#system").isVisible(), true, "the system prompt heads the conversation");
      assert.ok((await page.locator("#code").textContent() ?? "").includes(EXAMPLE_API_KEY));
      await page.emulateMedia({ colorScheme: "light" });
      const readability = await page.evaluate(() => {
        const luminance = (color: string) => {
          const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
        };
        const code = getComputedStyle(document.getElementById("code")!);
        const background = luminance(getComputedStyle(document.querySelector(".code-panel")!).backgroundColor);
        const foreground = luminance(code.color);
        return { size: parseFloat(code.fontSize), background, contrast: (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05) };
      });
      assert.ok(readability.size >= 16, "Code text must not shrink below 16px at default zoom");
      assert.ok(readability.background > 0.9, "Use a light code background in light mode");
      assert.ok(readability.contrast >= 7, "Code text must have at least 7:1 contrast");
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      for (const choice of choices.filter((c) => c.id !== "typesafe")) {
        assert.equal((await page.content()).includes(key(choice.id)), false);
        selected = choice.id; expectedKey = key(selected);
        await page.getByRole("button", { name: "Choose provider", exact: true }).click();
        await page.getByRole("combobox", { name: "Search choices" }).fill(selected);
        await page.getByRole("combobox", { name: "Search choices" }).press("Enter");
        await page.waitForFunction(() => document.getElementById("model-status")?.textContent?.includes("model IDs listed"));
        await page.getByLabel("Message", { exact: true }).fill("Hello");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await page.waitForFunction(() => document.getElementById("usage")?.textContent?.startsWith("stop"));
        assert.equal(await page.locator("#transcript article").last().locator("textarea").inputValue(), "Hello");
      }
      assert.equal(sent, 9);
      const discoveries = modelLists;
      await page.getByLabel("Message", { exact: true }).fill("/model mdltw");
      await page.getByLabel("Message", { exact: true }).press("Enter");
      assert.equal(await page.locator("#model-name").textContent(), "model-two");
      assert.equal(sent, 9, "A slash command is never sent as a message");
      assert.equal(modelLists, discoveries, "Searching models uses the cached list");
      assert.match(await page.locator("#code").textContent() ?? "", /model-two/);
      await page.getByRole("button", { name: "Choose model", exact: true }).click();
      await page.getByRole("combobox", { name: "Search choices" }).fill("my-custom-model-id");
      await page.getByRole("combobox", { name: "Search choices" }).press("Enter");
      assert.equal(await page.locator("#model-name").textContent(), "my-custom-model-id");
      await openMore(page);
      await page.getByRole("button", { name: "Forget all keys" }).click();
      await page.waitForFunction(() => document.getElementById("loaded")?.textContent === "None");
      selected = "openai"; expectedKey = "manual-dummy-key";
      await page.getByLabel("Message", { exact: true }).fill("/provider opnai");
      await page.getByLabel("Message", { exact: true }).press("Enter");
      assert.equal(await page.locator("#provider-name").textContent(), "OpenAI");
      await useKey(page, "OpenAI", expectedKey);
      await waitKeyState(page, "Key ready (this tab)");
      await openProviders(page);
      assert.equal(await page.getByLabel("OpenAI API key", { exact: true }).count(), 0, "a saved key is masked, never shown in a field");
      assert.equal(await page.locator('[data-trailing-for="openai"] .key-mask').textContent(), "••••••••");
      await closePicker(page);
      await page.getByLabel("Message", { exact: true }).fill("Hello");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.waitForFunction(() => document.getElementById("usage")?.textContent?.startsWith("stop"));
      assert.equal(sent, 10);
      // TypeSafe judges only: choosing it from Chat opens Judge, and Chat is closed to it. Its key reaches only it, one call per input.
      selected = "typesafe"; expectedKey = key(selected);
      await page.getByRole("button", { name: "Choose provider", exact: true }).click();
      await page.getByRole("combobox", { name: "Search choices" }).fill("typesafe");
      await page.getByRole("option", { name: /TypeSafe/ }).first().locator(".pick-main").click();
      await page.waitForFunction(() => document.body.dataset.mode === "judge");
      assert.equal(await page.getByRole("button", { name: "Chat", exact: true }).isDisabled(), false, "Chat restores its own model");
      await useKey(page, "TypeSafe (Jev)", expectedKey);
      await waitKeyState(page, "Key ready (this tab)");
      await page.locator("#judge-run").click();
      await page.waitForFunction(() => document.getElementById("judge-usage")?.textContent?.startsWith("judged"));
      assert.equal(sent, 11);
      await page.reload();
      await waitKeyState(page, "");
      assert.equal(await page.locator("#loaded").textContent(), "None");
      assert.deepEqual(errors, []);
    } finally { await browser.close(); await close(demo.server); }
  });
});

/** A streamed reply of the right dialect for the URL: what the fake provider answers every runtime with. */
function replyFor(url: URL): string {
  let frames: unknown[];
  if (url.pathname.endsWith("/responses")) frames = [
    { type: "response.created", response: { id: "r", model: "gpt-4.1-mini" } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hello " },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "there." },
    { type: "response.completed", response: { id: "r", status: "completed", output: [], usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } },
  ];
  else frames = [{ id: "r", model: "m", choices: [{ delta: { role: "assistant", content: "Hello there." } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }];
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + (url.pathname.endsWith("/responses") ? "" : "data: [DONE]\n\n");
}

test("the playground: settings reach the code and the wire; a remembered key survives a reload encrypted; the key page is the registry's", { timeout: 120_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const browser = await chromium.launch({ executablePath: installed.bin });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const bodies: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(demo.url).origin) return route.continue();
    if (route.request().method() === "POST") bodies.push(route.request().postData() ?? "");
    return route.fulfill({ contentType: "text/event-stream", body: replyFor(url), headers: { "Access-Control-Allow-Origin": new URL(demo.url).origin } });
  });
  try {
    await page.goto(demo.url);
    await disableDiscovery(page);
    await openProviders(page);
    assert.equal(await page.locator('[data-trailing-for="openai"] a').getAttribute("href"), "https://platform.openai.com/api-keys", "the key page comes from the registry");
    await useKey(page, "OpenAI", "dummy-openai-key", { remember: true });
    await focusSettings(page);
    await page.getByLabel("System prompt").fill("Answer briefly.");
    await page.getByLabel("Max tokens").fill("64");
    await page.getByLabel("Reasoning effort").selectOption("low");
    // The panel shows the conversation as a person writes it: settings as variables, one `ask` per turn (story.ts).
    for (const [tab, expected] of [["JavaScript", /const system = "Answer briefly\.";[\s\S]*maxTokens: 64[\s\S]*reasoning: \{ effort: "low" \}[\s\S]*await ask\(/], ["Python", /system = "Answer briefly\."[\s\S]*Config\(max_tokens=64, reasoning=Reasoning\(effort="low"\)\)[\s\S]*await ask\(/], ["Rust", /system: Some\("Answer briefly\."\.into\(\)\)[\s\S]*Reasoning::new\("low"\.parse\(\)\?\)[\s\S]*ask\(&lm, &mut messages, /]] as const) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await waitRuntimeReady(page, tab);
      await page.waitForFunction((pattern) => new RegExp(pattern, "s").test(document.getElementById("code")?.textContent ?? ""), expected.source);
      assert.ok(!(await page.locator("#code").textContent())!.includes("dummy-openai-key"), `${tab}: the key never appears in the code panel`);
    }
    await page.getByLabel("Message", { exact: true }).fill("hello");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("usage")?.textContent?.startsWith("stop"));
    assert.equal(bodies.length, 1);
    const sent = JSON.parse(bodies[0]!) as { instructions: string; max_output_tokens: number; reasoning: { effort: string } };
    assert.equal(sent.instructions, "Answer briefly.");
    assert.equal(sent.max_output_tokens, 64);
    assert.equal(sent.reasoning.effort, "low");
    assert.equal(await page.locator("#transcript article").last().locator("textarea").inputValue(), "Hello there.");
    await page.getByRole("button", { name: "JavaScript", exact: true }).click();
    await page.waitForFunction(() => /await ask\("hello"\);\n\/\/ → Hello there\./.test(document.getElementById("code")?.textContent ?? ""));
    assert.doesNotMatch(await page.locator("#code").textContent() ?? "", /Message\.assistant\("Hello there\."\)/, "a reply the model gave is echoed, not retyped as source");
    // Encrypted at rest: the stored record is not the key; a reload decrypts it back.
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("lm15-playground"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const rows = await new Promise<Array<{ provider: string; ciphertext: ArrayBuffer }>>((resolve, reject) => { const r = db.transaction("keys").objectStore("keys").getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      return rows.map((row) => ({ provider: row.provider, text: new TextDecoder().decode(row.ciphertext) }));
    });
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.provider, "openai");
    assert.ok(!stored[0]!.text.includes("dummy-openai-key"), "the stored record is ciphertext");
    await page.reload();
    await waitKeyState(page, "Key ready (remembered on this device)");
    await forgetKey(page, "OpenAI");
    await waitKeyState(page, "");
    await page.reload();
    await waitKeyState(page, "");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await close(demo.server); }
});

test("settings stay beside the live code; defaults and invalid inputs stay honest", { timeout: 60_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const bodies: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(demo.url).origin) return route.continue();
    assert.equal(route.request().method(), "POST", "Editing settings must not call a provider");
    bodies.push(route.request().postData() ?? "");
    return route.fulfill({ contentType: "text/event-stream", body: replyFor(url) });
  });
  try {
    await page.goto(demo.url);
    await disableDiscovery(page);
    await useKey(page, "OpenAI", "dummy-settings-key");
    await waitKeyState(page, "Key ready (this tab)");
    await focusSettings(page);
    for (const tab of ["JavaScript", "Python", "Go", "Rust"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await waitRuntimeReady(page, tab);
      const text = `Changed in ${tab}`;
      await page.getByLabel("System prompt").fill(text);
      await page.waitForFunction((text) => document.getElementById("code")?.textContent?.includes(text), text);
      assert.equal(await page.locator(":modal").count(), 0, "No overlay hides the code");
      assert.ok(await page.evaluate(() => {
        const setting = document.getElementById("system")!.getBoundingClientRect();
        const code = document.getElementById("code")!.getBoundingClientRect();
        const sampling = document.getElementById("temperature")!.getBoundingClientRect();
        return setting.top >= 0 && setting.bottom < innerHeight && sampling.bottom < innerHeight && code.top >= 0 && code.top < innerHeight && setting.right < code.left && sampling.right < code.left;
      }), "System prompt, sampling and the changed code are visible together");
    }
    await page.getByLabel("Max tokens").fill("72");
    await page.getByLabel("Reasoning effort").selectOption("low");
    const temperature = page.getByLabel("Temperature", { exact: true });
    await temperature.fill("0"); // zero is an explicit value, not the unset/default state
    const rustCode = await page.locator("#code").textContent() ?? "";
    assert.match(rustCode, /max_tokens: Some\(72\)/);
    assert.match(rustCode, /temperature: Some\(0\.0\)/);
    assert.match(rustCode, /Reasoning::new\("low"/);
    await temperature.fill("2");
    assert.match(await page.locator("#code").textContent() ?? "", /temperature: Some\(2\.0\)/);
    await temperature.fill("");
    await page.getByLabel("Reasoning effort").selectOption("");
    // While an unset field is hovered its place shows in the code, dimmed; away from it, nothing.
    await page.getByLabel("Reasoning effort").hover();
    await page.waitForFunction(() => /reasoning: None/.test(document.getElementById("code")?.textContent ?? ""));
    await page.getByLabel("Message", { exact: true }).focus();
    await page.mouse.move(700, 300);
    assert.doesNotMatch(await page.locator("#code").textContent() ?? "", /temperature:|reasoning:|Reasoning::new/);
    await page.getByLabel("Message", { exact: true }).fill("hello");
    for (const invalid of ["-0.1", "2.1", "0.75"]) {
      await temperature.fill(invalid);
      assert.match(await page.locator("#settings-error").textContent() ?? "", /Temperature must be/);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      assert.equal(bodies.length, 0, "Invalid temperatures cannot be sent");
    }
    await temperature.fill("");
    for (const invalid of ["0", "1.5", "100001"]) {
      await page.getByLabel("Max tokens").fill(invalid);
      assert.match(await page.locator("#code").textContent() ?? "", /Max tokens must be a whole number/);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      assert.equal(bodies.length, 0, "Never replace an invalid setting with an invisible default");
    }
    await page.getByLabel("Max tokens").fill("");
    assert.equal(await page.locator("#settings-error").isVisible(), false);
    await page.getByLabel("Message", { exact: true }).focus();
    assert.doesNotMatch(await page.locator("#code").textContent() ?? "", /max_tokens:/);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("usage")?.textContent?.startsWith("stop"));
    assert.equal(bodies.length, 1);
    const body = JSON.parse(bodies[0]!);
    assert.equal("max_output_tokens" in body, false, "Empty means omitted, not zero or a hidden 400-token default");
    assert.equal(body.instructions, "Changed in Rust");
    assert.equal("temperature" in body, false);
    assert.equal("reasoning" in body, false);
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await focusSettings(page);
      assert.ok(await page.evaluate(() => document.activeElement?.id === "system"));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
      await page.getByLabel("System prompt").fill(`Width ${width}`);
      await page.waitForFunction((width) => document.getElementById("code")?.textContent?.includes(`Width ${width}`), width);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await close(demo.server); }
});

test("minimal workspace: inline key errors, secondary menu, exact code copying and small-screen navigation", { timeout: 90_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const browser = await chromium.launch({ executablePath: installed.bin });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(demo.url).origin });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let externalRequests = 0;
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === new URL(demo.url).origin) return route.continue();
    externalRequests++; return route.abort();
  });
  try {
    await page.goto(demo.url);
    assert.equal(await page.locator("#send").isDisabled(), false, "The example follow-up is prefilled, but Send still requires a real key");
    assert.equal(await page.locator("#prompt").inputValue(), EXAMPLE_DRAFT);
    assert.equal(await page.getByLabel("System prompt").inputValue(), DEFAULT_SETTINGS.system);
    assert.equal(await page.getByLabel("Max tokens").inputValue(), "");
    assert.ok(await page.locator("#composer #temperature, #composer #max-tokens, #composer #reasoning").count() === 3, "sampling lives in the composer");
    assert.ok(await page.locator("#chat-scroll #system").count() === 1, "the system prompt heads the conversation");
    for (const area of ["#prompt", "#system"]) assert.equal(await page.locator(area).evaluate((e) => getComputedStyle(e).resize), "none", `${area} grows with its text; there is no drag handle`);
    await openProviders(page);
    assert.equal(await page.getByLabel("OpenAI API key", { exact: true }).getAttribute("placeholder"), "Paste API key");
    assert.equal(await page.getByLabel("OpenAI API key", { exact: true }).inputValue(), "", "The joke key is not a credential");
    assert.equal(await page.locator("#picker .dialog-heading").isVisible(), false, "the provider list needs no title");
    assert.equal(await page.locator("#picker-status").isVisible(), false, "and no explanation");
    assert.equal(await page.locator('#picker [role="option"][aria-selected="true"] .pick-main').evaluate((e) => e.textContent), "OpenAI", "the highlight starts on the current provider");
    await closePicker(page);
    assert.deepEqual(await page.locator("#transcript article textarea").evaluateAll((areas) => areas.map((a) => (a as HTMLTextAreaElement).value)), [EXAMPLE_QUESTION, EXAMPLE_ANSWER]);
    assert.equal(await page.locator("#transcript button").count(), 0, "turns are edited in place; there is nothing to copy them with");
    assert.equal(await page.locator('#transcript article[data-example="true"]').count(), 2);
    assert.deepEqual(await page.locator("[data-language]").allTextContents(), ["JavaScript", "Python", "Rust", "Go"]);
    assert.equal(await page.locator('#composer .composer-actions #provider-button').count(), 1);
    assert.equal(await page.locator('#composer .composer-actions #model-button').count(), 1);
    for (const selector of ["#empty", "[data-starter]", "#reset-settings", "#temperature-reset", "#wrap-code", "#jump-request", "#code-file", "#code-note", "#turn-count", ".brand-mark", ".status-dot", ".composer-hint", ".picker-help", ".site-footer", "#settings-button", "#connection-button", "[data-line]", "#clear", "#runtime-controls", 'input[name="runtime"]', '[data-language="json"]', '[data-language="curl"]', "#preview-state", "#settings", "#key-card", "#key", "#key-state", "#credentials", ".fine-print", "#judge-key-slot", ".control-row"]) {
      assert.equal(await page.locator(selector).count(), 0, `${selector} is removed, not just hidden`);
    }
    assert.equal(await page.getByRole("link", { name: "LM15 home" }).getAttribute("href"), "/");
    assert.equal(await page.getByRole("link", { name: "Documentation", exact: true }).isVisible(), false);
    assert.equal(await page.getByLabel("Automatically discover model IDs").isVisible(), false);
    await page.locator("#more-toggle").focus();
    await page.locator("#more-toggle").press("Enter");
    assert.equal(await page.getByRole("link", { name: "Documentation", exact: true }).getAttribute("href"), "/docs/");
    assert.equal(await page.getByRole("button", { name: "Forget all keys" }).isVisible(), true);
    assert.equal(await page.locator("#key-storage-note").isVisible(), true, "the storage note lives with key management in More");
    await page.locator("#more-toggle").press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "more-toggle");
    assert.equal(await page.locator("#more-menu").evaluate(e => (e as HTMLDetailsElement).open), false);
    await openMore(page);
    await page.getByLabel("System prompt").click();
    assert.equal(await page.locator("#more-menu").evaluate(e => (e as HTMLDetailsElement).open), false);
    assert.equal(await page.getByText("Calls may cost money", { exact: false }).count(), 0, "no cost warning under the composer");
    const draft = "Keep my draft while I connect";
    await page.getByLabel("Message", { exact: true }).fill(draft);
    assert.equal(externalRequests, 0);
    await page.locator("#send").click();
    // Sending without a key opens the provider list on this provider's key field, with the reason.
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "OpenAI API key");
    assert.equal(await page.locator("#prompt").inputValue(), draft);
    assert.equal(await page.locator("#transcript article").count(), 2, "Missing-key setup preserves the example without creating a failed turn");
    assert.equal(await page.locator("#picker-status.is-error").isVisible(), true);
    assert.match(await page.locator("#picker-status").textContent() ?? "", /Add your OpenAI API key/);
    assert.equal(await page.getByLabel("OpenAI API key", { exact: true }).getAttribute("aria-invalid"), "true");
    assert.equal(await page.locator("#alert").isVisible(), false, "Key errors do not occupy the conversation");
    await closePicker(page);
    await disableDiscovery(page);
    await openProviders(page);
    await page.getByLabel("OpenAI API key", { exact: true }).fill(EXAMPLE_API_KEY);
    await page.getByLabel("OpenAI API key", { exact: true }).press("Enter");
    assert.match(await page.locator("#picker-status").textContent() ?? "", /example key/);
    assert.equal(await page.locator("#loaded").textContent(), "None");
    assert.equal(externalRequests, 0, "The example key must not trigger discovery or inference");
    await useKey(page, "OpenAI", "dummy-design-key");
    await waitKeyState(page, "Key ready (this tab)");
    await openProviders(page);
    assert.equal(await page.locator("#picker-status").isVisible(), false, "a good key clears the error");
    assert.equal(await page.getByRole("button", { name: "Forget the OpenAI key" }).evaluate((b) => getComputedStyle(b).color), await page.locator("#code .tok-api").first().evaluate((e) => getComputedStyle(e).color), "Forget wears the warm accent of LM15's calls in the code, not the error red");
    await closePicker(page);
    await page.getByLabel("System prompt").fill('<script>window.hacked=true</script> <img src=x onerror=alert(1)> dummy-design-key');
    assert.equal(await page.locator("#code script, #code img").count(), 0);
    assert.ok(await page.locator("#code .tok-value").count() > 0, "the system prompt is shown as the person's value");
    assert.ok(!(await page.locator("#code").textContent())?.includes("dummy-design-key"));
    assert.equal(await page.locator("#code .tok-value", { hasText: "[redacted]" }).count(), 1, "the redaction sits inside the value's own span");
    const code = await page.locator("#code").textContent();
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code, "Copied text has no line numbers or styling markup");
    assert.match(await page.locator("#copy-code").textContent() ?? "", /Copied/);
    await page.getByLabel("Max tokens").fill("64");
    await page.getByLabel("Reasoning effort").selectOption("low");
    assert.equal(await page.locator("#prompt").inputValue(), draft, "Editing settings does not erase the draft or key");
    assert.match(await keyState(page), /Key ready/);
    assert.equal(await page.locator("#code-scroll").evaluate((e) => getComputedStyle(e).whiteSpace), "pre-wrap", "Long code lines wrap without another control");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const contrast = await page.evaluate(() => {
        const luminance = (color: string) => {
          // `rgb(r, g, b)` in 0-255, or `color(srgb r g b)` in 0-1 (what a color-mix() resolves to).
          const scale = color.startsWith("color(") ? 1 : 255;
          const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => { value /= scale; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
          return r! * .2126 + g! * .7152 + b! * .0722;
        };
        const panel = luminance(getComputedStyle(document.getElementById("code-panel")!).backgroundColor);
        const against = (element: Element) => { const a = luminance(getComputedStyle(element).color); return (Math.max(a, panel) + .05) / (Math.min(a, panel) + .05); };
        return { ink: against(document.getElementById("code")!), value: against(document.querySelector("#code .tok-value")!), api: against(document.querySelector("#code .tok-api")!) };
      });
      assert.ok(contrast.ink >= 7, `${scheme}: readable code contrast`);
      // The two accents (the person's values in brand blue, LM15's calls in its warm complement) stay above AA in both themes.
      assert.ok(contrast.value >= 4.5 && contrast.api >= 4.5, `${scheme}: accent contrast value ${contrast.value.toFixed(1)}, api ${contrast.api.toFixed(1)}`);
    }
    // The code panel folds away on a wide screen and the choice survives a reload; narrow screens switch views instead.
    await page.getByRole("button", { name: "Hide", exact: true }).click();
    assert.equal(await page.locator("#code-scroll").isVisible(), false);
    assert.ok(await page.locator("#chat-panel").evaluate((e) => e.getBoundingClientRect().width > innerWidth * 0.8), "the conversation takes the room");
    await page.reload();
    assert.equal(await page.locator("#code-scroll").isVisible(), false, "the folded panel stays folded");
    await page.getByRole("button", { name: "Show code", exact: true }).click();
    assert.equal(await page.locator("#code-scroll").isVisible(), true);
    await disableDiscovery(page);
    await useKey(page, "OpenAI", "dummy-design-key");
    await page.getByLabel("Message", { exact: true }).fill(draft);
    for (const width of [1024, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await focusSettings(page);
      await page.getByLabel("System prompt").fill(`Screen ${width}`);
      await page.locator('[data-view-target="code"]').click();
      assert.equal(await page.locator("#code-panel").isVisible(), true);
      assert.equal(await page.locator("#toggle-code").isVisible(), false, "one panel at a time: the view switch folds, not the toggle");
      assert.match(await page.locator("#code").textContent() ?? "", new RegExp(`Screen ${width}`));
      assert.equal(await page.locator("#chat-panel").isVisible(), false);
      await page.locator('[data-view-target="chat"]').click();
      assert.equal(await page.locator("#chat-panel").isVisible(), true);
      assert.equal(await page.locator("#system").isVisible(), true);
      assert.equal(await page.locator("#prompt").inputValue(), draft);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}px`);
      assert.ok(await page.evaluate(() => { const s = document.getElementById("system")!; return s.scrollHeight <= s.clientHeight + 1; }), `the system prompt is as tall as its text at ${width}px`);
    }
    await openMore(page);
    await page.getByRole("button", { name: "Forget all keys" }).click();
    await waitKeyState(page, "");
    await page.locator("#more-toggle").press("Escape");
    await page.getByLabel("Message", { exact: true }).press("Enter");
    assert.equal(await page.locator("#picker").evaluate((d) => (d as HTMLDialogElement).open && d.dataset["kind"] === "provider"), true, "Missing-key errors open the provider list on the phone too");
    assert.equal(await page.locator("#picker-status.is-error").isVisible(), true);
    await closePicker(page);
    assert.equal(await page.locator("#prompt").inputValue(), draft);
    assert.equal(await page.locator("#alert").isVisible(), false);
    assert.equal(externalRequests, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await close(demo.server); }
});

test("runtime loading can be retried, never silently switches language, and does not allow sending while loading", { timeout: 90_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage();
  let attempts = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let releaseReply = () => {};
  const heldReply = new Promise<void>((resolve) => { releaseReply = resolve; });
  let posts = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/vendor/rust/lm15.wasm")) {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, body: "Temporary test failure" });
      await held;
      return route.continue();
    }
    if (url.origin === new URL(demo.url).origin) return route.continue();
    assert.equal(route.request().method(), "POST");
    posts++;
    await heldReply;
    return route.fulfill({ contentType: "text/event-stream", body: replyFor(url) });
  });
  try {
    await page.goto(demo.url);
    await disableDiscovery(page);
    await useKey(page, "OpenAI", "dummy-loading-key");
    await waitKeyState(page, "Key ready (this tab)");
    await page.getByLabel("Message", { exact: true }).fill("Keep this draft");
    await page.getByRole("button", { name: "Rust", exact: true }).click();
    await page.getByRole("button", { name: "Retry loading" }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: "Rust", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('[data-language="rust"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#send").isDisabled(), true);
    assert.equal(await page.locator("#send").textContent(), "Rust not loaded", "the Send button says why it is off");
    assert.equal(await page.locator("#runtime-title").textContent(), "Could not load Rust");
    await page.getByRole("button", { name: "Retry loading" }).click();
    // The retry is held: the card shows the load in progress, over the dimmed code, and Send says so.
    await page.waitForFunction(() => document.getElementById("runtime-card")!.dataset["state"] === "loading");
    assert.equal(await page.locator("#runtime-title").textContent(), "Loading Rust");
    assert.equal(await page.locator("#send").textContent(), "Loading Rust…");
    assert.equal(await page.locator("#code-body").evaluate((e) => e.hasAttribute("data-loading")), true);
    assert.equal(await page.locator("#code-tabs").getAttribute("data-state"), "loading");
    await page.getByLabel("Message", { exact: true }).press("Enter");
    assert.equal(posts, 0, "Keyboard sending is blocked too while the runtime loads");
    assert.equal(await page.locator("#prompt").inputValue(), "Keep this draft");
    await page.getByRole("button", { name: "JavaScript", exact: true }).click();
    assert.equal(await page.locator("#send").isDisabled(), false);
    release();
    await page.getByRole("button", { name: "Rust", exact: true }).click();
    await waitRuntimeReady(page, "Rust");
    assert.equal(await page.locator("#runtime-status").textContent(), "", "Successful loading does not leave technical status text");
    assert.equal(await page.locator("#runtime-card").isHidden(), true, "the card leaves when the runtime is ready");
    assert.equal(await page.locator("#code-body").evaluate((e) => e.hasAttribute("data-loading")), false);
    assert.equal(await page.locator("#send").textContent(), "Send");
    assert.equal(attempts, 2, "Retry actually refetches, rather than reusing a rejected promise");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    for (const name of ["JavaScript", "Python", "Rust", "Go"]) assert.equal(await page.getByRole("button", { name, exact: true }).isDisabled(), true, "The executing language cannot change mid-turn");
    releaseReply();
    await page.waitForFunction(() => document.getElementById("usage")?.textContent?.endsWith("Rust"));
    assert.equal(posts, 1);
    assert.equal(await page.getByRole("button", { name: "JavaScript", exact: true }).isDisabled(), false);
  } finally { release(); releaseReply(); await browser.close(); await close(demo.server); }
});

test("Python can retry a failed module download without reloading the page", { timeout: 120_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage();
  let attempts = 0;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, new URL(demo.url).origin, "Runtime setup never sends a provider request");
    if (url.pathname.endsWith("/pyodide.mjs") && ++attempts === 1) return route.fulfill({ status: 503, body: "Temporary test failure" });
    return route.continue();
  });
  try {
    await page.goto(demo.url);
    await page.getByRole("button", { name: "Python", exact: true }).click();
    await page.getByRole("button", { name: "Retry loading" }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: "Python", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Retry loading" }).click();
    await waitRuntimeReady(page, "Python");
    assert.equal(attempts, 2);
    assert.equal(await page.locator('[data-language="python"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#runtime-status").textContent(), "");
    assert.equal(await page.locator("#retry-runtime").isVisible(), false);
  } finally { await browser.close(); await close(demo.server); }
});

test("the playground runs the same turn through Python (Pyodide) and Rust (wasm) in the browser, and the three runtimes build the same bytes", { timeout: 300_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sent: Array<{ url: string; body: string; auth: string | undefined }> = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(demo.url).origin) return route.continue();
    sent.push({ url: url.href, body: route.request().postData() ?? "", auth: route.request().headers()["authorization"] });
    return route.fulfill({ contentType: "text/event-stream", body: replyFor(url), headers: { "Access-Control-Allow-Origin": new URL(demo.url).origin } });
  });
  try {
    await page.goto(demo.url);
    await disableDiscovery(page);
    await useKey(page, "OpenAI", "dummy-openai-key");
    for (const runtime of ["Rust", "Python", "JavaScript"] as const) {
      await page.getByRole("button", { name: runtime, exact: true }).click();
      await waitRuntimeReady(page, runtime);
      await page.getByLabel("Message", { exact: true }).fill(`hello from ${runtime}`);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.waitForFunction((r) => document.getElementById("usage")?.textContent?.endsWith(r), runtime, { timeout: 60_000 });
      assert.equal(await page.locator("#transcript article").last().locator("textarea").inputValue(), "Hello there.", runtime);
      assert.equal(await page.locator("#transcript article").last().locator("b").textContent(), `OpenAI · ${runtime}`);
    }
    await page.waitForFunction(() => document.getElementById("fidelity")?.textContent?.includes("Same request body bytes from JavaScript, Python, Rust"));
    assert.equal(sent.length, 3);
    for (const call of sent) {
      assert.equal(call.url, "https://api.openai.com/v1/responses");
      assert.equal(call.auth, "Bearer dummy-openai-key", "every runtime sends the page's key, once, as a header");
    }
    // The third turn carries the first two replies, whichever runtime produced them: one transcript, three SDKs.
    const third = JSON.parse(sent[2]!.body) as { input: Array<{ role: string }> };
    assert.deepEqual(third.input.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
    assert.ok((await page.locator("#code").textContent())?.includes(EXAMPLE_QUESTION));
    assert.match((await page.locator("#code").textContent()) ?? "", /hello from Rust/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await close(demo.server); }
});

test("the relay: a provider that blocks the browser fails first, the page asks in words, the run resumes through the relay, More lists and revokes it; without a relay the page only explains", { timeout: 120_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const origin = new URL(demo.url).origin;
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const relay = "https://lm15-relay.test.workers.dev";
  const seen: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    seen.push(url.href);
    if (url.origin === relay) {
      assert.equal(url.pathname, "/api.typesafe.ai/v1/systemone");
      assert.equal(route.request().headers()["authorization"], "Bearer dummy-typesafe-key");
      return route.fulfill({ json: JEV_ANSWER, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "*" } });
    }
    // The provider refuses the browser's origin: from inside the page that is a network failure with no status (what a CORS block looks like).
    return route.abort("failed");
  });
  try {
    await page.goto(demo.url);
    // Phase one plays a site with no relay deployed (an empty loopback override); phase two points at a fake Worker.
    await page.evaluate(() => localStorage.setItem("lm15.playground.relay-url", ""));
    await disableDiscovery(page);
    await page.getByRole("button", { name: "Choose provider", exact: true }).click();
    await page.getByRole("combobox", { name: "Search choices" }).fill("typesafe");
    await page.getByRole("option", { name: /TypeSafe/ }).first().locator(".pick-main").click();
    await page.waitForFunction(() => document.body.dataset.mode === "judge" && document.getElementById("judge-provider-name")?.textContent === "TypeSafe (Jev)");
    await useKey(page, "TypeSafe (Jev)", "dummy-typesafe-key");
    assert.match(await page.locator("#code").textContent() ?? "", /judgments\(\{/);
    assert.doesNotMatch(await page.locator("#code").textContent() ?? "", /baseUrl/);

    // No relay deployed: the dialog explains, offers nothing, and no key went anywhere but the provider.
    await page.locator("#judge-run").click();
    await page.locator("#relay-dialog[open]").waitFor();
    assert.equal(await page.locator("#relay-provider").textContent(), "TypeSafe (Jev)");
    assert.equal(await page.locator("#relay-unavailable").isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Allow the relay and resend" }).isDisabled(), true);
    await page.getByRole("button", { name: "Not now" }).click();
    await page.waitForFunction(() => !document.getElementById("judge-alert")?.hidden);
    assert.deepEqual(seen, ["https://api.typesafe.ai/v1/systemone"]);
    assert.match(await page.locator("#judge-alert").textContent() ?? "", /block browser access/s);
    assert.equal(await page.locator("#judge-usage").textContent(), "");

    // A relay is configured (loopback override): the same failure now offers it; allowing sends the same call through it.
    await page.evaluate((url) => localStorage.setItem("lm15.playground.relay-url", url), relay);
    await page.locator("#judge-run").click();
    await page.locator("#relay-dialog[open]").waitFor();
    assert.equal(await page.locator("#relay-unavailable").isVisible(), false);
    await page.getByLabel("Remember this choice on this device").check();
    await page.getByRole("button", { name: "Allow the relay and resend" }).click();
    await page.waitForFunction(() => document.getElementById("judge-usage")?.textContent?.startsWith("judged"));
    assert.deepEqual(seen, ["https://api.typesafe.ai/v1/systemone", "https://api.typesafe.ai/v1/systemone", `${relay}/api.typesafe.ai/v1/systemone`]);
    assert.match(await page.locator("#code").textContent() ?? "", new RegExp(`baseUrl: "${relay}/api.typesafe.ai"`));
    assert.match(await keyState(page), /via the relay/);
    await openProviders(page);
    assert.match(await page.locator('#picker [role="option"]', { hasText: "TypeSafe" }).textContent() ?? "", /via the relay/, "the provider row says it too");
    await closePicker(page);
    assert.equal(await page.evaluate(() => localStorage.getItem("lm15.playground.relay")), '["typesafe"]');

    // Another provider is untouched by the permission; More names what is relayed and revokes it.
    await openMore(page);
    assert.match(await page.locator("#relayed").textContent() ?? "", /TypeSafe \(Jev\) — requests to this provider go through the lm15 relay/);
    await page.getByRole("button", { name: "Stop relaying" }).click();
    assert.match(await page.locator("#relayed").textContent() ?? "", /^None/);
    assert.equal(await page.evaluate(() => localStorage.getItem("lm15.playground.relay")), null);
    await page.evaluate(() => localStorage.removeItem("lm15.playground.relay-url"));
    await page.locator("#more-toggle").press("Escape");
    assert.doesNotMatch(await page.locator("#code").textContent() ?? "", /baseUrl/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await close(demo.server);
  }
});

test("the Request view: the code panel shows what the selected runtime puts on the wire for the current turn, never sent, with the key blanked", { timeout: 90_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const origin = new URL(demo.url).origin;
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let sent = 0;
  await page.route("**/*", async (route) => { if (new URL(route.request().url()).origin === origin) return route.continue(); sent++; return route.abort(); });
  try {
    await page.goto(demo.url);
    await disableDiscovery(page);
    await page.getByRole("button", { name: "Request", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.startsWith("Built by JavaScript for this turn"));
    let wire = await page.locator("#code").textContent() ?? "";
    assert.match(wire, /^POST https:\/\/api\.openai\.com\/v1\/responses\n\n/);
    assert.match(wire, /Authorization: Bearer \[your key\]/);
    assert.match(wire, /"stream": true/);
    assert.ok(wire.includes(`"text": ${JSON.stringify(EXAMPLE_QUESTION)}`), "the example transcript is in the body");
    assert.match(wire, /"text": "Can you show me a tiny example\?"/, "the draft is the last message");
    // The view follows the draft and the settings, and a stored key is blanked.
    await page.getByLabel("Message", { exact: true }).fill("Why is the sky blue?");
    await page.waitForFunction(() => /Why is the sky blue\?/.test(document.getElementById("code")?.textContent ?? ""));
    await focusSettings(page);
    await page.getByLabel("Temperature").fill("0.3");
    await page.waitForFunction(() => /"temperature": 0\.3/.test(document.getElementById("code")?.textContent ?? ""));
    await useKey(page, "OpenAI", "sk-real-secret-key");
    await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.includes("Your key is blanked"));
    wire = await page.locator("#code").textContent() ?? "";
    assert.doesNotMatch(wire, /sk-real-secret-key/);
    assert.match(wire, /Bearer \[your key\]/);
    assert.equal(sent, 0, "the Request view sends nothing");
    // Every turn can be rewritten: the request is built from the transcript as it now reads.
    const reply = page.locator("#transcript article").nth(1).locator("textarea");
    await reply.fill("LM15 is one interface to many model providers.");
    await page.waitForFunction(() => /"text": "LM15 is one interface to many model providers\."/.test(document.getElementById("code")?.textContent ?? ""));
    assert.doesNotMatch(await page.locator("#code").textContent() ?? "", new RegExp(JSON.stringify(EXAMPLE_ANSWER).slice(1, -1)));
    await reply.fill("");
    await page.waitForFunction(() => /A turn cannot be empty/.test(document.getElementById("request-note")?.textContent ?? ""));
    await page.getByRole("button", { name: "Send", exact: true }).click();
    assert.match(await page.locator("#alert").textContent() ?? "", /A turn cannot be empty/);
    await reply.fill(EXAMPLE_ANSWER);
    await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.startsWith("Built by JavaScript"));
    // Python builds the same bytes.
    await page.locator('[data-language="python"]').click();
    await waitRuntimeReady(page, "Python");
    await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.startsWith("Built by Python"));
    assert.equal(await page.locator("#code").textContent(), wire);
    await page.getByRole("button", { name: "Code", exact: true }).click();
    assert.match(await page.locator("#code").textContent() ?? "", /^from lm15 import/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await close(demo.server); }
});
