#!/usr/bin/env python3
"""Prove the logger drops planted secrets, then write hooks.jsonl. No Droid process."""
import json, os, subprocess, sys, time, urllib.request

PROBE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("PROBE_OUT", "/tmp/droid-34/self-test")
DEST = os.environ.get("PROBE_DEST", "")
os.makedirs(OUT, exist_ok=True)
log_path = os.path.join(OUT, "hooks.jsonl")
port_file = os.path.join(OUT, "listener.port")
for path in (log_path, port_file):
    try:
        os.remove(path)
    except OSError:
        pass

listener = subprocess.Popen([sys.executable, os.path.join(PROBE, "listener.py")], env={**os.environ, "PROBE_OUT": OUT}, stderr=subprocess.PIPE)
for _ in range(50):
    if os.path.exists(port_file) and listener.poll() is None:
        break
    time.sleep(0.05)
else:
    err = listener.stderr.read().decode("utf-8", "replace") if listener.stderr else ""
    listener.kill()
    sys.exit("listener did not bind")
port = open(port_file).read().strip()
url = "http://127.0.0.1:%s/hook" % port

planted_prompt = "PLANTED_PROMPT_MARKER"
planted_tool = "PLANTED_TOOL_MARKER"
planted_message = "PLANTED_MESSAGE_MARKER"
planted_key = "fk-" + "invalid-000000"
planted_user = "no" + "ter"
planted_home = "/Us" + "ers/" + planted_user + "/secret"
payload = {
    "hook_event_name": "SessionStart",
    "source": "startup",
    "reason": "other",
    "session_id": "id-one",
    "calling_session_id": "id-one",
    "previous_session_id": "id-two",
    "prompt": planted_prompt,
    "tool_input": planted_tool,
    "message": planted_message,
    "cwd": planted_home,
    planted_user: planted_key,
}
env = {**os.environ, "LISTENER_URL": url, "PROBE_TAG": "self-test", "FACTORY_API_KEY": planted_key}
proc = subprocess.run([sys.executable, os.path.join(PROBE, "hook-log.py")], input=json.dumps(payload), text=True, capture_output=True, env=env)
if proc.stdout.strip() != "{}":
    listener.kill()
    sys.exit("hook stdout was not {}")

# A direct post with the same planted values must also be stripped by the listener.
direct = {"tag": "self-test", "event": "SessionEnd", "keys": ["cwd", "prompt", planted_user], "reason": "clear", "session_id": "id-two", "prompt": planted_prompt, "cwd": planted_home}
urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(direct).encode(), method="POST"), timeout=5).read()
time.sleep(0.2)
listener.terminate()
try:
    listener.wait(timeout=2)
except subprocess.TimeoutExpired:
    listener.kill()

text = open(log_path).read()
bad = [planted_prompt, planted_tool, planted_message, planted_key, planted_user, planted_home, "id-one", "id-two"]
leaked = [item for item in bad if item in text]
if leaked:
    sys.exit("leaked %s" % len(leaked))
rows = [json.loads(line) for line in text.splitlines() if line.strip()]
if len(rows) != 2:
    sys.exit("expected 2 rows, got %s" % len(rows))
if [row["seq"] for row in rows] != [1, 2]:
    sys.exit("seq was not arrival order")
if rows[0]["arrivalNs"] > rows[1]["arrivalNs"]:
    sys.exit("arrival clock went backwards")
first, second = rows
if first["event"] != "SessionStart" or first["source"] != "startup" or first["reason"] != "other":
    sys.exit("first row lost allowlisted scalars")
if first["ids"]["session_id"] != "S1 (new)" or first["ids"]["calling_session_id"] != "S1" or first["ids"]["previous_session_id"] != "S2 (new)":
    sys.exit("id relations were wrong")
if "prompt" not in first["keys"] or planted_user in first["keys"]:
    sys.exit("key names were not filtered")
if second["ids"]["session_id"] != "S2" or second["reason"] != "clear":
    sys.exit("second row did not reuse S2")
if first["process"] not in ("absent", "P1 (new)"):
    sys.exit("unexpected process identity")
if '"pid"' in text:
    sys.exit("raw process id was written")

auth = [
    {"kind": "auth-smoke", "tag": "0.244.0/auth", "version": "0.244.0", "exited": True, "sawPrompt": False},
    {"kind": "auth-smoke", "tag": "0.238.0/auth", "version": "0.238.0", "exited": True, "sawPrompt": False},
]
with open(log_path, "a") as fh:
    for row in auth:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")
if DEST:
    open(DEST, "w").write(open(log_path).read())
print("self-test ok")
