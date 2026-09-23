"""Record the real answers "Make your first request" shows.

Runs each step of the page once against a real model and writes what came back
to src/data/first-request-captures.json, with the model and the date. The page
shows these, labelled; tests/docs_examples_run.test.ts checks that the requests
recorded here are the ones the page's code builds.

    cd ../lm15-python && uv run python ../website/scripts/capture-first-request.py

Uses the router and whatever credential it finds for MODEL (by default the
OpenAI Codex sign-in). Costs a few small calls.

Re-recording changes the answers. The page's prose describes them (for
example, that the follow-up sent alone could not tell which animals were
meant), so re-read the page afterwards.
"""
import datetime
import json
import pathlib

from lm15 import Config, LMRouter, Message, Request, ResponseStream
from lm15.serde import request_to_dict

MODEL = "openai-codex:gpt-5.6-sol"
TOUR = json.loads((pathlib.Path(__file__).parent.parent / "src/data/tour-text.json").read_text())
OUT = pathlib.Path(__file__).parent.parent / "src/data/first-request-captures.json"

router = LMRouter()


def record(request: Request, r, pieces=None) -> dict:
    return {
        "request": request_to_dict(request),
        "text": r.text,
        "finish_reason": r.finish_reason,
        "input_tokens": r.usage.input_tokens,
        "output_tokens": r.usage.output_tokens,
        "model": r.model,
        **({"pieces": pieces} if pieces is not None else {}),
    }


def ask(request: Request) -> tuple[dict, object]:
    r = router.complete(request)
    return record(request, r), r


def streamed(request: Request) -> dict:
    s = ResponseStream(router.stream(request), request)
    pieces = sum(1 for _ in s)
    return record(request, s.response, pieces)


question = Message.user(TOUR["prompt"])
first = Request(model=MODEL, messages=[question])
instructed = Request(model=MODEL, system=TOUR["system"], messages=[question])
forgetful = Request(model=MODEL, system=TOUR["system"], messages=[Message.user(TOUR["followUp"])])
limited = Request(model=MODEL, messages=[question], config=Config(max_tokens=TOUR["tinyLimit"]))

steps = {}
steps["first"], _ = ask(first)
steps["instructed"], instructed_response = ask(instructed)
steps["forgetful"], _ = ask(forgetful)
followup = Request(
    model=MODEL,
    system=TOUR["system"],
    messages=[*instructed.messages, instructed_response.message, Message.user(TOUR["followUp"])],
)
steps["followup"], _ = ask(followup)
steps["streamed"] = streamed(instructed)
try:
    steps["limited"], _ = ask(limited)
except Exception as error:  # a provider may refuse a limit this small; record what it said
    steps["limited"] = {"request": request_to_dict(limited), "error": f"{type(error).__name__}: {error}"}

OUT.write_text(json.dumps({
    "model": MODEL,
    "date": datetime.date.today().isoformat(),
    "steps": steps,
}, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}")
for name, step in steps.items():
    print(f"\n== {name}: {step.get('finish_reason')} {step.get('input_tokens')}/{step.get('output_tokens')}")
    print(step.get("text") or step.get("error"))
