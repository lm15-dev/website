/**
 * "Send images and documents" shows what scripts/capture-media.py recorded
 * when it ran the page's own Python programs, and the same files sent to other
 * models. The recordings must say what the prose says they say.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import captures from '../src/data/media-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };
import { mediaPrograms } from '../src/data/tour-examples.ts';

const s = captures.steps;
const p = captures.providers as Record<string, Record<'photo' | 'log', { text?: string; error?: string; input_tokens?: number }>>;

test('the recordings are of the page code, and its files are published', () => {
  const now = mediaPrograms('python', 'openai-codex', 'gpt-5.6-sol');
  assert.equal(s.photo.code, now.photo);
  assert.equal(s.log.code, now.log);
  for (const name of [TOUR.media.photo.file, TOUR.media.log.file, 'oak-grove-log.png']) assert.ok(existsSync(join(import.meta.dirname, '../public/docs-media', name)), name);
});

test('the photo: a badger, foraging, called American (the photo is from France)', () => {
  assert.match(s.photo.output, /badger/i);
  assert.match(s.photo.output, /American/);
  assert.match(s.photo.output, /nose|forag|sniff/i);
  assert.ok(Number(s.photo.output.match(/(\d+) tokens in/)![1]) > 500, 'the photo costs far more than the question');
});

test('the log: counted right', () => {
  assert.match(s.log.output, /wood mice on 2 nights/i);
  assert.match(s.log.output, /badgers on 2 nights/i);
  assert.match(s.log.output, /roe deer on 1 night/i);
});

test('six models on the photo: all answered, some wrong in the ways the prose names', () => {
  for (const [model, row] of Object.entries(p)) assert.ok(row.photo.text, `${model} took the photo`);
  assert.match(p['anthropic:claude-haiku-4-5']!.photo.text!, /porcupine/i);
  assert.match(p['deepseek:deepseek-chat']!.photo.text!, /skunk/i);
  assert.match(p['deepseek:deepseek-chat']!.photo.text!, /badger/i);
  assert.ok(Object.values(p).some(row => /badger/i.test(row.photo.text!) && !/skunk|porcupine/i.test(row.photo.text!)), 'some saw a badger');
  assert.match(p['anthropic:claude-haiku-4-5']!.log.text!, /five animal species/i);
  const tokens = Object.values(p).map(row => row.photo.input_tokens!);
  assert.ok(Math.max(...tokens) > 10 * Math.min(...tokens), 'the cost differs by far more than ten times');
});

test('the PDF is refused on the Chat Completions wire, before anything is sent', () => {
  for (const model of ['deepseek:deepseek-chat', 'openrouter:openai/gpt-4o-mini']) {
    assert.match(p[model]!.log.error!, /^UnsupportedFeatureError: .*document part in a user message has no slot on the Chat Completions wire/);
  }
});
