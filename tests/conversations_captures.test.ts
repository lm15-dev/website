/**
 * "Keep a conversation" shows what scripts/capture-conversations.py recorded
 * when it ran the page's own Python programs. The recordings must say what the
 * prose says they say.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import captures from '../src/data/conversations-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };

const { steps, facts } = captures;

test('the first answer, then the parts of the model message: sealed reasoning, then text', () => {
  assert.ok(steps.start.output.trim());
  assert.equal(steps.parts.output, 'thinking\ntext\n');
  const [thinking, text] = facts.first_parts;
  assert.deepEqual([thinking!.characters, thinking!.sealed, text!.sealed], [0, true, false], 'the reasoning holds no text, only a sealed copy');
  // Every answer the loop kept, as saved to the file, held its sealed reasoning.
  for (const parts of facts.assistant_parts) assert.deepEqual(parts.map(p => [p.type, p.sealed]), [['thinking', true], ['text', false]]);
});

test('keeping the whole message cost more input tokens than keeping its text', () => {
  assert.ok(facts.whole_or_text.whole.input_tokens > facts.whole_or_text.text_only.input_tokens);
  assert.ok(facts.whole_or_text.whole.text && facts.whole_or_text.text_only.text);
});

test('the loop asked the three questions, and each turn sent more tokens than the last', () => {
  for (const question of TOUR.conversation.questions) assert.ok(steps.loop.output.includes(`> ${question}\n`), question);
  const [a, b, c] = steps.loop.input_tokens;
  assert.ok(a! < b! && b! < c!, `${a}, ${b}, ${c}`);
  assert.deepEqual(steps.loop.output.match(/^\d+ tokens in$/gm)?.map(x => parseInt(x)), steps.loop.input_tokens);
});

test('the next day, "those" was understood: the answer names animals and the hazelnuts', () => {
  assert.match(steps.next_day.output, /hazelnut/i);
  assert.match(steps.next_day.output, /rodent|mice|squirrel|deer|raccoon/i);
});
