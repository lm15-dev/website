"""Record the real answers "Connect a provider" shows.

The page's loop (the same question to each of TOUR.connect.models), a model on
this machine (Ollama must be serving TOUR.connect.localModel), and the errors a
reader meets first: no key, and a model name the provider doesn't have. Writes
src/data/providers-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-providers.py

Re-recording changes the answers; re-read the page afterwards. `--only
wrong_model,wrong_provider` records only those steps again.
"""
import datetime
import json
import sys
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
# `--only a,b`: record those steps again, keep the others as they are (the
# errors changed on 2026-09-24, contract MAP-15; the answers did not need to).
only = next((arg.split(",") for arg in sys.argv[sys.argv.index("--only") + 1:][:1]), None) if "--only" in sys.argv else None
STEPS = {
    **{model: lambda model=model: run(router, request(model)) for model in C["models"]},
    "local": lambda: run(router, request(C["localModel"], system=False)),
    # No key anywhere: an empty environment, and no key given.
    "no_key": lambda: run(LMRouter(RouterConfig(env={})), request("anthropic:claude-haiku-4-5")),
    "wrong_model": lambda: run(router, request("anthropic:claude-haiku-9")),
    "wrong_provider": lambda: run(router, request("openai:claude-haiku-4-5")),
}
previous = json.loads(OUT.read_text()) if only else None
today = datetime.date.today().isoformat()
# A step recorded again on its own carries its own date; the answer box shows it.
steps = {name: ({**make(), "date": today} if only and name in only else make() if only is None else previous["steps"][name])
         for name, make in STEPS.items()}
OUT.write_text(json.dumps({"date": previous["date"] if only else today, "steps": steps}, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}")
for key, s in steps.items():
    print(f"== {key}: {s.get('input_tokens')}/{s.get('output_tokens')}\n{s.get('text') or s.get('error')}")
