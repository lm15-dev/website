/**
 * The answers "Get structured output" shows were recorded by
 * scripts/capture-structured-output.py. Each must answer the request the
 * page's code builds (tour-text.json's wording), and the facts the page relies
 * on must hold in the recording: plain text is not JSON, the trap put the owl
 * in a listed place, the fix put it under "other".
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import captures from '../src/data/structured-output-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };

const X = TOUR.extract;
type Step = { request: { system?: string; messages: { parts: { text: string }[] }[]; config?: { response_format?: { schema: { properties: { sightings: { items: { properties: { place: { enum: string[] } } } } } } } } }; text?: string | null; data?: { sightings: { species: string; place: string }[] } | null; error?: string };
const note = (s: Step) => s.request.messages[0]!.parts[0]!.text;
const places = (s: Step) => s.request.config?.response_format?.schema.properties.sightings.items.properties.place.enum;
const steps = captures.steps as Record<string, Step>;

test('each recorded answer answers the page request', () => {
  for (const [name, key, other] of [['plain', 'stream', null], ['ask', 'stream', false], ['trap', 'barn', false], ['fixed', 'barn', true], ['deer', 'deer', true]] as const) {
    const s = steps[name]!;
    assert.equal(s.request.system, X.system, name);
    assert.equal(note(s), X.notes[key], name);
    assert.deepEqual(places(s), other === null ? undefined : [...X.places, ...(other ? [X.other] : [])], name);
  }
  assert.equal(steps.plain!.data, null, 'the plain answer is not JSON');
  assert.ok(steps.ask!.data!.sightings.some(s => s.species === 'badger'));
  const owl = (s: Step) => s.data!.sightings.find(x => x.species.includes('owl'))!;
  assert.ok(X.places.includes(owl(steps.trap!).place), 'the trap put the owl in a listed place');
  assert.equal(owl(steps.fixed!).place, X.other, 'the fix put the owl under "other"');
});
