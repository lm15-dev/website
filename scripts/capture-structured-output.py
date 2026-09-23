"""Record the real answers "Get structured output" can show.

Steps (with MODEL): a note with no answer format; the same note with the
sightings schema; the barn note with that schema (the trap: its places don't
fit); the barn note with "other" added (the fix); the deer note (uncertain
species). Then, across providers: the same schema request, the barn trap, and
what each provider did with the answer format (carried, translated, dropped,
refused). Writes src/data/structured-output-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-structured-output.py

The requests are built from src/data/tour-text.json, exactly as the page's code
builds them (tests/structured_output_captures.test.ts checks the wording).
Re-recording changes the answers; re-read the page afterwards.
"""
import datetime
import json
import pathlib

from lm15 import Config, LMRouter, Message, Request, RouterConfig
from lm15.serde import request_to_dict

MODEL = "openai-codex:gpt-5.6-sol"
PROVIDERS = [
    "openai:gpt-5-mini",
    "anthropic:claude-haiku-4-5",
    "gemini:gemini-2.5-flash",
    "openrouter:openai/gpt-4o-mini",
    "deepseek:deepseek-chat",
    "zai:glm-4.5-air",
]
ROOT = pathlib.Path(__file__).parent.parent
X = json.loads((ROOT / "src/data/tour-text.json").read_text())["extract"]
OUT = ROOT / "src/data/structured-output-captures.json"


def schema(other: bool) -> dict:
    places = X["places"] + ([X["other"]] if other else [])
    return {
        "type": "object",
        "properties": {
            "sightings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "species": {"type": "string", "description": X["speciesDescription"]},
                        "count": {"type": "integer"},
                        "place": {"type": "string", "enum": places},
                    },
                    "required": ["species", "count", "place"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["sightings"],
        "additionalProperties": False,
    }


def fmt(other: bool) -> dict:
    return {"type": "json_schema", "name": "sightings", "schema": schema(other), "strict": True}


def request(model: str, note: str, response_format: dict | None) -> Request:
    config = Config(response_format=response_format) if response_format else Config()
    return Request(model=model, system=X["system"], messages=[Message.user(X["notes"][note])], config=config)


def run(router: LMRouter, req: Request) -> dict:
    out = {"request": request_to_dict(req)}
    try:
        r = router.complete(req)
    except Exception as error:
        return {**out, "error": f"{type(error).__name__}: {error}"}
    return {
        **out,
        "model": r.model,
        "text": r.text,
        "data": r.json,
        "finish_reason": r.finish_reason,
        "input_tokens": r.usage.input_tokens,
        "output_tokens": r.usage.output_tokens,
        "adaptations": [{"field": a.field, "action": a.action, "reason": a.reason} for a in r.adaptations],
    }


router = LMRouter()
strict = LMRouter(RouterConfig(adaptations="refuse"))
steps = {
    "plain": run(router, request(MODEL, "stream", None)),
    "ask": run(router, request(MODEL, "stream", fmt(False))),
    "trap": run(router, request(MODEL, "barn", fmt(False))),
    "fixed": run(router, request(MODEL, "barn", fmt(True))),
    "deer": run(router, request(MODEL, "deer", fmt(True))),
}
providers = {
    model: {
        "ask": run(router, request(model, "stream", fmt(True))),
        "trap": run(router, request(model, "barn", fmt(False))),
    }
    for model in PROVIDERS
}
# What a provider that cannot carry the schema does, and the two ways out.
extras = {
    "zai_refuse": run(strict, request("zai:glm-4.5-air", "stream", fmt(True))),
    "deepseek_json_object": run(router, Request(
        model="deepseek:deepseek-chat",
        system=X["system"] + " Answer in JSON.",
        messages=[Message.user(X["notes"]["stream"])],
        config=Config(response_format={"type": "json_object"}),
    )),
}

OUT.write_text(json.dumps({
    "model": MODEL,
    "date": datetime.date.today().isoformat(),
    "steps": steps,
    "providers": providers,
    "extras": extras,
}, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}")
for name, step in steps.items():
    print(f"\n== {name}: {step.get('finish_reason')} {step.get('input_tokens')}/{step.get('output_tokens')}")
    print(step.get("text") or step.get("error"))
for model, runs in providers.items():
    for name, step in runs.items():
        shown = step.get("error") or step.get("text")
        adapted = [(a["field"], a["action"]) for a in step.get("adaptations", [])]
        print(f"{model:32} {name:5} {adapted} {shown[:150]!r}")
for name, step in extras.items():
    print(f"{name}: {(step.get('error') or step.get('text'))[:200]!r}")
