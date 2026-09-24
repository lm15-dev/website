/**
 * "Handle errors and retries" shows what scripts/capture-errors.py recorded
 * when it ran the page's own Python programs against real providers. The
 * recordings must say what the prose says they say.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import captures from '../src/data/errors-captures.json' with { type: 'json' };
import { errorPrograms } from '../src/data/tour-examples.ts';

type Step = { model?: string; code?: string; output?: string; error?: string };
const s = captures.steps as Record<string, Step>;
const waits = (step: Step) => [...(step.output ?? '').matchAll(/waiting ([\d.]+) s/g)].map(m => Number(m[1]));

test('each recorded program is the page code, as it is now', () => {
  assert.equal(s.catch!.code, errorPrograms('python', 'openai-codex', 'gpt-5.6-sol').catch);
  const [provider, ...model] = s.retry!.model!.split(':');
  const retry = errorPrograms('python', provider!, model.join(':')).retry;
  assert.equal(s.retry!.code, retry);
  assert.equal(s.gave_up!.code, retry);
});

test('the missing model was caught as UnsupportedModelError, at every provider', () => {
  assert.match(s.catch!.output!, /^No such model at openai-codex\n/);
  assert.equal(s.catch!.error, undefined);
  const kinds = Object.values(captures.providers).map(p => p.class);
  assert.ok(kinds.length >= 8);
  assert.ok(kinds.every(k => k === 'UnsupportedModelError'), kinds.join(', '));
  // Some said 404, some 400: the prose says so.
  const statuses = new Set(Object.values(captures.providers).map(p => p.status));
  assert.ok(statuses.has(404) && statuses.has(400));
});

test('the retry waited once, as advised, then answered; the other run gave up after four attempts', () => {
  assert.equal(waits(s.retry!).length, 1, 'one refusal, then an answer');
  assert.equal(s.retry!.error, undefined);
  assert.ok(s.retry!.output!.split('\n').filter(Boolean).length >= 2, 'an answer followed the wait');
  const [advised, ...own] = waits(s.gave_up!);
  assert.ok(advised! > 0);
  assert.deepEqual(own, [4, 8], 'no advice after the first: the function waited 4, then 8 seconds');
  assert.match(s.gave_up!.error!, /^RateLimitError: /);
});

test('a rate-limit error says LM15 never retries; an unplaceable name is an UnknownModelError', () => {
  assert.match(s.rate_limit!.error!, /^RateLimitError: [\s\S]*lm15 never retries for you/);
  assert.match(s.unknown!.error!, /^UnknownModelError: could not route model 'haiku-4-5'/);
});
