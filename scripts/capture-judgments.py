"""Record what "Ask for judgments with probabilities" shows.

Every example on the page is a file in src/data/judgments/. The page presents
them as steps of one session, each building on the ones before, so this
script runs them in that order in one shared namespace and records what each
printed or raised. Writes src/data/judgments-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-judgments.py

Makes real requests: four to TypeSafe's Jev (TYPESAFE_API_KEY) and one to
Anthropic's small model (ANTHROPIC_API_KEY). The `required` step raises
before anything is sent. Re-recording changes the numbers; re-read the page.
"""
import contextlib
import datetime
import io
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SNIPPETS = ROOT / "src/data/judgments"
OUT = ROOT / "src/data/judgments-captures.json"
ORDER = ["answers", "ask", "expected", "chat", "required", "table"]
MODELS = {"ask": "typesafe:jev-latest", "expected": "typesafe:jev-latest",
          "chat": "anthropic:claude-haiku-4-5", "required": "anthropic:claude-haiku-4-5",
          "table": "typesafe:jev-latest"}


def tidy(text: str) -> str:
    return re.sub(r"[ \t]+\n", "\n", text).strip("\n") + "\n" if text.strip() else ""


session: dict = {"__name__": "__main__"}
steps: dict = {}
for name in ORDER:
    step: dict = {"code": (SNIPPETS / f"{name}.py").read_text()}
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            exec(compile(step["code"], f"{name}.py", "exec"), session)
        except Exception as error:  # the page shows what LM15 raised
            step["error"] = tidy(f"{type(error).__name__}: {error}")
    step["output"] = tidy(out.getvalue())
    if name in MODELS:
        step["model"] = MODELS[name]
    steps[name] = step
    if "error" in step and name != "required":
        raise SystemExit(f"{name} raised:\n{step['error']}")

import lm15  # noqa: E402

OUT.write_text(json.dumps({"date": datetime.date.today().isoformat(), "lm15": lm15.__version__,
                           "steps": steps}, indent=2, ensure_ascii=False) + "\n")
for key, s in steps.items():
    print(f"\n== {key}\n{s['output']}{s.get('error', '')}")
