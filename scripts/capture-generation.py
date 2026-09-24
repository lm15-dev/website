"""Record what "Control generation" shows.

Runs the page's own Python programs (generationPrograms in
src/data/tour-examples.ts, the text the page shows) against Anthropic's small
model, and records what each printed. Writes src/data/generation-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-generation.py

The page's recordings use Anthropic, not the Codex model the other guides
use: the Codex backend has no length limit and refuses one, and this page is
about settings a provider takes. One extra, not shown as code: the same
request the adaptations example sends, to record each adaptation's asked and
applied values for the prose.

About eight small requests. Re-recording changes the answers; re-read the page.
"""
import datetime
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src/data/generation-captures.json"
PROVIDER, MODEL = "anthropic", "claude-haiku-4-5"
TOUR = json.loads((ROOT / "src/data/tour-text.json").read_text())
G = TOUR["generation"]

sources = json.loads(subprocess.run(
    ["node", "--experimental-strip-types", "--no-warnings", "-e",
     "import { generationPrograms } from './src/data/tour-examples.ts';"
     f"console.log(JSON.stringify(generationPrograms('python', '{PROVIDER}', '{MODEL}')));"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout)
work = pathlib.Path(tempfile.mkdtemp(prefix="lm15-generation-"))


def run(name: str) -> dict:
    (work / f"{name}.py").write_text(sources[name] + "\n")
    done = subprocess.run([sys.executable, f"{name}.py"], cwd=work, capture_output=True, text=True, timeout=600)
    if done.returncode:
        raise SystemExit(f"{name} failed:\n{done.stderr}")
    return {"model": f"{PROVIDER}:{MODEL}", "code": sources[name], "output": done.stdout}


steps = {name: run(name) for name in ("short", "temperature", "stop", "adapt")}

# The adaptations example printed field and action; the prose also quotes asked and applied.
from lm15 import Config, LMRouter, Message, Request  # noqa: E402

request = Request(model=f"{PROVIDER}:{MODEL}", system=TOUR["system"], messages=[Message.user(TOUR["prompt"])],
                  config=Config(temperature=G["hot"], seed=G["seed"]))
records = [{"field": a.field, "action": a.action, "asked": a.asked, "applied": a.applied, "reason": a.reason}
           for a in LMRouter().plan(request)]

# The adaptations program printed the answer and its records, then the preview
# (one line per record), then the refusal: shown under three code blocks.
lines = steps["adapt"]["output"].rstrip("\n").split("\n")
n = len(records)
assert lines[-1].startswith("Refused: "), lines
steps["refuse"] = {**steps["adapt"], "output": lines[-1] + "\n"}
steps["plan"] = {**steps["adapt"], "output": "\n".join(lines[-1 - n:-1]) + "\n"}
steps["adapt"] = {**steps["adapt"], "output": "\n".join(lines[:-1 - n]) + "\n"}
OUT.write_text(json.dumps({"date": datetime.date.today().isoformat(), "steps": steps, "records": records},
                          indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}")
for key, s in steps.items():
    print(f"== {key}\n{s['output']}")
print(json.dumps(records, indent=1))
