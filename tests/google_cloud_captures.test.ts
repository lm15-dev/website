/**
 * "Use Google Cloud" shows files from src/data/google-cloud/ (one per
 * language) and what scripts/capture-google-cloud.py recorded when it ran
 * them against a real Google Cloud project. Each recording must be of the
 * file as it is now, and must show what the prose says it shows.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import captures from '../src/data/google-cloud-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };
import { WIDTH } from '../src/data/tour-examples.ts';

const DIR = join(import.meta.dirname, '../src/data/google-cloud');
const PAGE = readFileSync(join(import.meta.dirname, '../src/content/docs/docs/google-cloud.mdx'), 'utf8');
const EXT = { python: 'py', typescript: 'ts', rust: 'rs', go: 'go' } as const;
type Language = keyof typeof EXT;
type Run = { code: string; output: string; error?: string; model?: string };
const steps = captures.steps as Record<string, Record<Language, Run>>;
const file = (name: string, language: Language) => readFileSync(join(DIR, `${name}.${EXT[language]}`), 'utf8');
const each = (step: string, check: (run: Run, language: Language) => void) => {
  for (const language of Object.keys(EXT) as Language[]) check(steps[step]![language], language);
};

test('every recording is of the example as it is now, in every language', () => {
  for (const [step, runs] of Object.entries(steps)) {
    for (const language of Object.keys(EXT) as Language[]) {
      assert.equal(runs[language]?.code, file(step, language), `${step}/${language}: re-run scripts/capture-google-cloud.py`);
    }
  }
  for (const name of readdirSync(DIR)) assert.ok(steps[name.replace(/\.\w+$/, '')], `${name} was never run`);
});

test('every example the page shows exists, and fits its code box', () => {
  for (const [, name] of PAGE.matchAll(/<CloudExample name="(\w+)"/g)) assert.ok(steps[name!], name);
  for (const name of readdirSync(DIR)) {
    for (const line of readFileSync(join(DIR, name), 'utf8').split('\n')) assert.ok(line.length <= WIDTH, `${name} (${line.length}): ${line}`);
  }
});

test('the examples ask the station question, with its instructions', () => {
  const flat = (code: string) => code.replace(/["']\s*(?:\+|,)?\s*\n\s*["']/g, '').replace(/\s+/g, ' ');
  for (const step of ['ask', 'platform', 'key', 'express', 'expired']) {
    each(step, (run, language) => {
      assert.ok(flat(run.code).includes(TOUR.prompt), `${step}/${language}: the question`);
      assert.ok(flat(run.code).includes(TOUR.system), `${step}/${language}: the instructions`);
    });
  }
});

test('the recordings show what the page says they show', () => {
  for (const step of ['ask', 'key', 'express']) {
    each(step, (run, language) => {
      assert.ok(run.output.trim() && !run.error, `${step}/${language}: an answer`);
      assert.equal(run.model, step === 'express' ? 'vertex-express:gemini-2.5-flash' : 'vertex:gemini-2.5-flash', `${step}/${language}`);
    });
  }
  each('doctor', (run, language) => {
    assert.match(run.output, /\? gcloud application default credentials file: authorized_user credentials in ~\/\.config\/gcloud\//, language);
    assert.match(run.output, new RegExp(`setting project: ${captures.project} \\(from gcloud's active configuration\\)`), language);
    assert.match(run.output, /setting location: global \(from default\)/, language);
  });
  each('platform', (run, language) => {
    assert.match(run.error ?? '', /named credential \\?"platform\\?"[\s\S]*answered nothing/, `${language}: a laptop is not the machine it names`);
  });
  each('expired', (run, language) => {
    assert.match(run.output, /Google OAuth refresh \(~\/\.config\/gcloud\/application_default_credentials\.json\): HTTP 400 \(invalid_grant\)/, language);
    assert.match(run.output, /To fix:\n\s+- the saved Google login .* run `gcloud auth application-default login`/, language);
  });
});

test('no recording carries a key, a token, or a real home folder', () => {
  const all = JSON.stringify(captures);
  assert.doesNotMatch(all, /AQ\.[A-Za-z0-9_.-]{20,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[A-Za-z0-9_.-]{20,}/);
  assert.doesNotMatch(all, /\/home\/|\/Users\//);
});
