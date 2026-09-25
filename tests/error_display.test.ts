import assert from "node:assert/strict";
import { test } from "node:test";
import { RateLimitError } from "@lm15/lm15/browser";
import { displayError, translatePythonError } from "../src/playground/error-display.ts";

test("JavaScript display uses the SDK formatter without mutating the provider message", () => {
  const error = new RateLimitError("no capacity", {
    provider: "azure", status: 429, requestId: "request-123", retryAfter: 39,
    rateLimitHeaders: { "x-ratelimit-limit-requests": ["1"], "x-ratelimit-remaining-requests": ["-1"] },
  });
  const message = error.message;
  const rendered = displayError(error);
  assert.match(rendered, /request-123/);
  assert.match(rendered, /Retry advice: 39/);
  assert.match(rendered, /x-ratelimit-remaining-requests/);
  assert.equal(error.message, message);
  assert.equal(displayError(new Error("ordinary")), "ordinary");
});

test("Python multiline diagnostics survive translation without traceback source", () => {
  const raw = new Error('Traceback (most recent call last):\n  File "<exec>", line 1\n    hidden_source()\nlm15.errors.RateLimitError: no capacity (azure, HTTP 429, request request-123)\n\n  Retry advice: 39 seconds (not a guarantee).\n  Provider rate-limit headers (raw; advisory): {"x-ratelimit-limit-requests": ["1"]}\n\n  To fix:\n    - Check limits\n');
  const error = translatePythonError(raw, new AbortController().signal);
  assert.equal(error.name, "RateLimitError");
  assert.match(displayError(error), /Retry advice: 39/);
  assert.match(displayError(error), /x-ratelimit-limit-requests/);
  assert.ok(!displayError(error).includes("hidden_source"));
  assert.ok(!displayError(error).includes("Traceback"));
});

test("Python chained exceptions select the final failure; abort stays stopped", () => {
  const controller = new AbortController();
  const raw = new Error('ValueError: first\n\nDuring handling...\n\nTraceback...\nlm15.errors.AuthError: final\n\n  To fix:\n    - Log in');
  assert.equal(translatePythonError(raw, controller.signal).name, "AuthError");
  assert.match(translatePythonError(raw, controller.signal).message, /^final\n/);
  controller.abort();
  assert.equal(translatePythonError(raw, controller.signal).message, "stopped");
});
