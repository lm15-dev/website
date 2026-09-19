/**
 * Judge mode in a real browser, against a fake Jev: the form edits the
 * schema the code shows; a run judges every input with one call each and
 * draws what was measured; the popover says the numbers; the device
 * remembers the set; where a pin falls short the page says so and does
 * not run; the exports say what was measured. Only dummy keys.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, type Page } from "playwright-core";
import { startDemo } from "../scripts/serve-playground.ts";
import { findBrowsers } from "./support/browser.ts";
import { disableDiscovery, waitRuntimeReady } from "./support/playground.ts";

const JEV_ANSWER = { model: "jev-test", answers: { quality: { type: "score", probabilities: { "0": 0, "1": 0.05, "2": 0.15, "3": 0.45, "4": 0.35 } }, style: { type: "choice", choice: "fruit", probabilities: { fruit: 0.62, oak: 0.28, mineral: 0.1 } }, ageing: { type: "noul", noul: 0.87 } }, usage: { input_tokens: 40, output_tokens: 9 } };

async function close(server: Awaited<ReturnType<typeof startDemo>>["server"]) {
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close((e) => e ? reject(e) : done()));
}

async function openJudgeWithTypeSafe(page: Page): Promise<void> {
  await disableDiscovery(page);
  await page.getByRole("button", { name: "Judge", exact: true }).click();
  await page.waitForFunction(() => document.body.dataset.mode === "judge");
  await page.getByRole("button", { name: "Choose provider", exact: true }).click();
  await page.getByRole("combobox", { name: "Search choices" }).fill("typesafe");
  await page.getByRole("option", { name: /TypeSafe/ }).first().click();
  await page.waitForFunction(() => document.getElementById("judge-provider-name")?.textContent === "TypeSafe (Jev)");
  await page.getByLabel("API key", { exact: true }).fill("dummy-typesafe-key");
  await page.getByRole("button", { name: "Use key for this provider" }).click();
  await page.waitForFunction(() => document.getElementById("key-state")?.textContent?.startsWith("Key ready"));
}

test("Judge: the form is the schema; a run judges every input once; the sparkline and its popover say what was measured; the set survives a reload", { timeout: 180_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const origin = new URL(demo.url).origin;
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const bodies: Array<{ state: unknown; questions: Record<string, { type: string; instructions: string }>; model: string }> = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    assert.equal(url.href, "https://api.typesafe.ai/v1/systemone");
    assert.equal(route.request().headers()["authorization"], "Bearer dummy-typesafe-key");
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: JEV_ANSWER, headers: { "Access-Control-Allow-Origin": origin } });
  });
  try {
    await page.goto(demo.url);
    await openJudgeWithTypeSafe(page);
    assert.equal(await page.locator("#judge-count").textContent(), "3 inputs · 3 questions · 3 calls");
    // The key card and the code panel are the chat's own, moved: one key field, one set of language tabs.
    assert.equal(await page.locator("#key").count(), 1);
    assert.equal(await page.locator("#code-tabs").count(), 1);
    assert.equal(await page.locator("#judge-key-slot #key").count(), 1);
    assert.equal(await page.locator("#judge-code-slot #code").count(), 1);

    // The form writes the schema the code shows: rename a question, add a level, add a yes/no.
    await page.locator('.question[data-name="style"] summary').click();
    const styleName = page.locator('.question[data-name="style"] .field input').first();
    await styleName.fill("kind"); await styleName.press("Tab");
    await page.waitForFunction(() => document.querySelector('.question[data-name="kind"]') !== null);
    assert.match(await page.locator("#code").textContent() ?? "", /kind: choice\("What is the dominant style described\?"/);
    await page.locator('.question[data-name="quality"] summary').click();
    await page.locator('.question[data-name="quality"]').getByRole("button", { name: "+ level" }).click();
    const newTitle = page.locator('.question[data-name="quality"] .levels li').last().locator("input.key");
    await newTitle.fill("legendary"); await newTitle.press("Tab");
    await page.waitForFunction(() => /legendary/.test(document.getElementById("code")?.textContent ?? ""));
    assert.match(await page.locator('.question[data-name="quality"] .qkind').textContent() ?? "", /scale · 6 levels/);
    await page.locator("#judge-add-question").selectOption("yesNo");
    await page.waitForFunction(() => document.querySelector('.question[data-name="flag"]') !== null);
    assert.equal(await page.locator("#judge-count").textContent(), "3 inputs · 4 questions · 3 calls");
    await page.locator('.question[data-name="flag"]').getByRole("button", { name: "Remove question" }).click();
    await page.waitForFunction(() => document.querySelector('.question[data-name="flag"]') === null);
    // The JSON view is the same schema; a broken edit is named and the last valid schema stands.
    await page.getByRole("button", { name: "{ } JSON" }).click();
    const raw = page.locator("#judge-raw-json");
    assert.match(await raw.inputValue(), /"kind": \{\n\s+"type": "string"/);
    await raw.fill("{ nope");
    assert.match(await page.locator("#judge-raw-status").textContent() ?? "", /Questions must be a JSON object/);
    await page.getByRole("button", { name: "☰ Form" }).click();
    assert.match(await page.locator("#judge-alert").textContent() ?? "", /Fix the JSON first/);
    await raw.fill(JSON.stringify({ quality: { type: "integer", description: "How good?", anyOf: ["faulty", "poor", "fair", "good", "outstanding"].map((title, i) => ({ const: i, title })) }, ageing: { type: "boolean", description: "Ages?" } }));
    await page.getByRole("button", { name: "☰ Form" }).click();
    await page.waitForFunction(() => document.querySelector(".question-list")?.querySelectorAll(".question").length === 2);
    assert.equal(await page.locator("#judge-count").textContent(), "3 inputs · 2 questions · 3 calls");

    // Inputs: add two, remove one; the count and the code follow.
    await page.getByLabel("New inputs").fill("A fourth note.\nA fifth note.");
    await page.getByRole("button", { name: "Add input" }).click();
    assert.equal(await page.locator("#judge-rows tr").count(), 5);
    await page.getByRole("button", { name: "Remove input 5" }).click();
    assert.equal(await page.locator("#judge-rows tr").count(), 4);
    assert.match(await page.locator("#code").textContent() ?? "", /"A fourth note\.",/);

    // Run: one call per input, each carrying the input and the questions; the outputs draw what Jev measured.
    await page.getByRole("button", { name: "Run all", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("judge-out-count")?.textContent === "4 of 4 judged");
    assert.equal(bodies.length, 4);
    assert.deepEqual(bodies[3]!.state, { system: "These are tasting notes written by a sommelier. Judge the wine described, not the writing.", messages: [{ role: "user", content: "A fourth note." }] });
    assert.deepEqual(Object.keys(bodies[0]!.questions), ["quality", "ageing"]);
    assert.equal(bodies[0]!.questions["quality"]!.type, "score");
    assert.equal(bodies[0]!.model, "jev-latest");
    assert.match(await page.locator("#judge-method").textContent() ?? "", /typesafe · jev-latest · provider classification/);
    const first = page.locator("#judge-rows tr").first();
    assert.equal(await first.locator(".ans").count(), 2);
    assert.match(await first.locator(".ans").first().textContent() ?? "", /quality.*good.*45% · expected 3\.1/s, "the pick, its probability, the expected level");
    assert.equal(await first.locator(".spark.ordered i").count(), 5, "one bar per level, as declared (Jev answered five)");
    assert.match(await first.locator(".in-status").textContent() ?? "", /judged · 49 tokens/);
    assert.match(await page.locator("#judge-tally").textContent() ?? "", /4 of 4 judged · 196 tokens/);
    // The popover: every key with its number, the pick in bold, the expected level; hover a bar to name it.
    await first.locator(".spark.ordered").hover();
    await page.locator("#judge-pop:not([hidden])").waitFor();
    assert.match(await page.locator("#judge-pop .ph").textContent() ?? "", /quality · provider classification/);
    assert.equal(await page.locator("#judge-pop .pr").count(), 5);
    assert.match(await page.locator("#judge-pop .pr.top").textContent() ?? "", /3good45%/);
    assert.match(await page.locator("#judge-pop .pf").textContent() ?? "", /expected level 3\.10 of 0–4/);
    await first.locator(".spark.ordered i").nth(4).hover();
    assert.match(await page.locator("#judge-pop .pr.hover").textContent() ?? "", /4.*35%/);
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.getElementById("judge-pop")?.hidden);
    // The JSON view is the response's own data, probabilities and method.
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    const json = JSON.parse(await first.locator("pre").textContent() ?? "{}") as { data: unknown; probabilities: Record<string, unknown>; method: string };
    assert.deepEqual(json.data, { quality: 3, ageing: true });
    assert.equal(json.method, "provider_classification");
    assert.deepEqual(json.probabilities["ageing"], { true: 0.87, false: 0.13 });
    await page.getByRole("button", { name: "Answers", exact: true }).click();

    // Editing a judged input marks it; Run judges only that one.
    const second = page.locator("#judge-rows tr").nth(1).locator("textarea");
    await second.fill("Thin and sour, but honest.");
    assert.match(await page.locator("#judge-rows tr").nth(1).locator(".in-status").textContent() ?? "", /changed · run again/);
    assert.equal(await page.getByRole("button", { name: "Run 1 new" }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Run all again" }).isVisible(), true, "with one changed, the whole set can still be redone");
    await page.getByRole("button", { name: "Run 1 new" }).click();
    await page.waitForFunction(() => document.getElementById("judge-out-count")?.textContent === "4 of 4 judged");
    assert.equal(bodies.length, 5);
    assert.deepEqual((bodies[4]!.state as { messages: Array<{ content: string }> }).messages[0]!.content, "Thin and sour, but honest.");
    // Everything judged: Run all judges everything again (it is not a no-op).
    assert.equal(await page.getByRole("button", { name: "Run all again" }).isHidden(), true);
    await page.getByRole("button", { name: "Run all", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("judge-out-count")?.textContent === "4 of 4 judged" && document.getElementById("judge-run")?.textContent === "Run all");
    assert.equal(bodies.length, 9, "four more calls: every input again");

    // The exports say what was measured.
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    const csvText = await (await csv.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks as Buffer[]).toString());
    assert.match(csvText, /^input,quality,quality:faulty,quality:poor,quality:fair,quality:good,quality:outstanding,ageing,ageing:yes,ageing:no,method,provider,model,adaptations\r\n/);
    assert.match(csvText, /"Thin and sour, but honest\.",good,/);

    // The device remembers the set and its answers; the mode too.
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mode === "judge" && document.getElementById("judge-out-count")?.textContent === "4 of 4 judged");
    assert.equal(await page.locator('.question[data-name="quality"]').count(), 1);
    assert.equal(await page.locator("#judge-rows tr").count(), 4);
    assert.match(await page.locator("#judge-rows tr").nth(1).locator("textarea").inputValue(), /honest/);

    // The Request view: what the selected runtime builds for the selected input, never sent, the key blanked; it follows the selection.
    // (After the reload the connection is the default OpenAI again; the set is what was remembered.)
    await page.getByRole("button", { name: "Request", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.startsWith("Built by JavaScript for input 1 of 4"));
    let wire = await page.locator("#code").textContent() ?? "";
    assert.match(wire, /^POST https:\/\/api\.openai\.com\/v1\/responses\n\nContent-Type: application\/json\nAuthorization: Bearer \[your key\]\n\n\{/);
    assert.match(wire, /"name": "judgments"/);
    assert.match(wire, /"quality": \{\n\s+"type": "integer"/);
    assert.doesNotMatch(wire, /"stream": true/, "a judge call is one piece");
    await page.locator("#judge-rows tr").nth(1).locator("textarea").focus();
    await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.startsWith("Built by JavaScript for input 2 of 4"));
    wire = await page.locator("#code").textContent() ?? "";
    assert.match(wire, /"text": "Thin and sour, but honest\."/);
    assert.equal(await page.locator("#copy-code").textContent(), "Copy request");
    await page.locator('[data-language="python"]').click();
    await waitRuntimeReady(page, "Python");
    await page.waitForFunction(() => document.getElementById("request-note")?.textContent?.startsWith("Built by Python for input 2 of 4"));
    assert.equal(await page.locator("#code").textContent(), wire, "Python builds the same bytes as JavaScript for this input");
    await page.locator('[data-language="rust"]').click();
    await waitRuntimeReady(page, "Rust");
    await page.waitForFunction(() => /Rust SDK at this pin has no judgments/.test(document.getElementById("request-note")?.textContent ?? ""));
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("request-note")?.hidden);
    await page.locator('[data-language="javascript"]').click();
    await waitRuntimeReady(page, "JavaScript");

    // Rust at this pin: the tab says so; Run is off with the reason.
    await page.locator('[data-language="rust"]').click();
    await waitRuntimeReady(page, "Rust");
    assert.match(await page.locator("#code").textContent() ?? "", /Not in the Rust SDK at this pin/);
    assert.equal(await page.getByRole("button", { name: "Run all", exact: true }).isDisabled(), true);
    assert.match(await page.locator("#judge-gap").textContent() ?? "", /Rust SDK at this pin has no judgments/);
    await page.locator('[data-language="javascript"]').click();
    await waitRuntimeReady(page, "JavaScript");
    assert.equal(await page.locator("#judge-gap").isHidden(), true);

    // Clear results keeps the inputs.
    await page.getByRole("button", { name: "Clear results" }).click();
    assert.equal(await page.locator("#judge-out-count").textContent(), "0 of 4 judged");
    assert.equal(await page.locator("#judge-rows tr").count(), 4);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await close(demo.server);
  }
});

test("Judge: shapes keep their own inputs; Fields on a chat wire is named as a pin gap and never sent; Conversation judges the transcript; Chat mode is untouched", { timeout: 120_000 }, async () => {
  const installed = findBrowsers().find((b) => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  const origin = new URL(demo.url).origin;
  const browser = await chromium.launch({ executablePath: installed.bin });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sent: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    sent.push(url.href);
    if (url.hostname === "api.typesafe.ai") return route.fulfill({ json: JEV_ANSWER, headers: { "Access-Control-Allow-Origin": origin } });
    return route.fulfill({ json: { id: "r", model: "m", status: "completed", output: [{ type: "message", id: "msg", role: "assistant", content: [{ type: "output_text", text: '{"quality":2,"style":"oak","ageing":false}' }] }], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } }, headers: { "Access-Control-Allow-Origin": origin } });
  });
  try {
    await page.goto(demo.url);
    await disableDiscovery(page);
    await page.getByRole("button", { name: "Judge", exact: true }).click();
    await page.waitForFunction(() => document.body.dataset.mode === "judge");
    assert.equal(await page.locator("#judge-provider-name").textContent(), "OpenAI");
    await page.getByLabel("API key", { exact: true }).fill("dummy-openai-key");
    await page.getByRole("button", { name: "Use key for this provider" }).click();
    await page.waitForFunction(() => document.getElementById("key-state")?.textContent?.startsWith("Key ready"));

    // A chat wire judges the pick without the numbers; the dropped probabilities are recorded on the row.
    await page.getByRole("button", { name: "Run all", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("judge-out-count")?.textContent === "3 of 3 judged");
    assert.equal(sent.length, 3);
    const first = page.locator("#judge-rows tr").first();
    assert.equal(await first.locator(".spark").count(), 0, "no distribution to draw");
    assert.match(await first.locator(".ans").first().textContent() ?? "", /quality.*good.*pick only/s);
    assert.match(await first.locator(".out-meta").textContent() ?? "", /adapted: config\.probabilities dropped/);
    assert.match(await page.locator("#judge-method").textContent() ?? "", /pick only — this wire does not measure a distribution/);

    // Fields on this wire: the page names the pin gap, the code leads with it, Run is off, nothing is sent.
    await page.getByRole("button", { name: "Fields", exact: true }).click();
    assert.equal(await page.locator("#judge-rows tr").count(), 2, "the fields shape starts with its own example rows");
    assert.match(await page.locator("#judge-gap").textContent() ?? "", /Fields on a chat wire: the SDKs at this pin do not carry a data part/);
    assert.equal(await page.getByRole("button", { name: "Run all", exact: true }).isDisabled(), true);
    assert.match(await page.locator("#code").textContent() ?? "", /^\/\/ Fields on a chat wire/);
    assert.match(await page.locator("#code").textContent() ?? "", /Message\.user\(\{ type: "data", value: input \}\)/);
    assert.match(await page.locator("#judge-paths-hint").textContent() ?? "", /messages\[0\]\.content\[0\]\.note/);
    assert.equal(sent.length, 3);
    // Fields on TypeSafe: structured state; a field typed as a number is sent as one.
    await page.getByRole("button", { name: "Choose provider", exact: true }).click();
    await page.getByRole("combobox", { name: "Search choices" }).fill("typesafe");
    await page.getByRole("option", { name: /TypeSafe/ }).first().click();
    await page.waitForFunction(() => document.getElementById("judge-provider-name")?.textContent === "TypeSafe (Jev)");
    await page.getByLabel("API key", { exact: true }).fill("dummy-typesafe-key");
    await page.getByRole("button", { name: "Use key for this provider" }).click();
    await page.waitForFunction(() => document.getElementById("key-state")?.textContent?.startsWith("Key ready"));
    assert.equal(await page.locator("#judge-gap").isHidden(), true);
    await page.getByLabel("Input 1 price_eur").fill("52");
    const states: unknown[] = [];
    await page.route("https://api.typesafe.ai/**", async (route) => { states.push(route.request().postDataJSON().state); return route.fulfill({ json: JEV_ANSWER, headers: { "Access-Control-Allow-Origin": origin } }); });
    await page.getByRole("button", { name: "Run all", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("judge-out-count")?.textContent === "2 of 2 judged");
    // D6: with instructions the state is {system, messages}; the object rides as the message content, its number a number.
    const state = states[0] as { system: string; messages: Array<{ role: string; content: Array<{ note: string; price_eur: number }> }> };
    assert.equal(state.messages[0]!.role, "user");
    assert.equal(state.messages[0]!.content[0]!.price_eur, 52);
    assert.match(state.messages[0]!.content[0]!.note, /^Ripe blackberry/);
    assert.match(await page.locator("#judge-paths-hint").textContent() ?? "", /`messages\[0\]\.content\[0\]\.note`/, "the hint names the real path under D6");
    assert.match(await page.locator("#code").textContent() ?? "", /price_eur: 52/);

    // Conversation: the transcript is the input; a turn can be added; the request carries every message.
    await page.getByRole("button", { name: "Conversation", exact: true }).click();
    assert.equal(await page.locator("#judge-rows tr").count(), 1);
    await page.locator("#judge-rows .add-msg").getByRole("button", { name: "user" }).click();
    await page.getByLabel("Input 1, user turn 3").fill("Will it keep?");
    await page.getByRole("button", { name: "Run all", exact: true }).click();
    await page.waitForFunction(() => document.getElementById("judge-out-count")?.textContent === "1 of 1 judged");
    const convo = states[states.length - 1] as { system: string; messages: Array<{ role: string; content: string }> };
    assert.deepEqual(convo.messages.map((m) => m.role), ["user", "assistant", "user"]);
    assert.equal(convo.messages[2]!.content, "Will it keep?");
    assert.match(await page.locator("#code").textContent() ?? "", /Message\.user\("Will it keep\?"\)/);
    // Back to Text: its three inputs are still there, judged.
    await page.getByRole("button", { name: "Text", exact: true }).click();
    assert.equal(await page.locator("#judge-rows tr").count(), 3);

    // Chat mode is what it was: no judgments switch, the example conversation, the code for a chat turn.
    await page.getByRole("button", { name: "Choose provider", exact: true }).click();
    await page.getByRole("combobox", { name: "Search choices" }).fill("openai");
    await page.getByRole("option", { name: /^OpenAI/ }).first().click();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.waitForFunction(() => document.body.dataset.mode === "chat");
    assert.equal(await page.getByLabel("Ask for judgments").count(), 0);
    assert.equal(await page.locator("#transcript article").count(), 2);
    assert.match(await page.locator("#code").textContent() ?? "", /ResponseStream/);
    assert.doesNotMatch(await page.locator("#code").textContent() ?? "", /judgments/);
    assert.equal(await page.locator("#settings-scroll #key").count(), 1, "the key card is back in Settings");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await close(demo.server);
  }
});
