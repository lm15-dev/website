# Facts: Get structured output

Checked on 23 September 2026. "Recorded" means in
`src/data/structured-output-captures.json` (`scripts/capture-structured-output.py`);
"run" means a live call made while preparing the pack, not recorded.

## The answer format, in LM15

- A request's settings take an answer format with exactly two shapes:
  - `{"type": "json_object"}`: any valid JSON, any shape.
  - `{"type": "json_schema", "schema": {...}, "name"?: str, "strict"?: bool}`:
    this shape.
  Anything else (a provider's own spelling) is refused; provider-specific
  options go in the settings' extensions. LM15 never rewrites the schema; a
  provider that rejects a keyword answers with its own error.
- Reading the answer (all six fall back to parsing the answer's JSON text):

  | Language | Read it |
  |---|---|
  | Python | `response.data` (a dict), `response.json`, `response.parse_json()` |
  | TypeScript | `response.data` (JSON value; the example narrows it with a type) |
  | Rust | `response.data()` → `Option<serde_json::Value>` |
  | Go | `response.ParseJSON(&v)` fills your own struct; `response.Data()`, `response.JSON()` |
  | R | `parse_json(response)` → a list |
  | Julia | `parse_json(response)` → a dict |

## Recorded (gpt-5.6-sol, OpenAI Codex)

System instruction for every step: "You are the field assistant for a
wildlife research station. Turn each field note into sighting records."

- **No answer format, stream note** → a Markdown table, not JSON. The data
  accessor returns nothing (the text doesn't parse). 59 tokens in, 131 out.
- **Schema, stream note** → exactly the shape: badger 3 stream, fox 1 stream.
  129 in, 41 out. The model left out the limp and the times: the schema has
  no field for them.
- **Schema, barn note** ("owl calling from the old barn roof... two hares in
  the barn field") → owl in **oak grove**, hares in meadow.
- **Schema with "other"** → owl in **other**, hares in meadow.
- **Deer note** ("roe or fallow") → species "deer": the model didn't guess.

## Recorded across providers (same requests)

| Provider, model | Schema request | Barn trap (three places) | What LM15 did |
|---|---|---|---|
| OpenAI, gpt-5-mini | shape followed | owl → meadow | sent as is |
| Anthropic, claude-haiku-4-5 | shape followed | owl → meadow | translated to Anthropic's form; also recorded `config.max_tokens` *defaulted* (Anthropic requires a limit) |
| Gemini, gemini-2.5-flash | shape followed | "owl" → meadow | translated to Gemini's form |
| OpenRouter, openai/gpt-4o-mini | shape followed | owl → oak grove | sent as is |
| DeepSeek, deepseek-chat | provider error: "This response_format type is unavailable now" (HTTP 400) | same error | sent; DeepSeek refused |
| Z.AI, glm-4.5-air | Markdown, not JSON | Markdown | **dropped** the schema and recorded it on the response (Python) |

- Z.AI's recorded reason: "this server accepts response_format type
  'json_schema' and does not apply it; use {'type': 'json_object'} and
  describe the shape in the prompt".
- With the router set to refuse adaptations
  (`RouterConfig(adaptations="refuse")` in Python), the same Z.AI request
  raises before sending: `UnsupportedFeatureError: zai:
  config.response_format would be dropped: ...` (recorded, `extras.zai_refuse`).
- DeepSeek with `{"type": "json_object"}` and "Answer in JSON." added to the
  instruction: valid JSON, **its own shape** (species, count, notes, time,
  location; no place). JSON is not your shape (recorded,
  `extras.deepseek_json_object`).

## Run, not recorded

- The fix across models (barn note, with "other"): gpt-5.6-sol, gpt-5-mini,
  claude-haiku-4-5 and gemini-2.5-flash all put the owl under "other". The
  hares split: meadow (gpt-5.6-sol, claude-haiku-4-5), other (gpt-5-mini,
  gemini-2.5-flash).
- Deer note without a way to express doubt, earlier run: gpt-5.6-sol wrote
  "unidentified deer" once and "deer" once; no model tested guessed roe or
  fallow.

## Differences between languages

- **A provider that would ignore the schema (Z.AI):** Python and TypeScript
  drop it and record an adaptation on the response (`response.adaptations`);
  both checked. R and Julia refuse before sending (checked offline:
  R: "zai: JSON schema output cannot be represented by this provider's wire
  format."; Julia: "JSON schema enforcement cannot be carried by this
  provider (zai)"). Rust and Go implement the same adaptation rule as Python
  and TypeScript; not checked for this case.
- **Adaptations on the response:** Python, TypeScript, Rust, Go carry them.
  R and Julia have none. A page must not tell R or Julia readers to read them.
- **The example's code differences** (in `code.md`): Go fills a typed struct
  with `ParseJSON`; TypeScript narrows the data with a type; Python, R and
  Julia index into a dict/list; Rust indexes a `serde_json::Value`. The TypeScript
  example annotates the request (`const request: Request`) so the answer
  format's `type` keeps its literal type.

## Code checks

- Every recipe runs in all six languages against a local stand-in server that
  answers the schema request with the stream note's records; every language
  sends the same request as Python (`npm run test:docs-examples`).
- Every line fits its code box (`tests/docs_example_widths.test.ts`).
