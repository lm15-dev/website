/**
 * Judge mode in a real browser, against a fake Jev: one state and the
 * question form edit the code the panel shows; Judge makes one call and
 * draws what was measured, echoing the answer under the program; the
 * device remembers the state and the questions, never a result. Only
 * dummy keys.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, type Page } from "playwright-core";
import { startDemo } from "../scripts/serve-playground.ts";
import { findBrowsers } from "./support/browser.ts";
import { disableDiscovery, keyState, useKey, waitKeyState } from "./support/playground.ts";

test("Judge defaults to Jev, restores mode-specific choices, and starts on Jev after reload", { timeout: 60_000 }, async (t) => {
  const installed = findBrowsers().find(b => b.name === "chromium");
  assert.ok(installed);
  const demo = await startDemo();
  t.after(() => close(demo.server));
  const browser = await chromium.launch({ executablePath: installed.bin });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const url = process.env["SITE_URL"] ? new URL("/playground/", process.env["SITE_URL"]).href : demo.url;
  const origin = new URL(url).origin;
  const external: string[] = [];
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(url);
  await disableDiscovery(page);
  assert.equal(await page.locator("#provider-name").textContent(), "OpenAI");
  await page.locator("#mode-judge").click();
  assert.equal(await page.locator("#judge-provider-name").textContent(), "TypeSafe (Jev)");
  assert.match(await page.locator("#code").textContent() ?? "", /jev-latest/);
  assert.equal(await keyState(page), "", "Jev starts without a key of its own");
  assert.equal(await page.locator("#mode-chat").isEnabled(), true);

  // A deliberate Judge provider choice is retained while switching modes.
  await page.getByRole("button", { name: "Choose provider", exact: true }).click();
  await page.getByRole("combobox", { name: "Search choices" }).fill("anthropic");
  await page.getByRole("option", { name: /^Anthropic/ }).first().locator(".pick-main").click();
  assert.equal(await page.locator("#judge-provider-name").textContent(), "Anthropic");
  await page.locator("#mode-chat").click();
  assert.equal(await page.locator("#provider-name").textContent(), "OpenAI");
  await page.locator("#mode-judge").click();
  assert.equal(await page.locator("#judge-provider-name").textContent(), "Anthropic");

  // Only mode and question set persist today, not connection selections.
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.mode === "judge");
  assert.equal(await page.locator("#judge-provider-name").textContent(), "TypeSafe (Jev)");
  await page.locator("#mode-chat").click();
  assert.equal(await page.locator("#provider-name").textContent(), "OpenAI");

  // Explicitly choosing Jev from Chat still opens Judge; Chat remains usable.
  await page.getByRole("button", { name: "Choose provider", exact: true }).click();
  await page.getByRole("combobox", { name: "Search choices" }).fill("typesafe");
  await page.getByRole("option", { name: /TypeSafe/ }).first().locator(".pick-main").click();
  await page.waitForFunction(() => document.body.dataset.mode === "judge");
  assert.equal(await page.locator("#judge-provider-name").textContent(), "TypeSafe (Jev)");
  await page.locator("#mode-chat").click();
  assert.equal(await page.locator("#provider-name").textContent(), "OpenAI");
  assert.deepEqual(external, [], "Selecting a default never submits inference or sends credentials");
});

/** Jev's answer to exactly the declared questions (the SDK refuses any other key): the scale for a `score` question, yes/no for the rest. */
const JEV_ANSWER = (questions: Record<string, { type: string }>) => ({ model: "jev-test", answers: Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, q.type === "score" ? { type: "score", probabilities: { "0": 0, "1": 0.05, "2": 0.15, "3": 0.45, "4": 0.35 } } : { type: "noul", noul: 0.87 }])), usage: { input_tokens: 40, output_tokens: 9 } });

async function close(server: Awaited<ReturnType<typeof startDemo>>["server"]) {
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close((e) => e ? reject(e) : done()));
}

async function openJudgeWithTypeSafe(page: Page): Promise<void> {
  await disableDiscovery(page);
  await page.locator("#mode-judge").click();
  await page.waitForFunction(() => document.body.dataset.mode === "judge");
  assert.equal(await page.locator("#judge-provider-name").textContent(), "TypeSafe (Jev)");
  await useKey(page, "TypeSafe (Jev)", "dummy-typesafe-key");
  await waitKeyState(page, /^Key ready/);
}

test("Judge: one state, the question form is the schema, one call draws what was measured and echoes it under the code; the device remembers the set, never a result", { timeout: 180_000 }, async () => {
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
    const body = route.request().postDataJSON();
    bodies.push(body);
    return route.fulfill({ json: JEV_ANSWER(body.questions), headers: { "Access-Control-Allow-Origin": origin } });
  });
  try {
    await page.goto(demo.url);
    await openJudgeWithTypeSafe(page);
    // The layout is the chat's: the state and the questions on the left, the code on the right, no result yet, no inputs table.
    assert.equal(await page.locator("#judge-code-slot #code").count(), 1);
    assert.equal(await page.locator("#judge-result").isHidden(), true, "nothing is pre-run");
    for (const selector of ["#judge-rows", "#judge-add", "#judge-instructions", "#judge-export-csv", "#judge-paste", ".io-table"]) assert.equal(await page.locator(selector).count(), 0, `${selector} is gone`);
    assert.deepEqual(await page.locator(".question .qname").allTextContents(), ["id_certainty", "juvenile_present"], "the example: two questions over one note");
    await page.waitForFunction(() => /const state = "Dusk, edge of the oak grove/.test(document.getElementById("code")?.textContent ?? ""));
    assert.doesNotMatch(await page.locator("#code").textContent() ?? "", /for \(|inputs/, "one call, no loop");

    // The state and the questions are the code's: edit either and it follows; hover lights it both ways.
    await page.getByLabel("State", { exact: true }).fill("Thin, sour, faintly oxidised. Drink up.");
    await page.waitForFunction(() => /const state = "Thin, sour/.test(document.getElementById("code")?.textContent ?? ""));
    await page.locator('#code [data-source="state"]').first().hover();
    assert.equal(await page.locator("#judge-panel .lit").count(), 1, "the state block lights when its code is hovered");
    // Typing a name or a question follows into the code keystroke by keystroke, the card staying under the caret; blur settles it.
    await page.locator('.question[data-name="juvenile_present"] summary').click();
    await page.locator('.question[data-name="juvenile_present"] button.remove-question').click();
    await page.waitForFunction(() => !/juvenile_present/.test(document.getElementById("code")?.textContent ?? ""));
    await page.locator('.question[data-name="id_certainty"] summary').click();
    await page.locator('.question[data-name="id_certainty"] input.mono').pressSequentially("score");
    await page.waitForFunction(() => /scoreid_certainty: score\("How sure/.test(document.getElementById("code")?.textContent ?? ""));
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement).value), "scoreid_certainty", "the caret stays where it was");
    await page.locator('.question[data-name="scoreid_certainty"] input.mono').fill("score");
    await page.locator('.question[data-name="score"] input.mono').press("Tab");
    await page.waitForFunction(() => /score: score\("How sure/.test(document.getElementById("code")?.textContent ?? ""));
    await page.getByLabel("Add a question").selectOption("yesNo");
    await page.locator('.question[data-name="flag"] input.mono').fill("ageing");
    await page.locator('.question[data-name="ageing"] input:not(.mono)').first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Will it improve with age?");
    await page.waitForFunction(() => /ageing: yesNo\("Will it improve with age\?"\)/.test(document.getElementById("code")?.textContent ?? ""));
    await page.keyboard.press("Tab");
    // A name already taken settles apart, renamed; nothing is lost.
    await page.locator('.question[data-name="ageing"] input.mono').fill("score");
    assert.deepEqual(await page.locator(".question .qname").allTextContents(), ["score", "ageing"], "a taken name is not applied while typing");
    await page.locator('.question[data-name="ageing"] input.mono').press("Tab");
    assert.deepEqual(await page.locator(".question .qname").allTextContents(), ["score", "score_2"]);
    await page.locator('.question[data-name="score_2"] input.mono').fill("ageing");
    await page.locator('.question[data-name="ageing"] input.mono').press("Tab");
    await page.waitForFunction(() => /ageing: yesNo\("Will it improve with age\?"\)/.test(document.getElementById("code")?.textContent ?? ""));
    await page.locator('.question[data-name="ageing"]').hover();
    assert.ok(await page.locator('#code .lit[data-source="question:ageing"]').count() >= 1, "a question lights its line in the code");

    // One call: the pick and the distribution, drawn; the popover has the numbers; the answer is echoed under the program.
    await page.locator("#judge-run").click();
    await page.waitForFunction(() => !document.getElementById("judge-result")?.hidden && document.getElementById("judge-usage")?.textContent?.startsWith("judged"));
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0]!.state, "Thin, sour, faintly oxidised. Drink up.");
    assert.deepEqual(Object.keys(bodies[0]!.questions), ["score", "ageing"]);
    assert.equal(await page.locator('#judge-answers .ans:has(.q:text-is("score")) .pick').evaluate((e) => e.firstChild?.textContent), "confident");
    assert.equal(await page.locator('#judge-answers .ans:has(.q:text-is("ageing")) .pick').evaluate((e) => e.firstChild?.textContent), "yes");
    await page.locator('#judge-answers .ans:has(.q:text-is("score")) .spark').hover();
    assert.match(await page.locator("#judge-pop").textContent() ?? "", /confident.*45%/s);
    assert.match(await page.locator("#judge-method").textContent() ?? "", /provider classification/);
    await page.waitForFunction(() => /\/\/ → \{ score: 3, ageing: true \}/.test(document.getElementById("code")?.textContent ?? ""));
    assert.match(await page.locator("#code").textContent() ?? "", /\/\/ → \{ score: \{ "0": 0, "1": 0\.05, "2": 0\.15, "3": 0\.45, "4": 0\.35 \}, ageing: \{ true: 0\.87, false: 0\.13 \} \}/);
    await page.locator('#code .tok-comment[data-source="result"]').first().hover();
    assert.equal(await page.locator("#judge-result.lit").count(), 1, "the echo lights the result");
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    assert.match(await page.locator("#judge-answers pre").textContent() ?? "", /"method": "provider_classification"/);

    // A change after the call: the result greys out and leaves the code, until judged again.
    await page.getByLabel("State", { exact: true }).fill("Wet stone and lime zest.");
    await page.waitForFunction(() => !/\/\/ →/.test(document.getElementById("code")?.textContent ?? ""));
    assert.equal(await page.locator("#judge-result.stale").count(), 1);
    assert.match(await page.locator("#judge-result-note").textContent() ?? "", /previous state/);

    // Shapes: an object as JSON, a conversation as turns; each keeps its own state; a bad object is refused before any call.
    await page.locator('#judge-shape [data-shape="fields"]').click();
    await page.waitForFunction(() => /const state = \{\n  note: "Dusk, edge of the oak grove/.test(document.getElementById("code")?.textContent ?? ""));
    await page.getByLabel("State (JSON object)").fill('{"note": "Wet stone", "price_eur": 12}');
    await page.waitForFunction(() => /price_eur: 12/.test(document.getElementById("code")?.textContent ?? ""));
    await page.getByLabel("State (JSON object)").fill("[1]");
    assert.match(await page.locator("#judge-state-error").textContent() ?? "", /JSON object/);
    assert.equal(await page.locator("#judge-run").isDisabled(), true);
    await page.getByLabel("State (JSON object)").fill('{"note": "Wet stone", "price_eur": 12}');
    await page.locator('#judge-shape [data-shape="conversation"]').click();
    await page.waitForFunction(() => /role: "assistant", content: "From the field notes/.test(document.getElementById("code")?.textContent ?? ""));
    await page.getByLabel("user turn 1").fill("Anything for a decade in the cellar?");
    await page.waitForFunction(() => /content: "Anything for a decade/.test(document.getElementById("code")?.textContent ?? ""));
    await page.locator("#judge-run").click();
    await page.waitForFunction(() => document.getElementById("judge-usage")?.textContent?.startsWith("judged"));
    assert.deepEqual((bodies[1]!.state as { messages: Array<{ role: string }> }).messages.map((m) => m.role), ["user", "assistant"], "a conversation is the state's messages array on Jev");
    await page.locator('#judge-shape [data-shape="text"]').click();
    await page.waitForFunction(() => /const state = "Wet stone and lime zest\."/.test(document.getElementById("code")?.textContent ?? ""), null, { timeout: 5000 });

    // The device remembers the state and the questions; a result is never remembered. Reset restores the example.
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mode === "judge");
    assert.equal(await page.getByLabel("State", { exact: true }).inputValue(), "Wet stone and lime zest.");
    assert.deepEqual(await page.locator(".question .qname").allTextContents(), ["score", "ageing"]);
    assert.equal(await page.locator("#judge-result").isHidden(), true, "a result is not remembered");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    assert.equal(await page.getByLabel("State", { exact: true }).inputValue().then((v) => v.slice(0, 15)), "Dusk, edge of t");
    assert.deepEqual(await page.locator(".question .qname").allTextContents(), ["id_certainty", "juvenile_present"]);
    // Chat mode is what it was.
    await page.locator("#mode-chat").click();
    await page.waitForFunction(() => document.body.dataset.mode === "chat");
    assert.equal(await page.locator("#transcript article").count(), 2);
    assert.match(await page.locator("#code").textContent() ?? "", /ResponseStream/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await close(demo.server);
  }
});
