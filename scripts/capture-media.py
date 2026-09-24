"""Record what "Send images and documents" shows.

Runs the page's own Python programs (mediaPrograms in src/data/tour-examples.ts,
the text the page shows) with the recording model, next to the page's two files
(public/docs-media: a camera-trap photo, CC BY-SA 2.0, and the station's own
PDF log), and records what each printed. Then sends the same two questions to
several providers, to show how models differ on the same file, and which wires
refuse a PDF before anything is sent. Writes src/data/media-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \\
        uv run python ../website/scripts/capture-media.py

About sixteen small requests. Re-recording changes the answers; re-read the page.
`--only log` records that step again and keeps the rest.
"""
import datetime
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src/data/media-captures.json"
TOUR = json.loads((ROOT / "src/data/tour-text.json").read_text())
M = TOUR["media"]
PROVIDER, MODEL = "openai-codex", "gpt-5.6-sol"
OTHERS = ["openai:gpt-5-mini", "anthropic:claude-haiku-4-5", "gemini:gemini-2.5-flash",
          "deepseek:deepseek-chat", "openrouter:openai/gpt-4o-mini"]

sources = json.loads(subprocess.run(
    ["node", "--experimental-strip-types", "--no-warnings", "-e",
     "import { mediaPrograms } from './src/data/tour-examples.ts';"
     f"console.log(JSON.stringify(mediaPrograms('python', '{PROVIDER}', '{MODEL}')));"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout)
work = pathlib.Path(tempfile.mkdtemp(prefix="lm15-media-"))
for which in ("photo", "log"):
    shutil.copy(ROOT / "public/docs-media" / M[which]["file"], work / M[which]["file"])


def run(which: str) -> dict:
    (work / f"{which}.py").write_text(sources[which] + "\n")
    done = subprocess.run([sys.executable, f"{which}.py"], cwd=work, capture_output=True, text=True, timeout=600)
    if done.returncode:
        raise SystemExit(f"{which} failed:\n{done.stderr}")
    return {"model": f"{PROVIDER}:{MODEL}", "code": sources[which], "output": done.stdout}


# `--only log`: record that step again (with its own date); keep the rest as recorded.
only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
previous = json.loads(OUT.read_text()) if only else None
today = datetime.date.today().isoformat()
steps = {which: ({**run(which), "date": today} if only and which in only else run(which) if only is None else previous["steps"][which])
         for which in ("photo", "log")}

# The same two questions elsewhere: what each model said, or what LM15 refused.
if only:
    OUT.write_text(json.dumps({**previous, "steps": steps}, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT} (only {', '.join(only)})")
    for key in only:
        print(f"== {key}\n{steps[key]['output']}")
    raise SystemExit(0)

from lm15 import LMRouter, Message, Request  # noqa: E402
from lm15.errors import LM15Error  # noqa: E402
from lm15.types import document, image  # noqa: E402

router = LMRouter()
parts = {"photo": image(path=str(work / M["photo"]["file"]), media_type=M["photo"]["mediaType"]),
         "log": document(path=str(work / M["log"]["file"]), media_type=M["log"]["mediaType"])}
providers = {}
for model in OTHERS:
    providers[model] = {}
    for which, part in parts.items():
        request = Request(model=model, system=TOUR["system"], messages=[Message.user([M[which]["question"], part])])
        try:
            r = router.complete(request)
            providers[model][which] = {"text": r.text, "input_tokens": r.usage.input_tokens}
        except LM15Error as error:
            providers[model][which] = {"error": f"{type(error).__name__}: {error}"}

OUT.write_text(json.dumps({"date": datetime.date.today().isoformat(), "steps": steps, "providers": providers},
                          indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}")
for key, s in steps.items():
    print(f"== {key}\n{s['output']}")
for model, rows in providers.items():
    for which, row in rows.items():
        print(f"{model:50} {which:5} {(row.get('text') or row.get('error'))[:170]!r} {row.get('input_tokens')}")
