"""Record what "Use Google Cloud" shows.

Every example on the page is a file in src/data/google-cloud/, one per
language (.py, .ts, .rs, .go); this script runs each file as it is, in its own
language, against a real Google Cloud project, and records what it printed or
raised. Writes src/data/google-cloud-captures.json.

    VERTEX_API_KEY=... GOOGLE_API_KEY=... \\
        python3 scripts/capture-google-cloud.py

Needs: a gcloud login on this machine (`gcloud auth application-default
login`) whose active configuration names the project (`gcloud config set
project ...`); a Vertex API key for that project in both variables above (the
key never reaches a recording); the SDK checkouts beside this repository
(../lm15-python with its .venv, ../lm15-ts built, ../lm15-go, ../lm15-rs),
Node 22, Go and `rcargo`. The page documents the SDKs' source, ahead of their
next release, so the checkouts are what runs.

Environments, per step:
- ask, doctor, platform: this machine as it is (its gcloud login and project),
  with no GOOGLE_* variable. On a laptop, `platform` fails by design.
- key, express: a throwaway home with no gcloud at all; `key` gets the
  project from GOOGLE_CLOUD_PROJECT.
- expired: the same request, its error caught and printed, in a throwaway
  home whose saved gcloud login has been revoked (its refresh token
  replaced), the project from gcloud's configuration.

Printed home paths show as "~". Makes real requests to Gemini 2.5 Flash on
Vertex AI (a few cents). Re-recording changes the answers; re-read the page.
"""
import datetime
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SDKS = ROOT.parent
SNIPPETS = ROOT / "src/data/google-cloud"
OUT = ROOT / "src/data/google-cloud-captures.json"
REAL_HOME = pathlib.Path.home()
PROJECT_CONFIG = REAL_HOME / ".config/gcloud"
MODEL = "vertex:gemini-2.5-flash"
LANGUAGES = {"python": "py", "typescript": "ts", "rust": "rs", "go": "go"}
SECRETS = [v for v in (os.environ.get("VERTEX_API_KEY"), os.environ.get("GOOGLE_API_KEY")) if v]
if not SECRETS:
    sys.exit("set VERTEX_API_KEY and GOOGLE_API_KEY (a Vertex API key)")

WORK = pathlib.Path(tempfile.mkdtemp(prefix="lm15-gcp-docs-"))


def clean_env(home: pathlib.Path, **extra: str) -> dict:
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("GOOGLE_", "GCLOUD_", "CLOUDSDK_", "VERTEX_"))}
    env.update(HOME=str(home), **extra)
    return env


# ── one throwaway home with no gcloud, one with a revoked login ──────────
BARE = WORK / "bare-home"
BARE.mkdir()
REVOKED = WORK / "revoked-home"
(REVOKED / ".config/gcloud/configurations").mkdir(parents=True)
adc = json.loads((PROJECT_CONFIG / "application_default_credentials.json").read_text())
adc["refresh_token"] = "1//0revoked-for-the-docs"
(REVOKED / ".config/gcloud/application_default_credentials.json").write_text(json.dumps(adc))
(REVOKED / ".config/gcloud/active_config").write_text("default")
shutil.copy(PROJECT_CONFIG / "configurations/config_default", REVOKED / ".config/gcloud/configurations/config_default")
PROJECT = re.search(r"^project\s*=\s*(\S+)", (PROJECT_CONFIG / "configurations/config_default").read_text(), re.M).group(1)

# ── how each language runs a file ────────────────────────────────────────
TS_DIR = WORK / "ts"
(TS_DIR / "node_modules/@lm15").mkdir(parents=True)
(TS_DIR / "node_modules/@lm15/lm15").symlink_to(SDKS / "lm15-ts")
(TS_DIR / "package.json").write_text('{"type": "module"}\n')
GO_DIR = WORK / "go"
GO_DIR.mkdir()
(GO_DIR / "go.mod").write_text(
    "module docs\n\ngo 1.26.2\n\nrequire github.com/lm15-dev/lm15-go v0.0.0\n\n"
    f"replace github.com/lm15-dev/lm15-go => {SDKS / 'lm15-go'}\n")
RS_DIR = WORK / "rs"
(RS_DIR / "src").mkdir(parents=True)
(RS_DIR / "Cargo.toml").write_text(
    '[package]\nname = "docs"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\n'
    f'lm15 = {{ path = "{SDKS / "lm15-rs"}" }}\n'
    'tokio = { version = "1", features = ["macros", "rt-multi-thread"] }\n\n[workspace]\n')


def command(language: str, source: pathlib.Path) -> tuple[list[str], pathlib.Path]:
    if language == "python":
        return [str(SDKS / "lm15-python/.venv/bin/python"), str(source)], WORK
    if language == "typescript":
        shutil.copy(source, TS_DIR / "main.ts")
        return ["node", "--experimental-strip-types", "--no-warnings", "main.ts"], TS_DIR
    if language == "go":
        shutil.copy(source, GO_DIR / "main.go")
        subprocess.run(["go", "build", "-o", "main", "."], cwd=GO_DIR, check=True,
                       env={**os.environ, "GOFLAGS": "-mod=mod"}, capture_output=True)
        return ["./main"], GO_DIR
    shutil.copy(source, RS_DIR / "src/main.rs")
    subprocess.run(["rcargo", "build", "--release", "-q"], cwd=RS_DIR, check=True, capture_output=True)
    return [str(RS_DIR / "target/release/docs")], RS_DIR


def raised(language: str, stderr: str) -> str | None:
    """What LM15 raised, as the language shows it, without the stack trace."""
    text = stderr.replace("\r\n", "\n")
    if language == "python":
        found = list(re.finditer(r"^(?:[\w.]+\.)?(\w+Error): ", text, re.M))
        return text[found[-1].start():].rstrip().replace(found[-1].group(0), f"{found[-1].group(1)}: ", 1) if found else None
    if language == "typescript":
        found = re.search(r"^\w+Error: [\s\S]*?(?=^    at |\Z)", text, re.M)
        return found.group(0).rstrip() if found else None
    if language == "go":
        found = re.search(r"^panic: [\s\S]*?(?=^goroutine |\Z)", text, re.M)
        return found.group(0).rstrip() if found else None
    found = re.search(r"^Error: [\s\S]*", text, re.M)
    return found.group(0).rstrip() if found else None


def tidy(text: str, home: pathlib.Path) -> str:
    text = text.replace(str(home), "~").replace(str(WORK) + "/", "")
    assert str(REAL_HOME) not in text, text
    for secret in SECRETS:
        assert secret not in text, "a key reached a recording"
    return text


def run(step: str, name: str, home: pathlib.Path, **env: str) -> dict:
    out: dict = {}
    for language, ext in LANGUAGES.items():
        source = SNIPPETS / f"{name}.{ext}"
        argv, cwd = command(language, source)
        done = subprocess.run(argv, cwd=cwd, env=clean_env(home, **env), capture_output=True, text=True, timeout=300)
        record = {"code": source.read_text(), "output": tidy(done.stdout, home)}
        error = raised(language, done.stderr)
        if done.returncode != 0:
            assert error, f"{step}/{language}: failed without an error LM15 raised:\n{done.stderr}"
            record["error"] = tidy(error, home)
        if done.returncode == 0 and record["output"].strip() and name not in ("doctor", "expired"):
            record["model"] = MODEL.replace("vertex:", "vertex-express:") if name == "express" else MODEL
        out[language] = record
        print(f"== {step} / {language}\n{record['output']}{record.get('error', '')}\n", flush=True)
    return out


steps = {
    "ask": run("ask", "ask", REAL_HOME),
    "doctor": run("doctor", "doctor", REAL_HOME),
    "platform": run("platform", "platform", REAL_HOME),
    "key": run("key", "key", BARE, GOOGLE_CLOUD_PROJECT=PROJECT, VERTEX_API_KEY=os.environ["VERTEX_API_KEY"]),
    "express": run("express", "express", BARE, GOOGLE_API_KEY=os.environ["GOOGLE_API_KEY"]),
    "expired": run("expired", "expired", REVOKED),
}
OUT.write_text(json.dumps({"date": datetime.date.today().isoformat(), "project": PROJECT, "steps": steps},
                          indent=2, ensure_ascii=False) + "\n")
shutil.rmtree(WORK)
print(f"wrote {OUT}")
