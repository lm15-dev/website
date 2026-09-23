"""Record the real exchanges "Call your own functions" shows.

Runs the page's tool loop twice against a real model: once with the tool's
input left undescribed, once described. Writes every turn (the calls the model
asked for, what the search returned, the final answer) to
src/data/function-tools-captures.json, with the model and the date.

    cd ../lm15-python && uv run python ../website/scripts/capture-function-tools.py

Re-recording changes the answers. The page's prose describes them (for example,
that the undescribed search found nothing), so re-read the page afterwards.
"""
import datetime
import json
import pathlib

from lm15 import FunctionTool, LMRouter, Message, Request
from lm15.serde import request_to_dict

MODEL = "openai-codex:gpt-5.6-sol"
ROOT = pathlib.Path(__file__).parent.parent
TOUR = json.loads((ROOT / "src/data/tour-text.json").read_text())
OUT = ROOT / "src/data/function-tools-captures.json"


def search_sightings(query):
    query = query.lower()
    return [s for s in TOUR["sightings"] if query in (s["species"], s["place"], s["date"])]


def tool(described: bool) -> FunctionTool:
    query = {"type": "string", **({"description": TOUR["queryDescription"]} if described else {})}
    return FunctionTool(
        name=TOUR["tool"],
        description=TOUR["toolDescription"],
        parameters={"type": "object", "properties": {"query": query}, "required": ["query"]},
    )


def exchange(sightings_tool: FunctionTool) -> dict:
    router = LMRouter()
    messages = [Message.user(TOUR["toolQuestion"])]
    turns = []
    for _ in range(TOUR["maxTurns"]):
        request = Request(model=MODEL, system=TOUR["system"], messages=messages, tools=[sightings_tool])
        response = router.complete(request)
        messages.append(response.message)
        turn = {
            "request": request_to_dict(request),
            "finish_reason": response.finish_reason,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "calls": [{"name": c.name, "input": c.input} for c in response.tool_calls],
            "text": response.text,
        }
        turns.append(turn)
        if response.finish_reason != "tool_call":
            break
        results = {c.id: json.dumps(search_sightings(**c.input)) for c in response.tool_calls}
        turn["results"] = list(results.values())
        messages.append(Message.tool(results))
    return {"model": response.model, "turns": turns}


captures = {
    "model": MODEL,
    "date": datetime.date.today().isoformat(),
    "vague": exchange(tool(described=False)),
    "described": exchange(tool(described=True)),
}
OUT.write_text(json.dumps(captures, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}")
for name in ("vague", "described"):
    print(f"\n== {name}")
    for turn in captures[name]["turns"]:
        print(turn["finish_reason"], turn["calls"], turn.get("results"), repr(turn["text"]), f'{turn["input_tokens"]}/{turn["output_tokens"]}')
