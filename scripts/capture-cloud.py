"""Record what the cloud pages show: "Use a cloud provider" (clouds), "Use AWS"
(aws) and "Use Microsoft Azure" (azure). "Use Google Cloud" has its own
script, scripts/capture-google-cloud.py.

Every example is a file in src/data/<page>/, one per language (.py, .ts, .rs,
.go). This script runs each file as it is, in its own language, against a real
cloud account, in a throwaway home that holds only what the step says, and
records what it printed or raised. Writes src/data/<page>-captures.json.

    LM15_CLOUD_CREDS=/path/to/private/dir python3 scripts/capture-cloud.py aws
    LM15_CLOUD_CREDS=... python3 scripts/capture-cloud.py azure
    LM15_CLOUD_CREDS=... python3 scripts/capture-cloud.py clouds
    ... python3 scripts/capture-cloud.py aws --only claude   # re-record one step

LM15_CLOUD_CREDS is a private folder (mode 700) laid out like a home folder:
  .aws/credentials       an AWS profile `default` (access keys) with Bedrock access
  .config/lm15/azure-lab.env
                         the Azure lab (lm15-contract/research/cloud-hosts/azure/
                         provision.sh): AZURE_TENANT_ID, AZURE_CLIENT_ID,
                         AZURE_CLIENT_SECRET, AZURE_OPENAI_RESOURCE,
                         AZURE_OPENAI_API_KEY; the service principal has the
                         data-plane roles on the resource, and the resource a
                         `gpt-4.1-mini` deployment
  .config/lm15/aws-bearer.env
                         AWS_BEARER_TOKEN_BEDROCK, a Bedrock short-term key
                         (lm15-contract/research/providers/_aws_bearer.py)
The `clouds` page also needs this machine's gcloud sign-in (as for
capture-google-cloud.py). Nothing from the folder reaches a recording: every
value is checked for before writing.

Needs the SDK checkouts beside this repository (../lm15-python with its
.venv, ../lm15-ts built, ../lm15-go, ../lm15-rs), Node 22, Go, `rcargo`, `uv`
and `nix` (for the Azure CLI). Real requests, a few cents in all. The run on
an EC2 instance ("platform_ec2") is recorded by scripts/capture-aws-ec2.sh,
which calls this script with --remote.
"""
import argparse
import datetime
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SDKS = ROOT.parent
REAL_HOME = pathlib.Path.home()
LANGUAGES = {"python": "py", "typescript": "ts", "rust": "rs", "go": "go"}
CLOUD_PREFIXES = ("AWS_", "AZURE_", "ANTHROPIC_", "GOOGLE_", "GCLOUD_", "CLOUDSDK_", "VERTEX_", "OPENAI_", "GEMINI_")

parser = argparse.ArgumentParser()
parser.add_argument("page", choices=["aws", "azure", "clouds"])
parser.add_argument("--only", action="append", help="record only these steps; keep the others")
parser.add_argument("--remote", help="ssh destination for the _ec2 steps (scripts/capture-aws-ec2.sh passes it)")
args = parser.parse_args()

CREDS = pathlib.Path(os.environ.get("LM15_CLOUD_CREDS", "")).expanduser()
if not (CREDS / ".aws/credentials").exists():
    sys.exit("set LM15_CLOUD_CREDS to the private folder described at the top of this script")


def read_env(path: pathlib.Path) -> dict:
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            match = re.match(r"\s*(?:export\s+)?([A-Z0-9_]+)=(.*)", line)
            if match:
                values[match.group(1)] = match.group(2).strip().strip("'\"")
    return values


LAB = read_env(CREDS / ".config/lm15/azure-lab.env")
BEARER = read_env(CREDS / ".config/lm15/aws-bearer.env")
AWS_KEYS = re.findall(r"=\s*(\S+)", (CREDS / ".aws/credentials").read_text())
# secrets, and the account identifiers a page has no reason to show (the
# resource name is shown: it is in every Azure address)
PRIVATE = {name: LAB[name] for name in ("AZURE_CLIENT_SECRET", "AZURE_OPENAI_API_KEY", "ANTHROPIC_FOUNDRY_API_KEY",
                                        "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID", "AZURE_CLIENT_ID") if LAB.get(name)}
PRIVATE.update({f"aws credentials value {i}": v for i, v in enumerate(AWS_KEYS) if len(v) >= 16})
PRIVATE.update({name: v for name, v in BEARER.items() if len(v) >= 16})
ENDPOINT = f"https://{LAB.get('AZURE_OPENAI_RESOURCE', 'missing')}.openai.azure.com"

SNIPPETS = ROOT / "src/data" / args.page
OUT = ROOT / "src/data" / f"{args.page}-captures.json"
WORK = pathlib.Path(tempfile.mkdtemp(prefix=f"lm15-{args.page}-docs-"))
os.chmod(WORK, 0o700)


# ── homes ────────────────────────────────────────────────────────────────
def home(name: str, aws: bool = False, azure_cli: bool = False, gcloud: bool = False) -> pathlib.Path:
    """A throwaway home holding only the sign-ins named."""
    path = WORK / "homes" / name
    if path.exists():
        return path
    path.mkdir(parents=True)
    if aws:
        (path / ".aws").mkdir()
        shutil.copy(CREDS / ".aws/credentials", path / ".aws/credentials")
        # what `aws configure set region us-east-1` writes
        (path / ".aws/config").write_text("[default]\nregion = us-east-1\n")
    if azure_cli:
        subprocess.run([AZ, "login", "--service-principal", "--username", LAB["AZURE_CLIENT_ID"],
                        "--password", LAB["AZURE_CLIENT_SECRET"], "--tenant", LAB["AZURE_TENANT_ID"],
                        "--allow-no-subscriptions", "--output", "none"],
                       env={"HOME": str(path), "PATH": os.environ["PATH"]}, check=True, capture_output=True)
    if gcloud:
        config = path / ".config/gcloud"
        (config / "configurations").mkdir(parents=True)
        shutil.copy(REAL_HOME / ".config/gcloud/application_default_credentials.json", config)
        shutil.copy(REAL_HOME / ".config/gcloud/configurations/config_default", config / "configurations")
        (config / "active_config").write_text("default")
    return path


AZ = None
if args.page in ("azure", "clouds"):
    found = subprocess.run(["nix", "shell", "nixpkgs#azure-cli", "-c", "sh", "-c", "command -v az"],
                           capture_output=True, text=True, check=True)
    AZ = found.stdout.strip()
AZ_PATH = f"{pathlib.Path(AZ).parent}:" if AZ else ""


# ── how each language runs a file ────────────────────────────────────────
TS_DIR = WORK / "ts"
TS_DIR.mkdir()
(TS_DIR / "package.json").write_text('{"type": "module", "private": true}\n')
if args.page == "azure":
    subprocess.run(["npm", "install", "--silent", "--no-audit", "--no-fund", "@azure/identity@4"],
                   cwd=TS_DIR, check=True, capture_output=True)
(TS_DIR / "node_modules/@lm15").mkdir(parents=True, exist_ok=True)
(TS_DIR / "node_modules/@lm15/lm15").symlink_to(SDKS / "lm15-ts")
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
PYTHON = str(SDKS / "lm15-python/.venv/bin/python")
if args.page == "azure":
    # azure-identity beside lm15, for the one step that uses it
    subprocess.run(["uv", "venv", "-q", "-p", "3.12", str(WORK / "py")], check=True)
    subprocess.run(["uv", "pip", "install", "-q", "--python", str(WORK / "py/bin/python"),
                    "azure-identity", "-e", str(SDKS / "lm15-python")], check=True)
    PYTHON = str(WORK / "py/bin/python")


def command(language: str, source: pathlib.Path) -> tuple[list[str], pathlib.Path]:
    if language == "python":
        # as main.py: a file named like a standard module (platform.py)
        # would shadow it for everything the program imports
        (WORK / "pyrun").mkdir(exist_ok=True)
        shutil.copy(source, WORK / "pyrun/main.py")
        return [PYTHON, "main.py"], WORK / "pyrun"
    if language == "typescript":
        shutil.copy(source, TS_DIR / "main.ts")
        return ["node", "--experimental-strip-types", "--no-warnings", "main.ts"], TS_DIR
    if language == "go":
        shutil.copy(source, GO_DIR / "main.go")
        built = subprocess.run(["go", "build", "-o", "main", "."], cwd=GO_DIR, capture_output=True, text=True,
                               env={**os.environ, "GOFLAGS": "-mod=mod"})
        assert built.returncode == 0, built.stderr
        return ["./main"], GO_DIR
    shutil.copy(source, RS_DIR / "src/main.rs")
    built = subprocess.run(["rcargo", "build", "--release", "-q"], cwd=RS_DIR, capture_output=True, text=True)
    assert built.returncode == 0, built.stderr
    return [str(RS_DIR / "target/release/docs")], RS_DIR


REMOTE_DIRS = {"python": "run/py", "typescript": "run/ts", "rust": "run/rs", "go": "run/go"}


def remote(language: str, source: pathlib.Path, env: dict) -> subprocess.CompletedProcess:
    """Run one file on the cloud machine prepared by scripts/capture-aws-ec2.sh:
    Python and Node there, Rust built there, Go cross-built here."""
    ssh = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", *REMOTE_SSH, args.remote]
    target = {"python": "main.py", "typescript": "main.ts", "rust": "src/main.rs", "go": None}[language]
    if language == "go":
        shutil.copy(source, GO_DIR / "main.go")
        built = subprocess.run(["go", "build", "-o", "main-linux", "."], cwd=GO_DIR, capture_output=True, text=True,
                               env={**os.environ, "GOFLAGS": "-mod=mod", "GOOS": "linux", "GOARCH": "amd64", "CGO_ENABLED": "0"})
        assert built.returncode == 0, built.stderr
        upload, target = GO_DIR / "main-linux", "main"
    else:
        upload = source
    subprocess.run(["scp", "-q", *REMOTE_SSH, str(upload), f"{args.remote}:{REMOTE_DIRS[language]}/{target}"], check=True)
    build = "../../.cargo/bin/cargo build --release -q && " if language == "rust" else ""
    run_it = {
        "python": "../../venv/bin/python main.py",
        "typescript": "../../node/bin/node --experimental-strip-types --no-warnings main.ts",
        "rust": "./target/release/docs",
        "go": "./main",
    }[language]
    assignments = " ".join(f"{k}={shlex.quote(v)}" for k, v in env.items())
    line = f"cd {REMOTE_DIRS[language]} && {build}env -i HOME=$HOME PATH=/usr/bin:/bin {assignments} {run_it}"
    return subprocess.run([*ssh, line], capture_output=True, text=True, timeout=900)


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


def tidy(text: str, where: str) -> str:
    text = text.replace(where, "~").replace(str(WORK) + "/", "")
    assert str(REAL_HOME) not in text, text
    for name, value in PRIVATE.items():
        assert value not in text, f"{name} reached a recording"
    assert not re.search(r"(?<![\d.])\d{12}(?![\d.])", text), f"an AWS account number reached a recording:\n{text}"
    return text


def environment(where: pathlib.Path, extra: dict) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith(CLOUD_PREFIXES)}
    env.update(HOME=str(where), PATH=AZ_PATH + os.environ["PATH"], **extra)
    return env


def run(step: str, file: str, where: pathlib.Path | None, model: str | None, extra: dict | None = None,
        languages=tuple(LANGUAGES)) -> dict:
    """`where` is the throwaway home; None runs on the --remote machine."""
    out: dict = {"file": file}
    if where is None:
        out["where"] = REMOTE_WHERE
    for language in languages:
        source = SNIPPETS / f"{file}.{LANGUAGES[language]}"
        if where is None:
            done, shown = remote(language, source, extra or {}), "/home/ubuntu"
        else:
            argv, cwd = command(language, source)
            done = subprocess.run(argv, cwd=cwd, env=environment(where, extra or {}), capture_output=True, text=True, timeout=300)
            shown = str(where)
        record = {"code": source.read_text(), "output": tidy(done.stdout, shown)}
        error = raised(language, done.stderr)
        if done.returncode != 0:
            assert error, f"{step}/{language}: failed without an error LM15 raised:\n{done.stderr}"
            record["error"] = tidy(error, shown)
        elif model and record["output"].strip():
            record["model"] = model
        out[language] = record
        print(f"== {step} / {language}\n{record['output']}{record.get('error', '')}\n", flush=True)
    return out


# ── the steps ────────────────────────────────────────────────────────────
REMOTE_SSH = shlex.split(os.environ.get("LM15_REMOTE_SSH_OPTIONS", ""))
REMOTE_WHERE = os.environ.get("LM15_REMOTE_WHERE", "")

AZURE_SP = {k: LAB[k] for k in ("AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET")} if LAB else {}
DEEPSEEK = "bedrock-chat:deepseek.v3.2"
GPT = "azure:gpt-4.1-mini"

STEPS = {
    "aws": {
        # a laptop: access keys from `aws configure`, its region us-east-1
        "ask": lambda: run("ask", "ask", home("aws", aws=True), DEEPSEEK),
        "doctor": lambda: run("doctor", "doctor", home("aws", aws=True), None),
        # the same program, AWS_REGION naming a region without the model
        "wrong_region": lambda: run("wrong_region", "ask", home("aws", aws=True), None, {"AWS_REGION": "ca-central-1"}),
        # the region in the program's settings, AWS_REGION naming another
        "region": lambda: run("region", "region", home("aws", aws=True), DEEPSEEK, {"AWS_REGION": "ca-central-1"}),
        "platform": lambda: run("platform", "platform", home("aws", aws=True), None),
        "gpt_oss": lambda: run("gpt_oss", "gpt_oss", home("aws", aws=True), "bedrock-chat:openai.gpt-oss-120b-1:0"),
        "gpt_oss_mantle": lambda: run("gpt_oss_mantle", "gpt_oss_mantle", home("aws", aws=True), "bedrock-mantle-chat:openai.gpt-oss-120b"),
        "claude": lambda: run("claude", "claude", home("aws", aws=True), None),
        # an EC2 instance with an instance role and nothing else
        # (scripts/capture-aws-ec2.sh), with and without AWS_REGION
        "platform_ec2": lambda: run("platform_ec2", "platform", None, DEEPSEEK, {"AWS_REGION": "us-east-1"}),
        "platform_ec2_no_region": lambda: run("platform_ec2_no_region", "platform", None, None),
        # a Bedrock API key and nothing else
        "bearer": lambda: run("bearer", "ask", home("bare"), DEEPSEEK,
                              {"AWS_BEARER_TOKEN_BEDROCK": BEARER["AWS_BEARER_TOKEN_BEDROCK"], "AWS_REGION": "us-east-1"}),
    },
    "azure": {
        # a laptop: `az login`, the endpoint from the portal, no key
        "ask": lambda: run("ask", "ask", home("az", azure_cli=True), GPT, {"AZURE_OPENAI_ENDPOINT": ENDPOINT}),
        "doctor": lambda: run("doctor", "doctor", home("az", azure_cli=True), None, {"AZURE_OPENAI_ENDPOINT": ENDPOINT}),
        # the same laptop with the resource's key in the environment too
        "doctor_key": lambda: run("doctor_key", "doctor", home("az", azure_cli=True), None,
                                  {"AZURE_OPENAI_ENDPOINT": ENDPOINT, "AZURE_OPENAI_API_KEY": LAB["AZURE_OPENAI_API_KEY"]}),
        "key": lambda: run("key", "ask", home("bare"), GPT,
                           {"AZURE_OPENAI_ENDPOINT": ENDPOINT, "AZURE_OPENAI_API_KEY": LAB["AZURE_OPENAI_API_KEY"]}),
        "wrong_deployment": lambda: run("wrong_deployment", "wrong_deployment", home("az", azure_cli=True), None,
                                        {"AZURE_OPENAI_ENDPOINT": ENDPOINT}),
        "platform": lambda: run("platform", "platform", home("az", azure_cli=True), None, {"AZURE_OPENAI_ENDPOINT": ENDPOINT}),
        # GitHub Actions, another cloud: a service principal in the environment
        "environment": lambda: run("environment", "environment", home("bare"), GPT,
                                   {"AZURE_OPENAI_ENDPOINT": ENDPOINT, **AZURE_SP}),
        "identity": lambda: run("identity", "identity", home("az", azure_cli=True), GPT,
                                {"AZURE_OPENAI_ENDPOINT": ENDPOINT}, languages=("python", "typescript", "go")),
    },
    "clouds": {
        "three": lambda: run("three", "three", home("all", aws=True, azure_cli=True, gcloud=True), None,
                             {"AZURE_OPENAI_ENDPOINT": ENDPOINT}),
    },
}[args.page]

previous = json.loads(OUT.read_text()) if OUT.exists() else {"steps": {}}
steps = dict(previous["steps"])
REMOTE_STEPS = {name for name in STEPS if name.endswith("_ec2") or "_ec2_" in name}
chosen = [name for name in STEPS if (name in args.only if args.only else name not in REMOTE_STEPS)]
if any(name in REMOTE_STEPS for name in chosen) and not args.remote:
    sys.exit("the _ec2 steps need --remote (run scripts/capture-aws-ec2.sh)")
for name, record in STEPS.items():
    if name in chosen:
        steps[name] = record()
dates = dict(previous.get("dates", {}))
today = datetime.date.today().isoformat()
for name in chosen:
    dates[name] = today
OUT.write_text(json.dumps({"date": max(dates.values()), "dates": dates, "steps": steps}, indent=2, ensure_ascii=False) + "\n")
shutil.rmtree(WORK)
print(f"wrote {OUT}")
