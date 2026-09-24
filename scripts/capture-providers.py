"""Record the real answers "Connect a provider" shows.

The page's loop (the same question to each of TOUR.connect.models), a model on
this machine (Ollama must be serving TOUR.connect.localModel), and the errors a
reader meets first: no key, and a model name the provider doesn't have. Writes
src/data/providers-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-providers.py

Re-recording changes the answers; re-read the page afterwards.
"""
import datetime
import json
import pathlib

from lm15 import LMRouter, Message, Request, RouterConfig
from lm15.serde import request_to_dict

ROOT = pathlib.Path(__file__).parent.parent
TOUR = json.loads((ROOT / "src/data/tour-text.json").read_text())
C = TOUR["connect"]
OUT = ROOT / "src/data/providers-captures.json"


def request(model: str, system: bool = True) -> Request:
    return Request(model=model, system=TOUR["system"] if system else None, messages=[Message.user(TOUR["prompt"])])


def run(router: LMRouter, req: Request) -> dict:
    out = {"request": request_to_dict(req)}
    try:
        r = router.complete(req)
    except Exception as error:
        return {**out, "error": f"{type(error).__name__}: {error}"}
    return {**out, "model": r.model, "text": r.text, "finish_reason": r.finish_reason,
            "input_tokens": r.usage.input_tokens, "output_tokens": r.usage.output_tokens}


router = LMRouter()
steps = {
    **{model: run(router, request(model)) for model in C["models"]},
    "local": run(router, request(C["localModel"], system=False)),
    # No key anywhere: an empty environment, and no key given.
    "no_key": run(LMRouter(RouterConfig(env={})), request("anthropic:claude-haiku-4-5")),
    "wrong_model": run(router, request("anthropic:claude-haiku-9")),
    "wrong_provider": run(router, request("openai:claude-haiku-4-5")),
}
OUT.write_text(json.dumps({"date": datetime.date.today().isoformat(), "steps": steps}, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}")
for key, s in steps.items():
    print(f"== {key}: {s.get('input_tokens')}/{s.get('output_tokens')}\n{s.get('text') or s.get('error')}")
