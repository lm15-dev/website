# Get structured output

*Independent review draft · Python examples shown; the MDX source supports all six languages.*


Our station can [search its sightings](https://lm15.dev/docs/function-tools/), but someone has
to turn the observers’ notes into those records first. An observer might write
“three badgers came through overnight.” The program needs a species, a count,
and a place.

On this page, you’ll describe the records you want, read the answer as data,
and discover a mistake that no format check can catch.

You’ll need the setup from [Make your first request](https://lm15.dev/docs/first-request/).
The code follows your chosen language and provider. The recorded answers come
from `gpt-5.6-sol` through OpenAI Codex; your model may answer differently.
The short examples build on one another. The [complete program](#the-complete-program)
at the end includes the imports and setup.

## Start with a field note

Here is a note from the stream camera:

```python
note = (
    "Checked the stream camera this morning. Three badgers came "
    "through overnight, one of them limping. A fox passed later, "
    "just before dawn."
)
```

There are two records to extract: three badgers and one fox, both at the
stream. The note also mentions a limp and when the animals appeared. We’ll
start with species, count, and place, and return to those other details later.

Ask the assistant to turn the note into sighting records:

```python
request = Request(
    model="openai-codex:gpt-5.6-sol",
    system=(
        "You are the field assistant for a wildlife research "
        "station. Turn each field note into sighting records."
    ),
    messages=[Message.user(note)],
)
router = LMRouter()
response = router.complete(request)
print(response.text)
```

**Recorded answer — gpt-5.6-sol, 2026-09-23**

```text
| Species | Count | Time observed | Condition/notes | Detection method |
|---|---:|---|---|---|
| Badger | 3 | Overnight | One individual was limping | Stream camera |
| Fox | 1 | Just before dawn | No unusual condition noted | Stream camera |
```

That is a useful table for a person. For a program, it leaves work to do:
find the rows, split the columns, and decide whether “Stream camera” is a place
or a detection method. Another answer could use different headings or put the
same information in sentences.

Rather than teach our program to read every possible table, we can tell the
model what shape to return.

## Describe the record you want

A **schema** describes the structure of some data. Here we use JSON Schema to
ask for an object containing a list of sightings. Each sighting has three
fields:

| Field | What belongs there |
| --- | --- |
| `species` | Text: the animal’s common name, in the singular |
| `count` | An integer: how many animals were observed |
| `place` | One of the station’s three listed places |

Here is that description as code:

```python
places = ["oak grove", "stream", "meadow"]
sighting_schema = {
    "type": "object",
    "properties": {
        "sightings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "species": {
                        "type": "string",
                        "description": "Common name, singular.",
                    },
                    "count": {"type": "integer"},
                    "place": {
                        "type": "string",
                        "enum": places,
                    },
                },
                "required": ["species", "count", "place"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sightings"],
    "additionalProperties": False,
}
```

Read it from the outside in. The outer `object` has a `sightings` property.
That property is an `array`, meaning a list. Its `items` describe one sighting,
which is another object containing the three fields above.

Three details are worth noticing:

- **`required`** lists fields that must be present. Describing a field under
  `properties` does not, by itself, require it.
- **`enum`** lists the values an answer may take. Here, a place must be
  `oak grove`, `stream`, or `meadow`.
- **`additionalProperties`** is false, so these objects cannot grow extra
  fields that our program did not ask for.

You don’t need to learn every JSON Schema keyword to use this example. These
are enough to describe a list of records with a known shape.

## Ask for that shape

Keep the note and the instruction. Replace the earlier request with one that
includes the schema as its answer format:

```python
request = Request(
    model="openai-codex:gpt-5.6-sol",
    system=(
        "You are the field assistant for a wildlife research "
        "station. Turn each field note into sighting records."
    ),
    messages=[Message.user(note)],
    config=Config(response_format={
        "type": "json_schema",
        "name": "sightings",
        "schema": sighting_schema,
        "strict": True,
    }),
)
router = LMRouter()
response = router.complete(request)
print(response.data)
```

`strict` asks the provider to follow the schema exactly, where supported.

**Recorded answer — gpt-5.6-sol, 2026-09-23**

```text
{"sightings":[{"species":"badger","count":3,"place":"stream"},{"species":"fox","count":1,"place":"stream"}]}
```

Now there are two sightings, each with the same three fields. The counts are
numbers, not words embedded in a sentence, and both places are `stream`.
The response format supplied the structure; the model still had to interpret
“a fox” as one fox and connect both observations to the stream camera.

Notice what disappeared: the limp and the times. There is nowhere for them
in this schema. That is useful if you only need counts by species and place,
but not if you are monitoring animal health. Choose fields according to what
your program needs, and keep the original note so you can revisit what you
left out.

## Use the records

LM15 provides a way to read the JSON answer as your language’s data values.
You can work with the sightings rather than split up the response text:

```python
for s in response.data["sightings"]:
    print(s["count"], s["species"], "at", s["place"])
```

The loop reads the count, species, and place from each record. From here, you
could store the records or count sightings by species.

Parsing JSON and checking a schema are different operations. Parsing turns
JSON text into values; it does not check every schema rule or establish that
an observation is true. Before using an answer, check that the response
finished successfully and contains the data you expect. An error, a refusal,
or an interrupted answer is not an empty set of sightings.

There is also a less obvious problem: an answer can have exactly the right
shape and still put an animal in the wrong place.

## Give the model a way to say “other”

Try the same schema with a different note:

```python
note = (
    "Around midnight an owl was calling from the old barn roof, "
    "probably a tawny. Two hares in the barn field at first light."
)
```

Before sending it, look at the allowed places. Where could the owl go?

Run the schema request again with this note:

**Recorded answer — gpt-5.6-sol, 2026-09-23**

```text
{"sightings":[{"species":"tawny owl","count":1,"place":"oak grove"},{"species":"hare","count":2,"place":"meadow"}]}
```

The owl was on the barn roof. The answer places it in the **oak grove**.
That is an allowed value, so the record fits the schema. It does not fit the
note.

We created the problem by offering three places and requiring a choice.
The model had no permitted value for the barn. In the recorded tests, every
model that returned schema-shaped data misplaced the owl, although they did
not all choose the same wrong place.

Give it another option. Replace the schema with this version, which adds
`other` to the places:

```python
places = ["oak grove", "stream", "meadow", "other"]
sighting_schema = {
    "type": "object",
    "properties": {
        "sightings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "species": {
                        "type": "string",
                        "description": "Common name, singular.",
                    },
                    "count": {"type": "integer"},
                    "place": {
                        "type": "string",
                        "enum": places,
                    },
                },
                "required": ["species", "count", "place"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sightings"],
    "additionalProperties": False,
}
```

Run the same request again:

**Recorded answer — gpt-5.6-sol, 2026-09-23**

```text
{"sightings":[{"species":"tawny owl","count":1,"place":"other"},{"species":"hare","count":2,"place":"meadow"}]}
```

The owl now goes under **other**, where the station can review it instead of
silently adding a sighting to the grove.

The hares still go under `meadow`, even though the note says “barn field.”
That may be reasonable if *meadow* means any grassy field. It is wrong if
*meadow* names one particular survey site. An enum lists your categories; it
does not explain their boundaries. Describe what they mean when the distinction
matters.

**A schema controls the shape of an answer, not the truth of its contents.**
Give missing, uncertain, or out-of-list information somewhere honest to go.
Adding `other` helps with this example; it does not make every classification
correct.

## Check your provider

Answer formats depend on the provider and model, not only on LM15. These were
the results for the stream note in the recorded checks on 23 September 2026:

| Connection tested | Result |
| --- | --- |
| OpenAI Codex · `gpt-5.6-sol` | Returned the requested records |
| OpenAI · `gpt-5-mini` | Returned the requested records |
| Anthropic · `claude-haiku-4-5` | Returned the requested records |
| Gemini · `gemini-2.5-flash` | Returned the requested records |
| OpenRouter · `openai/gpt-4o-mini` | Returned the requested records |
| DeepSeek · `deepseek-chat` | Rejected this answer format |

These are checks of particular models and requests, not a promise about every
model from each provider. LM15 translates the shared answer format into the
provider’s form; the provider determines which schema features it supports.

There is also a format called `json_object`. It asks for JSON, but does not
specify the fields. In our DeepSeek run, it produced valid JSON containing
fields such as `location` and `time`, rather than our required `place` field.
Use a schema when your program depends on particular fields. “It parses as
JSON” is not the same as “it is the record I asked for.”

<details>
<summary>What if the provider would ignore the schema?</summary>

In the recorded Z.AI `glm-4.5-air` test, Python’s LM15 dropped the unsupported
schema and recorded that change on the response; the model returned Markdown.
TypeScript’s request plan reported the same drop. R and Julia instead refused
the request before sending it.

Do not continue as though a schema was applied when the SDK reports that it
was dropped. Use a connection that supports it, or handle the less constrained
answer explicitly. Where available, the adaptation policy can refuse such
changes before a request is sent.

</details>

## The complete program

Here are the pieces together: the schema with `other` available, the stream
note, the request, and the loop that reads its sightings.

```python
from lm15 import Config, LMRouter, Message, Request

places = ["oak grove", "stream", "meadow", "other"]
sighting_schema = {
    "type": "object",
    "properties": {
        "sightings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "species": {
                        "type": "string",
                        "description": "Common name, singular.",
                    },
                    "count": {"type": "integer"},
                    "place": {
                        "type": "string",
                        "enum": places,
                    },
                },
                "required": ["species", "count", "place"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sightings"],
    "additionalProperties": False,
}

note = (
    "Checked the stream camera this morning. Three badgers came "
    "through overnight, one of them limping. A fox passed later, "
    "just before dawn."
)

request = Request(
    model="openai-codex:gpt-5.6-sol",
    system=(
        "You are the field assistant for a wildlife research "
        "station. Turn each field note into sighting records."
    ),
    messages=[Message.user(note)],
    config=Config(response_format={
        "type": "json_schema",
        "name": "sightings",
        "schema": sighting_schema,
        "strict": True,
    }),
)
router = LMRouter()
response = router.complete(request)
print(response.data)

for s in response.data["sightings"]:
    print(s["count"], s["species"], "at", s["place"])
```

## Try it yourself

1. The stream note says one badger was limping. Does the structured answer
   preserve that information? What would you need to change if the station
   wanted to track injuries?
2. Consider “two deer, too far away to tell whether roe or fallow.” Should the
   species field say `roe deer`, `fallow deer`, or something less specific?
3. If the schema permits `other`, does that prevent a model from choosing
   the wrong named place?

<details>
<summary>Compare your reasoning</summary>

1. No. The current fields hold no health information. You would need to
   decide how to represent it, then add the relevant field and explain it to
   the model. Keep the original note rather than pretending the current
   extraction preserves everything.
2. Something less specific. In the recorded deer example, the model returned
   `deer`, count 2, at `oak grove`. It did not choose between the two species.
3. No. `other` makes an honest answer possible, but cannot ensure the model
   chooses it. The barn-field example still needs a clear definition of what
   the station calls a meadow.

</details>

## Next

Sometimes you want a decision rather than a record: which behavior was
observed, how certain an identification is, or whether a juvenile was present.
[Ask for judgments with probabilities](https://lm15.dev/docs/judgments/) uses structured
answers for those questions, with probabilities when the provider can measure
them.
