"""Record what "Handle errors and retries" shows.

Runs the page's own Python programs (errorPrograms in src/data/tour-examples.ts,
the text the page shows) against real providers, and records what they printed.
Writes src/data/errors-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-errors.py

- catch: the request for a model the provider does not have, through the Codex
  subscription, and the error caught.
- unknown: a model name the router cannot place (no provider prefix, no rule);
  nothing is sent.
- providers: the same missing model sent to several providers; the class and
  status LM15 reported for each (contract MAP-15).
- retry, gave_up: the retry program, run against OpenRouter's free model while
  a burst of requests from other threads holds it at its per-minute limit:
  once with the burst stopping a second in (it waits and answers), once with
  the burst lasting the whole run (it gives up after four attempts); and one
  of the burst's own rate-limit errors.

Needs the keys in ../.env and a Codex sign-in. OpenRouter's free models cost
nothing; the other requests are refused before any generation.
"""
import datetime
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src/data/errors-captures.json"
TOUR = json.loads((ROOT / "src/data/tour-text.json").read_text())
FREE = ("openrouter", "liquid/lfm-2.5-2.6b:free")


def programs(provider: str, model: str) -> dict:
    return json.loads(subprocess.run(
        ["node", "--experimental-strip-types", "--no-warnings", "-e",
         "import { errorPrograms } from './src/data/tour-examples.ts';"
         f"console.log(JSON.stringify(errorPrograms('python', '{provider}', '{model}')));"],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout)


work = pathlib.Path(tempfile.mkdtemp(prefix="lm15-errors-"))


def run(name: str, source: str) -> dict:
    (work / f"{name}.py").write_text(source + "\n")
    done = subprocess.run([sys.executable, f"{name}.py"], cwd=work, capture_output=True, text=True, timeout=600)
    step = {"code": source, "output": done.stdout}
    if done.returncode:
        step["error"] = done.stderr.strip().splitlines()[-1]
    return step


from lm15 import LMRouter, Message, Request  # noqa: E402
from lm15.errors import LM15Error, RateLimitError  # noqa: E402

router = LMRouter()
steps: dict = {}

# The catch example, as the page shows it, with the recording model's provider.
steps["catch"] = {"model": "openai-codex:no-such-model", **run("catch", programs("openai-codex", "gpt-5.6-sol")["catch"])}

# A model name the router cannot place: nothing is sent.
try:
    router.complete(Request(model="haiku-4-5", messages=[Message.user(TOUR["prompt"])]))
    raise SystemExit("haiku-4-5 was routed; pick another unplaceable name")
except LM15Error as error:
    steps["unknown"] = {"model": "haiku-4-5", "error": f"{type(error).__name__}: {error}"}

# The same missing model at several providers.
providers = {}
for provider in ("anthropic", "openai", "gemini", "deepseek", "zai", "openrouter", "groq", "openai-codex"):
    try:
        router.complete(Request(model=f"{provider}:no-such-model", messages=[Message.user(TOUR["prompt"])]))
        providers[provider] = {"class": None}
    except LM15Error as error:
        providers[provider] = {"class": type(error).__name__, "status": getattr(error, "status", None),
                               "provider_code": getattr(error, "provider_code", None)}

# The retry program, started while a burst from other threads has the free
# model at its limit. Two runs, on purpose: one where the burst goes on for the
# whole run (the program gives up), and one where it stops a second after the
# program starts (the program waits it out). The second is tried again until
# it shows a wait and then an answer.
burst_errors: list[BaseException] = []


def hammer(stop: threading.Event) -> None:
    request = Request(model=":".join(FREE), messages=[Message.user("Say ok.")])
    while not stop.is_set():
        try:
            router.complete(request)
        except LM15Error as error:
            burst_errors.append(error)


def retry_run(burst_for: float | None) -> dict:
    """`burst_for`: seconds the burst goes on after the program starts; None: until it ends."""
    stop = threading.Event()
    threads = [threading.Thread(target=hammer, args=(stop,), daemon=True) for _ in range(30)]
    for t in threads:
        t.start()
    seen = len(burst_errors)
    deadline = time.monotonic() + 120
    while not any(isinstance(e, RateLimitError) for e in burst_errors[seen:]) and time.monotonic() < deadline:
        time.sleep(0.2)
    source = programs(*FREE)["retry"]
    (work / "retry.py").write_text(source + "\n")
    program = subprocess.Popen([sys.executable, "retry.py"], cwd=work, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if burst_for is not None:
        time.sleep(burst_for)
        stop.set()
    out, err = program.communicate(timeout=600)
    stop.set()
    for t in threads:
        t.join(timeout=60)
    step = {"model": ":".join(FREE), "code": source, "output": out}
    if program.returncode:
        # The raised error's own line ("lm15.errors.RateLimitError: ..."), without the module path.
        raised = [line for line in err.splitlines() if re.match(r"^[\w.]+Error: ", line)]
        step["error"] = re.sub(r"^[\w.]+\.(\w+Error): ", r"\1: ", raised[-1]) if raised else err.strip().splitlines()[-1]
    return step


gave_up = retry_run(None)
assert "error" in gave_up and gave_up["output"].count("waiting") == 3, f"the program did not give up:\n{gave_up}"
for _ in range(5):
    time.sleep(65)  # a fresh per-minute window
    retry = retry_run(1.0)
    if "RateLimitError, waiting" in retry["output"] and "error" not in retry:
        break
else:
    raise SystemExit(f"no run both waited and answered; last:\n{retry}")
limited = [e for e in burst_errors if isinstance(e, RateLimitError)]
steps["retry"] = retry
steps["gave_up"] = gave_up
steps["rate_limit"] = {"model": ":".join(FREE), "error": f"{type(limited[0]).__name__}: {limited[0]}",
                       "retry_after": limited[0].retry_after, "status": limited[0].status}

OUT.write_text(json.dumps({"date": datetime.date.today().isoformat(), "steps": steps, "providers": providers},
                          indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT}")
print(json.dumps({k: {x: y for x, y in v.items() if x != "code"} for k, v in steps.items()}, indent=1, ensure_ascii=False))
print(json.dumps(providers, indent=1))
