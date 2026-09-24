/**
 * "Control generation" shows what scripts/capture-generation.py recorded when
 * it ran the page's own Python programs. The recordings must say what the
 * prose says they say.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import captures from '../src/data/generation-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };
import { generationPrograms } from '../src/data/tour-examples.ts';

const s = captures.steps as Record<string, { model: string; code: string; output: string }>;

test('each recording is of the page code, as it is now', () => {
  const now = generationPrograms('python', 'anthropic', 'claude-haiku-4-5');
  for (const name of ['short', 'temperature', 'stop']) assert.equal(s[name]!.code, now[name], name);
  for (const name of ['adapt', 'plan', 'refuse']) assert.equal(s[name]!.code, now.adapt, name);
});

test('the length limit cut the answer: finish reason length', () => {
  const lines = s.short!.output.trim().split('\n');
  assert.equal(lines.at(-1), 'length');
  assert.doesNotMatch(lines[0]!, /\.$/, 'the answer stops mid-sentence');
});

test('temperature 0 gave identical answers; temperature 1 gave different ones, one with a camera trap and one with tracks and scat', () => {
  const lines = s.temperature!.output.trim().split('\n');
  const at = (t: string) => lines.filter(l => l.startsWith(`${t} `));
  const [a, b] = at('0.0'); const [c, d] = at('1.0');
  assert.equal(a, b);
  assert.notEqual(c, d);
  assert.match(`${c}\n${d}`, /camera/);
  assert.match(`${c}\n${d}`, /tracks/);
  assert.match(`${c}\n${d}`, /scat/);
});

test('the stop sequence ended the list after three animals, with a heading the model added', () => {
  const out = s.stop!.output;
  assert.match(out, /^#/, 'a heading');
  assert.match(out, /1\..*\n2\..*\n3\./);
  assert.ok(!out.includes(TOUR.generation.stop));
  assert.equal(out.trim().split('\n').at(-1), 'stop');
});

test('three adaptations, the same in the preview, and the refusal on the seed', () => {
  const lines = ['config.max_tokens defaulted', 'config.seed dropped', 'config.temperature clamped'];
  for (const line of lines) assert.ok(s.adapt!.output.includes(line), line);
  assert.equal(s.plan!.output.trim(), lines.join('\n'));
  assert.equal(s.refuse!.output.trim(), 'Refused: config.seed');
  const r = Object.fromEntries(captures.records.map(x => [x.field, x]));
  assert.deepEqual([r['config.temperature']!.asked, r['config.temperature']!.applied], [1.5, 1]);
  assert.equal(r['config.seed']!.asked, 42);
  assert.equal(r['config.max_tokens']!.applied, 16384);
});
