"""Record what "Set up authentication" shows.

Every example on the page is a file in src/data/authentication/; this script
runs those files as they are and records what each printed or raised. Writes
src/data/authentication-captures.json.

    cd ../lm15-python && set -a && . ../.env && set +a && \
        uv run python ../website/scripts/capture-authentication.py

It runs in a throwaway home folder, so your own saved connections are never
read or changed. That home borrows your Codex CLI login (~/.codex, linked, not
copied: LM15 must never hold a second copy of a rotating token) and uses your
real lock folder, so a renewal here and one elsewhere cannot collide. Printed
paths show that home as "~", which is what a reader's own paths look like.

Three examples need a person at a terminal. They run in a pseudo-terminal:
`connect()` twice (the answers typed are the ones a person would type), and
the xAI sign-in, stopped as soon as it shows its code (the code is hidden in
the recording; it expires within minutes anyway).

Makes real requests: a few to Anthropic (the key in ../.env), two through
the Codex subscription. Re-recording changes the answers; re-read the page.
"""
import contextlib
import datetime
import io
import json
import os
import pathlib
import pty
import re
import select
import signal
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
SNIPPETS = ROOT / "src/data/authentication"
OUT = ROOT / "src/data/authentication-captures.json"
REAL_HOME = pathlib.Path.home()

# ── a throwaway home ─────────────────────────────────────────────────────
WORK = pathlib.Path(tempfile.mkdtemp(prefix="lm15-auth-docs-"))
HOME = WORK / "home"
HOME.mkdir()
(HOME / ".codex").symlink_to(REAL_HOME / ".codex")
(WORK / "secrets").mkdir()
(WORK / "secrets/anthropic.key").write_text(os.environ["ANTHROPIC_API_KEY"] + "\n")
for name in ("LM15_CREDENTIALS_PATH", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"):
    os.environ.pop(name, None)
os.environ["LM15_LOCK_DIR"] = os.environ.get("LM15_LOCK_DIR") or str(REAL_HOME / ".cache/lm15/locks")
os.environ["HOME"] = str(HOME)
os.environ["STATION_API_KEY"] = os.environ["ANTHROPIC_API_KEY"]
os.chdir(WORK)
# The examples sign out and save connections: they must only ever reach the throwaway store.
from lm15.login.store import default_store_path  # noqa: E402  (after the environment is set)
assert default_store_path().is_relative_to(WORK), f"refusing to run: the store would be {default_store_path()}"


def tidy(text: str) -> str:
    """Home paths as "~", terminal line ends as plain ones."""
    text = text.replace("\r\n", "\n").replace(str(HOME), "~")
    # A real path in a recording would mean an example reached outside the throwaway home.
    assert str(REAL_HOME) not in text, text
    return text.replace(str(WORK) + "/", "")


def code(name: str) -> str:
    return (SNIPPETS / f"{name}.py").read_text()


# ── examples that run in one Python session, like a notebook ────────────
session: dict = {}


def run(name: str, model: str | None = None) -> dict:
    out = io.StringIO()
    step: dict = {"code": code(name)}
    with contextlib.redirect_stdout(out):
        try:
            exec(compile(step["code"], f"{name}.py", "exec"), session)
        except Exception as error:  # the page shows what LM15 raised
            step["error"] = tidy(f"{type(error).__name__}: {error}")
    step["output"] = tidy(out.getvalue())
    if model:
        step["model"] = model
    return step


# ── examples that need a terminal ────────────────────────────────────────
def terminal(name: str, answer, stop=None, timeout: float = 180) -> dict:
    """Run the file in a pseudo-terminal. At each prompt, `answer(screen)`
    gives what the person types; `stop(screen)` ends the run early."""
    pid, fd = pty.fork()
    if pid == 0:
        os.execv(sys.executable, [sys.executable, str(SNIPPETS / f"{name}.py")])
    screen, answered, deadline = "", 0, time.monotonic() + timeout
    status = None
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.5)
        if ready:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                chunk = b""
            if not chunk:
                break
            screen += chunk.decode("utf-8", "replace")
        if stop and stop(screen):
            time.sleep(0.5)
            os.kill(pid, signal.SIGINT)
            time.sleep(1)
            with contextlib.suppress(ProcessLookupError):
                os.kill(pid, signal.SIGKILL)
            break
        if screen.count("Choose a number: ") > answered and screen.endswith("Choose a number: "):
            os.write(fd, (answer(screen) + "\n").encode())
            answered += 1
    else:
        os.kill(pid, signal.SIGKILL)
        raise SystemExit(f"{name}: no end after {timeout}s:\n{screen}")
    _, status = os.waitpid(pid, 0)
    return {"code": code(name), "output": tidy(screen), "exit": os.waitstatus_to_exitcode(status)}


def no_terminal(name: str) -> dict:
    """Run the file with no person present, as a server would."""
    done = subprocess.run([sys.executable, str(SNIPPETS / f"{name}.py")], stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, timeout=120)
    last = done.stderr.strip().splitlines()[-1]
    return {"code": code(name), "output": tidy(done.stdout),
            "error": tidy(re.sub(r"^[\w.]+\.(\w+Error): ", r"\1: ", last))}


def choose_codex_model(screen: str) -> str:
    assert "gpt-5.6-sol" in screen, screen
    return "gpt-5.6-sol"


def xai_code_shown(screen: str) -> bool:
    return "enter this code:" in screen and "(the code is valid" in screen


def hide_code(step: dict) -> dict:
    """The device code, and any link that carries it, as dots."""
    found = re.search(r"enter this code:\s+(\S+)", step["output"])
    assert found, step["output"]
    shown = step["output"].replace(found.group(1), "••••-••••")
    # Up to the line that says how long the code lasts; the run was stopped there.
    head, tail = shown.split("(the code is valid", 1)
    step["output"] = head + "(the code is valid" + tail.split("\n")[0] + "\n"
    return step


steps = {
    "request": run("request"),
    "doctor": run("doctor"),
    "explicit": run("explicit"),
    "rotating": run("rotating", model="anthropic:claude-haiku-4-5"),
    "subscription": run("subscription", model="openai-codex:gpt-5.6-sol"),
    "connect": terminal("connect", choose_codex_model),
    "connect_again": terminal("connect", choose_codex_model),
    "no_person": no_terminal("connect"),
    "managed": run("managed"),
    "configure": run("configure", model="anthropic:claude-haiku-4-5"),
    "status": run("status"),
    "methods": run("methods"),
    "login": hide_code(terminal("login", lambda screen: "", stop=xai_code_shown, timeout=60)),
    "logout": run("logout"),
}
OUT.write_text(json.dumps({"date": datetime.date.today().isoformat(), "steps": steps}, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT} (work folder {WORK})")
for key, s in steps.items():
    print(f"\n== {key}\n{s['output']}{s.get('error', '')}")
