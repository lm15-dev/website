/**
 * The exchanges "Call your own functions" shows were recorded by
 * scripts/capture-function-tools.py. They must be exchanges about the page's
 * question, tool and records: the same wording (tour-text.json), each result
 * exactly what the page's search returns for the model's query.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import captures from '../src/data/function-tools-captures.json' with { type: 'json' };
import TOUR from '../src/data/tour-text.json' with { type: 'json' };

type Turn = { request: { system?: string; messages: { role: string; parts: { type: string; text?: string }[] }[]; tools: { name: string; parameters: { properties: { query: { description?: string } } } }[] }; calls: { name: string; input: { query: string } }[]; results?: string[] };
const search = (query: string) => TOUR.sightings.filter(s => [s.species, s.place, s.date].includes(query.toLowerCase()));

test('each recorded exchange is the page question, tool and records', () => {
  for (const [run, described] of [['vague', false], ['described', true]] as const) {
    const turns = captures[run].turns as Turn[];
    const first = turns[0]!.request;
    assert.equal(first.system, TOUR.system, run);
    assert.equal(first.messages[0]!.parts[0]!.text, TOUR.toolQuestion, run);
    assert.equal(first.tools[0]!.name, TOUR.tool, run);
    assert.equal(first.tools[0]!.parameters.properties.query.description, described ? TOUR.queryDescription : undefined, run);
    for (const turn of turns) {
      turn.calls.forEach((call, i) => assert.deepEqual(JSON.parse(turn.results![i]!), search(call.input.query), `${run}: the result is the page's search for ${call.input.query}`));
    }
    assert.equal(turns.at(-1)!.calls.length, 0, `${run}: the exchange ends with an answer`);
  }
  // The page's prose: the undescribed search found nothing; the described one found the grove's three.
  assert.deepEqual(JSON.parse((captures.vague.turns[0] as Turn).results![0]!), []);
  assert.equal(JSON.parse((captures.described.turns[0] as Turn).results![0]!).length, 3);
});
