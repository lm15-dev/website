/**
 * The answers "Connect a provider" shows were recorded by
 * scripts/capture-providers.py: each must answer the page's question, for
 * the model the page names, and the errors must be the ones the prose describes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import captures from '../src/data/providers-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };

type Step = { request: { model: string; system?: string; messages: { parts: { text: string }[] }[] }; text?: string; error?: string };
const steps = captures.steps as Record<string, Step>;

test('each recorded answer answers the page question, for the model the page names', () => {
  for (const model of TOUR.connect.models) {
    const s = steps[model]!;
    assert.equal(s.request.model, model);
    assert.equal(s.request.system, TOUR.system, model);
    assert.equal(s.request.messages[0]!.parts[0]!.text, TOUR.prompt, model);
    assert.ok(s.text, `${model} answered`);
  }
  assert.equal(steps.local!.request.model, TOUR.connect.localModel);
  assert.ok(steps.local!.text);
  assert.match(steps.no_key!.error!, /^MissingCredentialError: .*ANTHROPIC_API_KEY/);
  // One kind for a missing model, whichever provider answers (contract MAP-15, 2026-09-24).
  assert.match(steps.wrong_model!.error!, /^UnsupportedModelError: .*anthropic, HTTP 404/);
  assert.match(steps.wrong_provider!.error!, /^UnsupportedModelError: .*openai, HTTP 404/);
  // The prose says the local model called chipmunks nocturnal.
  assert.match(steps.local!.text!, /Chipmunks[\s\S]*nocturnal/);
});
