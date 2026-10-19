#!/usr/bin/env python3
"""Droid hook command. Forwards allowlisted fields to the local listener and prints {}.

Records the event, top-level key names, source, reason, and session-id fields for the listener
to turn into relations. Never writes prompts, tool input, messages, paths, or the key.

Delay (SessionStart only): SS_DELAY_MS, or --delay-ms which overrides it. SS_DELAY_MODE=before (default)
waits before printing {}; SS_DELAY_MODE=after prints {} first. --delay-mode overrides the env.
--cmd slow|fast is forwarded as cmd and is not the tag. Omit it for a one-command run.
launchNs is wall-clock ns at process start. Lifecycle rows go to $PROBE_OUT/hook-lifecycle.jsonl.
Never reads ~/.factory. The key is not read, printed, or forwarded.
"""
import json, os, re, signal, sys, time, urllib.request
from subprocess import run

LAUNCH_NS = time.time_ns()

SAFE_NAME = re.compile(r"^[A-Za-z0-9_]{1,64}$")
TOKEN = re.compile(r"^[A-Za-z0-9_.:/-]{1,80}$")
ID_KEYS = ("session_id", "calling_session_id", "previous_session_id")
FORBIDDEN = ("fk-" + "invalid-000000", "no" + "ter", "/Us" + "ers/")


def take_options(argv):
    opt, pos, index = {}, [], 0
    flags = ("--cmd", "--delay-ms", "--delay-mode")
    while index < len(argv):
        if argv[index] in flags and index + 1 < len(argv):
            opt[argv[index]] = argv[index + 1]
            index += 2
        else:
            pos.append(argv[index])
            index += 1
    return opt, pos


OPT, POS = take_options(sys.argv[1:])

raw = sys.stdin.read()

try:
    payload = json.loads(raw)
except ValueError:
    payload = None

tag = POS[0] if POS else os.environ.get("PROBE_TAG", "")
tag = tag if TOKEN.match(tag or "") else "untagged"
cmd_raw = OPT.get("--cmd", "")
cmd = cmd_raw if TOKEN.match(cmd_raw or "") and not any(bad in cmd_raw for bad in FORBIDDEN) else ""
event = payload.get("hook_event_name") if isinstance(payload, dict) else None
event = event if isinstance(event, str) and TOKEN.match(event) else "unparsed"
out_dir = os.environ.get("PROBE_OUT", "")


def lifecycle(stage, delay_ms):
    if not out_dir:
        return
    row = {"tag": tag, "event": event, "stage": stage, "ns": time.time_ns(), "launchNs": LAUNCH_NS, "delayMs": delay_ms}
    if cmd:
        row["cmd"] = cmd
    try:
        fd = os.open(os.path.join(out_dir, "hook-lifecycle.jsonl"), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        os.write(fd, (json.dumps(row, separators=(",", ":")) + "\n").encode())
        os.close(fd)
    except OSError:
        pass


def start_delay_ms():
    if event != "SessionStart":
        return 0
    raw = OPT["--delay-ms"] if "--delay-ms" in OPT else (os.environ.get("SS_DELAY_MS", "0") or "0")
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


delay_ms = start_delay_ms()
mode = OPT.get("--delay-mode") or os.environ.get("SS_DELAY_MODE", "before")
if mode not in ("before", "after"):
    mode = "before"

def on_signal(signum, _frame):
    lifecycle("signal%d" % signum, delay_ms)
    os._exit(0)


for _sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
    signal.signal(_sig, on_signal)

lifecycle("launch", delay_ms)
if delay_ms and mode != "after":
    time.sleep(delay_ms / 1000.0)
    lifecycle("survived", delay_ms)

sys.stdout.write("{}\n")
sys.stdout.flush()

if delay_ms and mode == "after":
    time.sleep(delay_ms / 1000.0)
    lifecycle("survived", delay_ms)

url = os.environ.get("LISTENER_URL", "")
if not url:
    sys.exit(0)

out = {"tag": tag, "launchNs": LAUNCH_NS, "delayMs": delay_ms}
if cmd:
    out["cmd"] = cmd
if isinstance(payload, dict):
    out["event"] = event
    out["keys"] = sorted(k for k in payload.keys() if isinstance(k, str) and SAFE_NAME.match(k) and not any(bad in k for bad in FORBIDDEN))
    for name in ("source", "reason"):
        if name in payload and isinstance(payload[name], str):
            out[name] = payload[name]
    for name in ID_KEYS:
        if name not in payload:
            continue
        value = payload[name]
        if value is None or value == "" or isinstance(value, str):
            out[name] = value
        else:
            out[name] = {"type": type(value).__name__}
else:
    out["event"] = "unparsed"

pid = os.getppid()
for _ in range(6):
    if pid <= 1:
        break
    proc = run(["/bin/ps", "-p", str(pid), "-o", "ppid=,lstart=,comm="], capture_output=True, text=True, env={**os.environ, "TZ": "UTC0", "LC_ALL": "C"})
    parts = proc.stdout.strip().split(None, 6)
    if len(parts) < 7:
        break
    comm = parts[6].split("/")[-1]
    if comm == "droid":
        out["process"] = {"pid": pid, "start": " ".join(parts[1:6])}
        break
    try:
        pid = int(parts[0])
    except ValueError:
        break

data = json.dumps(out).encode()
req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
try:
    urllib.request.urlopen(req, timeout=5).read()
except Exception:
    sys.exit(0)
