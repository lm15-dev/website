/**
 * Every docs example fits its code box without wrapping: WIDTH columns, what a
 * box shows at 1280px (the narrowest desktop layout, with "On this page" open).
 * Pieces of Rust and Go go inside `main`, so they get four columns fewer; whole
 * programs get WIDTH. Checked with a long model id, as a reader may choose one.
 * On a phone the boxes scroll sideways rather than wrap (DocsExample, code-theme).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECIPES } from '../src/data/docs-examples.ts';
import { WIDTH, tourPrograms } from '../src/data/tour-examples.ts';
import { exampleSource } from '../src/components/home-example/examples.ts';

const LANGUAGES = ['python', 'typescript', 'rust', 'go', 'r', 'julia'] as const;
const WHOLE = new Set(['tour-first', 'tour-program', 'tools-loop']);
/** The homepage's box: 64 columns at 1280px (measured). */
const HOME_WIDTH = 64;
const selection = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' };

test('every example the docs show fits its code box', () => {
  const over: string[] = [];
  for (const [name, recipe] of Object.entries(RECIPES)) {
    for (const language of LANGUAGES) {
      const limit = WHOLE.has(name) || !['rust', 'go'].includes(language) ? WIDTH : WIDTH - 4;
      for (const line of recipe({ language, ...selection }).text.split('\n')) {
        if (line.length > limit) over.push(`${name} ${language} (${line.length} > ${limit}): ${line}`);
      }
    }
  }
  for (const language of LANGUAGES) {
    for (const program of tourPrograms(language, selection.provider, selection.model)) {
      for (const line of program.source.split('\n')) if (line.length > WIDTH) over.push(`program ${program.name} ${language} (${line.length}): ${line}`);
    }
  }
  for (const language of LANGUAGES) {
    for (const line of exampleSource(language, selection.provider, selection.model).split('\n')) {
      if (line.length > HOME_WIDTH) over.push(`homepage ${language} (${line.length} > ${HOME_WIDTH}): ${line}`);
    }
  }
  assert.deepEqual(over, []);
});
