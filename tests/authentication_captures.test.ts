/**
 * "Set up authentication" shows Python files from src/data/authentication/
 * and what scripts/capture-authentication.py recorded when it ran them. Each
 * recording must be of the file as it is now, and must show what the prose
 * says it shows.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import captures from '../src/data/authentication-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };
import { WIDTH } from '../src/data/tour-examples.ts';

const DIR = join(import.meta.dirname, '../src/data/authentication');
type Step = { code: string; output: string; error?: string; model?: string };
const steps = captures.steps as Record<string, Step>;
const file = (name: string) => readFileSync(join(DIR, `${name}.py`), 'utf8');
const RECORDED_AS: Record<string, string> = { connect_again: 'connect', no_person: 'connect' };

test('every recording is of the example as it is now', () => {
  for (const [step, run] of Object.entries(steps)) assert.equal(run.code, file(RECORDED_AS[step] ?? step), `${step}: re-run the capture script`);
  for (const name of readdirSync(DIR)) assert.ok(steps[name.replace(/\.py$/, '')], `${name} was never recorded`);
});

test('every example fits its code box', () => {
  for (const name of readdirSync(DIR)) {
    for (const line of file(name.replace(/\.py$/, '')).split('\n')) assert.ok(line.length <= WIDTH, `${name} (${line.length}): ${line}`);
  }
});

test('the examples ask the station question, with its instructions', () => {
  const flat = (code: string) => code.replace(/"\s*\n\s*"/g, '').replace(/\s+/g, ' ');
  for (const name of ['request', 'connect']) {
    assert.ok(flat(file(name)).includes(TOUR.prompt), name);
    assert.ok(flat(file(name)).includes(TOUR.system), `${name}: instructions`);
  }
});

test('the recordings show what the page says they show', () => {
  const s = steps;
  assert.match(s.doctor!.output, /=> env \$ANTHROPIC_API_KEY/);
  assert.match(s.explicit!.output, /=> explicit api_keys entry[\s\S]*~ env \$ANTHROPIC_API_KEY/);
  assert.equal(s.rotating!.output.match(/\(reading the key\)/g)?.length, 2, 'one read per request');
  assert.match(s.subscription!.output, /=> local OAuth credential ~\/\.codex\/auth\.json/);
  for (const step of ['connect', 'connect_again']) {
    const out = s[step]!.output;
    assert.match(out, /saved privately in ~\/\.config\/lm15\/credentials\.json/, step);
    assert.doesNotMatch(out, /Which provider|How do you want/, `${step}: nothing asked but the model`);
    assert.match(out, /Ready: openai-codex:gpt-5\.6-sol through .*Codex CLI login/, step);
  }
  assert.match(s.no_person!.error!, /^AuthOperationError: connect\(\) needs a person/);
  assert.match(s.managed!.output, /none saved[\s\S]*~ env \$ANTHROPIC_API_KEY: set, not consulted/);
  assert.ok(s.configure!.output.trim() && !s.configure!.error, 'the saved connection answered');
  assert.match(s.status!.output, /anthropic key from \$ANTHROPIC_API_KEY\n\s+ready until never\nopenai-codex via .*\n\s+ready until unknown/);
  assert.match(s.methods!.output, /^unverified .*browser\)\nunverified .*device code.*\nsupported .*Codex CLI login/m);
  assert.match(s.login!.output, /accounts\.x\.ai[\s\S]*enter this code:\s+••••-••••/);
  assert.doesNotMatch(s.login!.output, /[A-Z0-9]{4}-[A-Z0-9]{4}/, 'the device code is hidden');
  assert.match(s.logout!.error!, /^AuthOperationError: anthropic: signed out/);
});
