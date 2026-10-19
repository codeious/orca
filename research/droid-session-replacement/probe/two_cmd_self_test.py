#!/usr/bin/env python3
"""Synthetic checks for the two-command probe. No Droid process and no key."""
import json, os, subprocess, sys, tempfile, time, urllib.request

PROBE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROBE)
import tree_resume_switches as driver
import two_cmd_order as order

PY = "/usr/bin/python3"
OLD_SETTINGS = r"""
const cmd = process.argv[1]
const timeout = process.argv[2] ? Number(process.argv[2]) : undefined
const entry = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd, ...(timeout ? { timeout } : {}) }] }]
const hooks = {}
for (const name of ["SessionStart","SessionEnd","UserPromptSubmit","Stop","SubagentStop","Notification","PreCompact"]) hooks[name] = entry()
for (const name of ["PreToolUse","PostToolUse"]) hooks[name] = entry("*")
process.stdout.write(JSON.stringify({ hooks }, null, 2))
"""


def fail(msg):
    sys.exit(msg)


class FakeTerm:
    def __init__(self):
        self.sent = []

    def send(self, text):
        self.sent.append(text)

    def pump(self, _seconds):
        return None

    def has(self, _needle):
        return True


class FakeBatch:
    def __init__(self, version):
        self.version = version

    def guard(self, _tag):
        return None


def check_resume_refusal():
    try:
        driver.Batch("0.238.0", "resume")
    except SystemExit as exc:
        if "0.244.0" not in str(exc):
            fail("resume refusal text changed")
    else:
        fail("0.238.0 resume was not refused")
    try:
        driver.type_slash(FakeBatch("0.238.0"), FakeTerm(), "tag", "/resume abc")
    except driver.Stop as exc:
        if "resume" not in str(exc):
            fail("typed resume was not the refusal")
    else:
        fail("type_slash sent /resume on 0.238.0")
    for text in ("/compress", "/handoff", "/missions", "/resume"):
        try:
            driver.type_slash(FakeBatch("0.244.0"), FakeTerm(), "tag", text)
        except driver.Stop:
            continue
        fail("allowed %s" % text)
    term = FakeTerm()
    driver.type_slash(FakeBatch("0.244.0"), term, "tag", "/resume abc")
    if term.sent[0] != "/resume abc":
        fail("0.244.0 did not accept /resume <id>")
    os.environ["SS_PLACE"] = "nope"
    try:
        try:
            driver.Batch("0.244.0", "tree")
        except SystemExit as exc:
            if "SS_PLACE" not in str(exc):
                fail("bad place was not refused")
        else:
            fail("bad SS_PLACE started a batch")
    finally:
        os.environ.pop("SS_PLACE", None)
    if driver.output_suffix(15000, "before", "", "", "", "", "") != "d15000":
        fail("single suffix drifted")
    if driver.output_suffix(11000, "after", "", "", "", "", "") != "d11000a":
        fail("after suffix drifted")
    if driver.output_suffix(6000, "before", "2", "", "", "", "") != "d6000t2":
        fail("timeout suffix drifted")
    if driver.output_suffix(0, "before", "", "entry", "slow-first", "15000", "0") != "entry-slow-first-s15000-f0":
        fail("two-command suffix drifted")
    if driver.output_suffix(0, "before", "", "split", "slow-first", "15000", "0") != "split-repl-slow-first-s15000-f0":
        fail("split suffix drifted")
    if not driver.switch_starts_ready(True, [{"event": "SessionStart", "cmd": "fast"}], "fast"):
        fail("hooks.json command was not enough for split")
    if driver.switch_starts_ready(True, [{"event": "SessionStart", "cmd": "fast"}], "slow"):
        fail("settings.json command satisfied a split wait")
    fresh = [{"event": "SessionStart", "cmd": "fast"}, {"event": "SessionEnd"}]
    if driver.switch_starts_ready(True, fresh) or not driver.switch_starts_ready(False, fresh):
        fail("switch ready rule drifted")
    fresh.append({"event": "SessionStart", "cmd": "slow"})
    if not driver.switch_starts_ready(True, fresh):
        fail("two starts were not ready")

    class One:
        two = False
        slow_ms = "15000"

    class Two:
        two = True
        slow_ms = "15000"

    if driver.slow_extra(One()) != 0 or driver.slow_extra(Two()) != 15:
        fail("slow extra changed the one-command waits")


def settings_bytes(root, label, env):
    home = os.path.join(root, "home-" + label, ".factory")
    subprocess.check_call(["sh", os.path.join(PROBE, "make-home.sh"), label], env=env, stdout=subprocess.DEVNULL)
    text = open(os.path.join(home, "settings.json")).read()
    hooks_path = os.path.join(home, "hooks.json")
    hooks = open(hooks_path).read() if os.path.exists(hooks_path) else ""
    return text, hooks


def check_make_home():
    root = tempfile.mkdtemp(prefix="droid-38-home-")
    cmd = "/usr/bin/python3 %s/probe/hook-log.py" % root
    base = dict(os.environ)
    base["PROBE_ROOT"] = root
    base.pop("SS_PLACE", None)
    base.pop("SS_ORDER", None)
    base.pop("SS_SLOW_MS", None)
    base.pop("SS_FAST_MS", None)
    base.pop("HOOK_TIMEOUT_S", None)
    got, hooks = settings_bytes(root, "plain", base)
    old = subprocess.check_output(["node", "-e", OLD_SETTINGS, cmd], text=True)
    if got != old or hooks:
        fail("single-command settings.json changed")
    timed = dict(base)
    timed["HOOK_TIMEOUT_S"] = "2"
    got, _hooks = settings_bytes(root, "timed", timed)
    old = subprocess.check_output(["node", "-e", OLD_SETTINGS, cmd, "2"], text=True)
    if got != old:
        fail("timeout settings.json changed")
    two = dict(base)
    two.update({"SS_PLACE": "entry", "SS_ORDER": "slow-first", "SS_SLOW_MS": "15000", "SS_FAST_MS": "0"})
    got, hooks = settings_bytes(root, "entry-slow", two)
    if hooks:
        fail("entry place wrote hooks.json")
    start = json.loads(got)["hooks"]["SessionStart"]
    if len(start) != 1 or [item["command"] for item in start[0]["hooks"]] != [
        cmd + " --cmd slow --delay-ms 15000 --delay-mode before",
        cmd + " --cmd fast --delay-ms 0 --delay-mode before",
    ]:
        fail("entry slow-first order wrong")
    if len(json.loads(got)["hooks"]["SessionEnd"][0]["hooks"]) != 1:
        fail("SessionEnd was not one command")
    two["SS_ORDER"] = "fast-first"
    got, _hooks = settings_bytes(root, "entry-fast", two)
    commands = [item["command"] for item in json.loads(got)["hooks"]["SessionStart"][0]["hooks"]]
    if not commands[0].endswith("--cmd fast --delay-ms 0 --delay-mode before") or "--cmd slow" not in commands[1]:
        fail("entry fast-first order wrong")
    two.update({"SS_PLACE": "entries", "SS_ORDER": "slow-first"})
    got, hooks = settings_bytes(root, "entries", two)
    groups = json.loads(got)["hooks"]["SessionStart"]
    if hooks or len(groups) != 2 or "--cmd slow" not in groups[0]["hooks"][0]["command"] or "--cmd fast" not in groups[1]["hooks"][0]["command"]:
        fail("entries order wrong")
    two.update({"SS_PLACE": "split", "SS_ORDER": "slow-first", "SS_FAST_MODE": "after"})
    got, hooks = settings_bytes(root, "split-slow", two)
    settings_cmd = json.loads(got)["hooks"]["SessionStart"][0]["hooks"][0]["command"]
    hooks_cmd = json.loads(hooks)["SessionStart"][0]["hooks"][0]["command"]
    if "--cmd slow" not in settings_cmd or "--cmd fast" not in hooks_cmd or "--delay-mode after" not in hooks_cmd:
        fail("split slow-first placement wrong")
    if "SessionEnd" in json.loads(hooks) or len(json.loads(got)["hooks"]["SessionEnd"][0]["hooks"]) != 1:
        fail("split SessionEnd was not only in settings")
    two["SS_ORDER"] = "fast-first"
    got, hooks = settings_bytes(root, "split-fast", two)
    if "--cmd fast" not in json.loads(got)["hooks"]["SessionStart"][0]["hooks"][0]["command"] or "--cmd slow" not in json.loads(hooks)["SessionStart"][0]["hooks"][0]["command"]:
        fail("split fast-first placement wrong")


def post_hook(url, args, env, payload):
    proc = subprocess.run([PY, os.path.join(PROBE, "hook-log.py"), *args], input=json.dumps(payload), text=True, capture_output=True, env=env, timeout=3)
    if proc.stdout.strip() != "{}":
        fail("hook stdout was not {}")
    return proc


def check_hook_roundtrip():
    out = tempfile.mkdtemp(prefix="droid-38-hook-")
    port_file = os.path.join(out, "listener.port")
    listener = subprocess.Popen([PY, os.path.join(PROBE, "listener.py")], env={**os.environ, "PROBE_OUT": out}, stderr=subprocess.PIPE)
    for _ in range(50):
        if os.path.exists(port_file) and listener.poll() is None:
            break
        time.sleep(0.05)
    else:
        listener.kill()
        fail("listener did not bind")
    url = "http://127.0.0.1:%s/hook" % open(port_file).read().strip()
    payload = {"hook_event_name": "SessionStart", "source": "resume", "session_id": "id-one"}
    env = {**os.environ, "LISTENER_URL": url, "PROBE_TAG": "round", "PROBE_OUT": out, "SS_DELAY_MS": "250"}
    t0 = time.time()
    post_hook(url, [], env, payload)
    if time.time() - t0 < 0.2:
        listener.kill()
        fail("SS_DELAY_MS did not wait")
    env["SS_DELAY_MS"] = "2000"
    t0 = time.time()
    post_hook(url, ["--cmd", "fast", "--delay-ms", "0"], env, payload)
    if time.time() - t0 > 0.4:
        listener.kill()
        fail("--delay-ms did not override SS_DELAY_MS")
    post_hook(url, ["--cmd", "slow", "--delay-ms", "0"], env, payload)
    post_hook(url, ["--cmd", "bad cmd", "--delay-ms", "0"], env, payload)
    planted = "fk-" + "invalid-000000"
    post_hook(url, ["--cmd", planted, "--delay-ms", "0"], env, payload)
    direct = {"tag": "round", "event": "SessionEnd", "cmd": "fast", "reason": "other", "session_id": "id-one"}
    urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(direct).encode(), method="POST"), timeout=5).read()
    time.sleep(0.2)
    listener.terminate()
    try:
        listener.wait(timeout=2)
    except subprocess.TimeoutExpired:
        listener.kill()
    rows = [json.loads(line) for line in open(os.path.join(out, "hooks.jsonl")) if line.strip()]
    if [row.get("cmd") for row in rows] != [None, "fast", "slow", None, None, "fast"]:
        fail("cmd allowlist mismatch")
    if any("cmd" in row and row["cmd"] not in ("slow", "fast") for row in rows):
        fail("invalid cmd was kept")
    if planted in open(os.path.join(out, "hooks.jsonl")).read():
        fail("cmd value leaked")
    life = [json.loads(line) for line in open(os.path.join(out, "hook-lifecycle.jsonl")) if line.strip()]
    if [row.get("cmd") for row in life if row.get("stage") == "launch"] != [None, "fast", "slow", None, None]:
        fail("lifecycle cmd mismatch")
    if "id-one" in open(os.path.join(out, "hooks.jsonl")).read():
        fail("session id leaked")


def row(seq, event, cmd, launch_ms, arrival_ms, reason=None):
    body = {
        "kind": "hook", "seq": seq, "tag": "0.244.0/tree-p1", "event": event,
        "launchNs": launch_ms * 1000000, "arrivalNs": arrival_ms * 1000000, "arrivalWallNs": arrival_ms * 1000000,
        "delayMs": 0, "process": "P1", "ids": {"session_id": "S2", "calling_session_id": "absent", "previous_session_id": "S1"},
    }
    if cmd:
        body["cmd"] = cmd
    if event == "SessionStart":
        body["source"] = "resume"
    else:
        body["reason"] = reason or "other"
    return body


def marker(seq_after, same=True):
    return {"tag": "0.244.0/tree-p1", "n": 1, "mode": "tree", "version": "0.244.0", "place": "entry", "order": "slow-first",
            "slowMs": 15000, "fastMs": 0, "seqBefore": 0, "seqAfter": seq_after, "sameProcess": same}


def check_analysis():
    cases = {
        "per-event": (
            [row(1, "SessionEnd", None, 10000, 10020), row(2, "SessionStart", "slow", 0, 15000), row(3, "SessionStart", "fast", 15000, 15020)],
            {"launch": "sequential", "wait": "per-event", "fastAfterEnd": 1, "exactTriple": 1, "extraRows": 0, "launchGapMsMedian": 15000},
        ),
        "parallel": (
            [row(1, "SessionStart", "fast", 20, 40), row(2, "SessionEnd", None, 10050, 10070), row(3, "SessionStart", "slow", 0, 15000)],
            {"launch": "parallel", "wait": "indistinguishable", "fastAfterEnd": 0, "exactTriple": 1, "arrivalGapFastMsMedian": 10030.0},
        ),
        "per-command": (
            [row(1, "SessionStart", "fast", 0, 30), row(2, "SessionEnd", None, 20100, 20120), row(3, "SessionStart", "slow", 10050, 25050)],
            {"launch": "sequential", "wait": "per-command", "fastAfterEnd": 0, "endFromFastMsMedian": 20100, "endFromSlowMsMedian": 10050},
        ),
        "under-cap": (
            [row(1, "SessionStart", "fast", 10, 20), row(2, "SessionStart", "slow", 0, 6000), row(3, "SessionEnd", None, 6300, 6350)],
            {"launch": "parallel", "wait": "indistinguishable", "fastAfterEnd": 0, "sameProcess": 1},
        ),
    }
    for name, (hooks, expect) in cases.items():
        got = order.summarize(name, hooks, [marker(3)])
        for key, value in expect.items():
            if got.get(key) != value:
                fail("%s %s was %s" % (name, key, got.get(key)))
    changed = order.summarize("changed", cases["parallel"][0], [marker(3, same=False)])
    if changed["processChanged"] != 1 or changed["sameProcess"] != 0:
        fail("sameProcess was not counted")
    missing = order.summarize("missing", [row(1, "SessionEnd", None, 10000, 10010), row(2, "SessionStart", "fast", 15000, 15010)], [marker(2)])
    if missing["extraRows"] != 1 or missing["fastAfterEnd"] != 1 or missing["exactTriple"] != 0:
        fail("missing slow command was labeled wrong")
    other = order.classify(0, 5000 * 1000000, 2000 * 1000000)
    if other != ("sequential", "other"):
        fail("unmatched wait was %s" % (other,))
    import listener
    if not listener.TOKEN.match("0.244.0/resume-entries-fast-first-s15000-f0-p1"):
        fail("tag token too short")
    repl = order.summarize("repl", [row(1, "SessionEnd", None, 10000, 10020), row(2, "SessionStart", "slow", 0, 15000)],
                           [{**marker(2), "place": "split", "check": "replacement", "hooksCmd": "slow", "order": "fast-first"}])
    if repl["exactPair"] != 1 or repl["ranAfterEnd"] != 1 or repl["fastAfterEnd"] != 0 or repl["launch"] != "single" or repl["extraRows"] != 0:
        fail("replacement window was %s" % {k: repl.get(k) for k in ("exactPair", "ranAfterEnd", "fastAfterEnd", "launch", "extraRows")})


def check_old_switch_order():
    fixtures = os.path.join(os.path.dirname(PROBE), "slow-start-hooks.jsonl")
    switches = os.path.join(os.path.dirname(PROBE), "slow-start-switches.jsonl")
    got = subprocess.check_output([sys.executable, os.path.join(PROBE, "switch_order.py"), "--fixtures", fixtures, switches])
    digest = subprocess.check_output(["/usr/bin/shasum", "-a", "256"], input=got).split()[0].decode()
    if digest != "0db7d05f961c12fb112a291365c07077f83164ef2288c6cd7f744446691b7bbb":
        fail("switch_order fixtures changed")
    subprocess.check_output([sys.executable, os.path.join(PROBE, "two_cmd_order.py"), "--fixtures", fixtures, switches])


def main():
    check_resume_refusal()
    check_make_home()
    check_hook_roundtrip()
    check_analysis()
    check_old_switch_order()
    print("two-cmd self-test ok")


if __name__ == "__main__":
    main()
