/**
 * "Ask for judgments with probabilities" shows Python files from
 * src/data/judgments/ and what scripts/capture-judgments.py recorded when it
 * ran them, in order, in one session. Each recording must be of the file as
 * it is now, and must show what the prose says it shows.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import captures from '../src/data/judgments-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };
import { WIDTH } from '../src/data/tour-examples.ts';

const DIR = join(import.meta.dirname, '../src/data/judgments');
type Step = { code: string; output: string; error?: string; model?: string };
const steps = captures.steps as Record<string, Step>;
const file = (name: string) => readFileSync(join(DIR, `${name}.py`), 'utf8');
const page = readFileSync(join(import.meta.dirname, '../src/content/docs/docs/judgments.mdx'), 'utf8');

test('every recording is of the example as it is now, and every example was recorded', () => {
  for (const [step, run] of Object.entries(steps)) assert.equal(run.code, file(step), `${step}: re-run the capture script`);
  for (const name of readdirSync(DIR)) assert.ok(steps[name.replace(/\.py$/, '')], `${name} was never recorded`);
  for (const [, name] of page.matchAll(/<PythonExample set="judgments" name="(\w+)"/g)) assert.ok(steps[name!], name);
});

test('every example fits its code box', () => {
  for (const name of readdirSync(DIR)) {
    for (const line of file(name.replace(/\.py$/, '')).split('\n')) assert.ok(line.length <= WIDTH, `${name} (${line.length}): ${line}`);
  }
});

test('the notes are the station notes the other pages use', () => {
  const flat = (code: string) => code.replace(/\\n"\s*\n\s*"/g, '\n');
  for (const note of Object.values(TOUR.extract.notes)) assert.ok(flat(file('ask') + file('table')).includes(note), note.slice(0, 40));
});

test('the recordings show what the page says they show', () => {
  const ask = steps.ask!.output;
  assert.match(ask, /\{'animal': 'badger', 'certainty': 2, 'hurt': True\}/);
  assert.match(ask, /'certainty': \{'0': 0\.0, '1': 0\.05, '2': 0\.95\}/);
  assert.match(ask, /'false': 0\.020000000000000018/);
  assert.match(ask, /^provider_classification$/m);
  assert.equal(steps.expected!.output.trim(), '1.95');
  const chat = steps.chat!.output;
  assert.match(chat, /\{'animal': 'badger', 'certainty': 2, 'hurt': True\}\nNone\n/);
  assert.match(chat, /config\.probabilities dropped/);
  assert.match(chat, /config\.max_tokens defaulted/);
  assert.match(steps.required!.error ?? '', /^UnsupportedFeatureError: .*typesafe/);
  const rows = steps.table!.output.trim().split('\n').map((l) => l.split(/\s+/));
  assert.deepEqual(rows, [['stream', 'badger', '1.97'], ['barn', 'owl', '0.95'], ['deer', 'deer', '0.04']]);
  for (const figure of ['1.97', '0.95', '0.04', '1.95', '0.95 on `confident`']) assert.ok(page.includes(figure), figure);
});
