/**
 * The answers "Make your first request" shows were recorded by
 * scripts/capture-first-request.py. They must be answers to the requests the
 * page's code builds: the same wording (tour-text.json), the same shape.
 * Re-recording changes the answers; re-read the page's prose afterwards.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import captures from '../src/data/first-request-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };

type Canonical = { system?: string; messages: { role: string; parts: { type: string; text: string }[] }[]; config?: { max_tokens?: number } };
const steps = captures.steps as Record<string, { request: Canonical; text?: string | null; error?: string }>;
const said = (r: Canonical) => r.messages.map(m => `${m.role}: ${m.parts.map(p => p.text).join('')}`);

test('each recorded answer answers the request the page shows', () => {
  assert.match(captures.model, /^openai-codex:/);
  assert.deepEqual(said(steps.first!.request), [`user: ${TOUR.prompt}`]);
  assert.equal(steps.first!.request.system, undefined);
  for (const name of ['instructed', 'streamed']) {
    assert.equal(steps[name]!.request.system, TOUR.system, name);
    assert.deepEqual(said(steps[name]!.request), [`user: ${TOUR.prompt}`], name);
  }
  assert.deepEqual(said(steps.forgetful!.request), [`user: ${TOUR.followUp}`]);
  assert.equal(steps.forgetful!.request.system, TOUR.system);
  // The follow-up carries the instructed answer, word for word, between the two questions.
  assert.deepEqual(said(steps.followup!.request), [`user: ${TOUR.prompt}`, `assistant: ${steps.instructed!.text}`, `user: ${TOUR.followUp}`]);
  assert.equal(steps.limited!.request.config?.max_tokens, TOUR.tinyLimit);
  assert.match(steps.limited!.error ?? '', /config\.max_tokens/);
});
