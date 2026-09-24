"""Record what "Keep a conversation" shows.

Runs the page's own Python programs (tourPrograms in src/data/tour-examples.ts,
the text the page shows) with the recording model, in a throwaway folder, and
records what each printed. Then reads the conversation file the program saved,
to record what the model's messages held. Writes
src/data/conversations-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-conversations.py

One extra, not shown as code on the page ("Try it yourself"): the second
question sent twice, once after the model's whole message and once after a
message holding only its text, to compare what each cost.

Makes about ten requests through the Codex subscription. Re-recording changes
the answers; re-read the page afterwards.
"""
import datetime
import json
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src/data/conversations-captures.json"
PROVIDER, MODEL = "openai-codex", "gpt-5.6-sol"

sources = json.loads(subprocess.run(
    ["node", "--experimental-strip-types", "--no-warnings", "-e",
     "import { tourPrograms } from './src/data/tour-examples.ts';"
     f"console.log(JSON.stringify(Object.fromEntries(tourPrograms('python', '{PROVIDER}', '{MODEL}').map(p => [p.name, p.source]))));"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout)

work = pathlib.Path(tempfile.mkdtemp(prefix="lm15-conversations-"))


def run(name: str) -> str:
    (work / f"{name}.py").write_text(sources[name] + "\n")
    done = subprocess.run([sys.executable, f"{name}.py"], cwd=work, capture_output=True, text=True, timeout=600)
    if done.returncode:
        raise SystemExit(f"{name} failed:\n{done.stderr}")
    return done.stdout


model = f"{PROVIDER}:{MODEL}"
start = run("conv-start")
loop_and_next = run("conv-save")

# The loop printed three turns, each ending "N tokens in"; the next day's answer follows.
ends = [m.end() for m in re.finditer(r"^\d+ tokens in\n", loop_and_next, re.M)]
assert len(ends) == 3, loop_and_next
loop, next_day = loop_and_next[:ends[-1]], loop_and_next[ends[-1]:]
tokens_in = [int(n) for n in re.findall(r"^(\d+) tokens in$", loop, re.M)]

# What the saved file holds: each of the model's messages, part by part.
saved = json.loads((work / "conversation.json").read_text())
assistant_parts = [
    [{"type": p["type"], "characters": len(p.get("text") or ""), "sealed": bool(p.get("continuation"))}
     for p in m["parts"]]
    for m in saved["messages"] if m["role"] == "assistant"
]

# Try it yourself: the whole message, or only its text, before the second question.
from lm15 import LMRouter, Message, Request  # noqa: E402

TOUR = json.loads((ROOT / "src/data/tour-text.json").read_text())
router = LMRouter()
first = Request(model=model, system=TOUR["system"], messages=[Message.user(TOUR["prompt"])])
reply = router.complete(first)
compare = {}
for kept, message in (("whole", reply.message), ("text_only", Message.assistant(reply.text))):
    r = router.complete(Request(model=model, system=TOUR["system"],
                                messages=[*first.messages, message, Message.user(TOUR["followUp"])]))
    compare[kept] = {"text": r.text, "input_tokens": r.usage.input_tokens}

# The first program printed the answer, then one line per part of the model's message.
KINDS = {"text", "thinking", "tool_call", "citation", "refusal", "image", "audio"}
lines = start.rstrip("\n").split("\n")
cut = len(lines)
while cut and lines[cut - 1] in KINDS:
    cut -= 1
assert 0 < cut < len(lines), start
steps = {
    "start": {"model": model, "output": "\n".join(lines[:cut]) + "\n"},
    "parts": {"model": model, "output": "\n".join(lines[cut:]) + "\n"},
    "loop": {"model": model, "output": loop, "input_tokens": tokens_in},
    "next_day": {"model": model, "output": next_day},
}
facts = {"assistant_parts": assistant_parts, "whole_or_text": compare, "first_parts": [
    {"type": type(p).__name__, "characters": len(getattr(p, "text", "") or ""), "sealed": bool(p.continuation)}
    for p in reply.message.parts]}
OUT.write_text(json.dumps({"date": datetime.date.today().isoformat(), "model": model, "steps": steps, "facts": facts},
                          indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}\n")
for key, s in steps.items():
    print(f"== {key}\n{s['output']}")
print(json.dumps(facts, indent=1))
