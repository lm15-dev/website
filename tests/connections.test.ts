/**
 * The site's provider list is the SDK registry's, placed: every provider the
 * pinned runtime package knows is either offered (connections.ts) or named in
 * NOT_OFFERED with a reason, never silently missing; and every fact a page
 * shows about a provider — its key variable, whether it is keyless or
 * judgments-only — is read from the registry, not kept beside it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDERS, lookup } from "@lm15/lm15/browser";
import { CONNECTIONS, NOT_OFFERED } from "../src/playground/connections.ts";
import { CATALOG_PROVIDERS, NOT_ON_MODELS_DEV } from "../src/data/model-catalog.ts";
import { judgmentsOnly, keyless } from "../src/playground/experience.ts";

const offered = CONNECTIONS.map((c) => c.id).filter((id) => id !== "custom");

test("every registry provider is offered or excluded with a reason, and nothing else is named", () => {
  for (const id of PROVIDERS.keys()) {
    const placed = Number(offered.includes(id)) + Number(id in NOT_OFFERED);
    assert.equal(placed, 1, `${id}: ${placed === 0 ? "the SDK has it and the site neither offers nor excludes it" : "both offered and excluded"}`);
  }
  for (const id of [...offered, ...Object.keys(NOT_OFFERED)]) assert.ok(PROVIDERS.has(id), `${id}: named by the site, unknown to the SDK registry`);
  for (const [id, reason] of Object.entries(NOT_OFFERED)) assert.ok(reason.trim().length > 10, `${id}: an exclusion needs its reason`);
  assert.equal(new Set(offered).size, offered.length, "a provider offered twice");
});

test("what a page shows about a provider is the registry's", () => {
  for (const c of CONNECTIONS.filter((c) => c.id !== "custom")) {
    const definition = lookup(c.id)!;
    assert.equal(c.env, definition.access.envKeys[0] ?? "", `${c.id}: key variable`);
    assert.equal(keyless(c.id), definition.placeholderKey !== undefined, `${c.id}: keyless`);
    assert.equal(judgmentsOnly(c.id), definition.dialect === "typesafe", `${c.id}: judgments only`);
    assert.equal(c.judgmentsOnly === true, judgmentsOnly(c.id), `${c.id}: the connection's flag`);
    assert.ok(c.model.length > 0 && c.label.length > 0, `${c.id}: label and default model`);
    // Offered means a page can hold the credential: a pasted key or none.
    assert.equal(definition.access.credentialPolicy === "key" || definition.access.credentialPolicy === "oauth-unless-explicit", true, `${c.id}: offered but not key-based`);
    assert.equal(definition.access.host, undefined, `${c.id}: a cloud door needs settings a page does not collect`);
  }
});

test("every offered key provider has a model source: models.dev or a stated absence", () => {
  for (const c of CONNECTIONS.filter((c) => c.env && !c.judgmentsOnly)) {
    const mapped = c.id in CATALOG_PROVIDERS;
    assert.notEqual(mapped, c.id in NOT_ON_MODELS_DEV, `${c.id}: needs exactly one of CATALOG_PROVIDERS or NOT_ON_MODELS_DEV`);
  }
});
