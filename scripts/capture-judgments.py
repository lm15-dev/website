"""Record what "Ask for judgments with probabilities" shows.

Every example on the page is a file in src/data/judgments/. The page presents
them as steps of one session, each building on the ones before, so this
script runs them in that order in one shared namespace and records what each
printed or raised. Writes src/data/judgments-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-judgments.py

Makes real requests: five to TypeSafe's Jev (TYPESAFE_API_KEY) and one to
Anthropic's small model (ANTHROPIC_API_KEY). The `required` step raises
before anything is sent. Re-recording changes the numbers; re-read the page.

The steps run next to public/docs-media (the `where` step reads the
camera-trap photo). `--only where,pixels` re-records just those steps: the
others still run, so the later ones have what they build on, but keep their
saved recordings. With Pillow installed (`uv run --with pillow ...`), the run
also draws the recorded box on the photo, public/docs-media/badger-box.jpg.
"""
import contextlib
import datetime
import io
import json
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SNIPPETS = ROOT / "src/data/judgments"
OUT = ROOT / "src/data/judgments-captures.json"
MEDIA = ROOT / "public/docs-media"
ORDER = ["answers", "ask", "expected", "chat", "required", "table", "where", "pixels"]
MODELS = {"ask": "typesafe:jev-latest", "expected": "typesafe:jev-latest",
          "chat": "anthropic:claude-haiku-4-5", "required": "anthropic:claude-haiku-4-5",
          "table": "typesafe:jev-latest", "where": "typesafe:jev-preview"}
ONLY = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else set(ORDER)
saved = json.loads(OUT.read_text())["steps"] if OUT.exists() else {}


def tidy(text: str) -> str:
    return re.sub(r"[ \t]+\n", "\n", text).strip("\n") + "\n" if text.strip() else ""


session: dict = {"__name__": "__main__"}
steps: dict = {}
os.chdir(MEDIA)
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
    if "error" in step and name != "required":
        raise SystemExit(f"{name} raised:\n{step['error']}")
    steps[name] = step if name in ONLY or name not in saved else saved[name]

import lm15  # noqa: E402

today = datetime.date.today().isoformat()
if ONLY == set(ORDER):
    header = {"date": today, "lm15": lm15.__version__}
else:  # a partial run keeps the session's date; each new recording carries its own
    header = {k: v for k, v in json.loads(OUT.read_text()).items() if k != "steps"}
    for name in ONLY:
        steps[name] = {**steps[name], "date": today, "lm15": lm15.__version__}
OUT.write_text(json.dumps({**header, "steps": steps}, indent=2, ensure_ascii=False) + "\n")

try:  # the figure next to the `where` step: the recorded box, drawn on the photo
    from PIL import Image, ImageDraw
except ImportError:
    print("\n(Pillow not installed: badger-box.jpg not redrawn)")
else:
    edges = json.loads(steps["where"]["output"].replace("'", '"').replace("True", "true").replace("False", "false"))["badger"]
    photo = Image.open(MEDIA / "badger.jpg").convert("RGB")
    w, h = photo.size
    xy = [round(edges["left"] * w), round(edges["top"] * h), round(edges["right"] * w), round(edges["bottom"] * h)]
    ImageDraw.Draw(photo).rectangle(xy, outline=(255, 214, 0), width=5)
    photo.save(MEDIA / "badger-box.jpg", quality=85)
for key, s in steps.items():
    print(f"\n== {key}\n{s['output']}{s.get('error', '')}")
