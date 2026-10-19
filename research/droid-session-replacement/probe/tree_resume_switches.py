#!/usr/bin/env python3
"""Signed-in Droid processes that replace their session in place with /tree or /resume <id>, many times each.

usage: tree_resume_switches.py <0.238.0|0.244.0> <tree|resume> <processes> <switches-per-process>

Needs pyte to read the rendered screen. Set KEY_FILE to a file with a FACTORY_API_KEY= line;
the value only goes into the child environment and is never printed or written. Never reads ~/.factory.

Free runs only. 0.238.0 has no /resume slash command: typing it sends a message and spends credits.
This driver refuses /resume unless the version is 0.244.0. It never types /compress, /handoff or /missions.
Any hook other than SessionStart or SessionEnd stops the run.

One SessionStart command (SS_PLACE unset): SS_DELAY_MS / SS_DELAY_MODE / HOOK_TIMEOUT_S, as before.
Two SessionStart commands, when SS_PLACE is set:
  SS_PLACE=entry|entries|split  SS_ORDER=slow-first|fast-first  SS_SLOW_MS  SS_FAST_MS
  SS_FAST_MS=0 posts immediately (the fast command). SS_SLOW_MODE / SS_FAST_MODE default to before.
  split order is file placement: slow-first means settings.json is slow and hooks.json is fast.
  hooks.json replaces the settings.json command for that event, so a split run waits for the hooks.json command only.
Output: $PROBE_ROOT/out-switch-<version>-<tree|resume>-<suffix>
  one command: d<ms>[a][t<timeout>]
  two: <place>-<order>-s<slow>-f<fast>[t<timeout>]
A two-command switch waits for cmd slow, cmd fast, and one SessionEnd (three listener rows).
"""
import fcntl, glob, json, os, pty, re, select, signal, struct, subprocess, sys, termios, time

import pyte

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from env_child import child_env, load_key

ROOT = os.environ.get("PROBE_ROOT", "/tmp/droid-34")
HOOK_PROBE = os.path.join(ROOT, "probe")
COLS, ROWS = 120, 40
UP, DOWN, ESC = "\x1b[A", "\x1b[B", "\x1b"
SESSION_EVENTS = ("SessionStart", "SessionEnd")
# Timeout check: a hook killed at its timeout never posts, so a switch is complete once SessionEnd arrives.
START_MAY_BE_MISSING = os.environ.get("EXPECT_START_MISSING") == "1"
HOOK_SETTLE_S = 8
# Extra seconds on every wait, for a hook that runs past Droid's default 60 s timeout.
EXTRA_WAIT = float(os.environ.get("SLOW_WAIT_S", "0") or "0")


def output_suffix(delay_ms, delay_mode, hook_timeout, place, order, slow_ms, fast_ms):
    if place == "split":
        # hooks.json replaces the settings.json command for the same event. Not a two-command cell.
        suffix = "split-repl-%s-s%s-f%s" % (order, slow_ms, fast_ms)
        return suffix + ("t" + hook_timeout if hook_timeout else "")
    if place:
        suffix = "%s-%s-s%s-f%s" % (place, order, slow_ms, fast_ms)
        return suffix + ("t" + hook_timeout if hook_timeout else "")
    return "d%d" % delay_ms + ("a" if delay_mode == "after" else "") + ("t" + hook_timeout if hook_timeout else "")


def switch_starts_ready(two, fresh, hooks_cmd=""):
    starts = [row for row in fresh if row.get("event") == "SessionStart"]
    if hooks_cmd:
        return any(row.get("cmd") == hooks_cmd for row in starts)
    if two:
        return {"slow", "fast"} <= {row.get("cmd") for row in starts}
    return bool(starts)


def slow_extra(batch):
    return int(batch.slow_ms) / 1000.0 if batch.two else 0


class Stop(Exception):
    """A condition the run must not continue past."""


class Term:
    def __init__(self, argv, env, cwd):
        self.screen = pyte.Screen(COLS, ROWS)
        self.stream = pyte.ByteStream(self.screen)
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd)
            os.execvpe(argv[0], argv, env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
        self.alive = True
        self.last_data = time.time()

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end and self.alive:
            ready, _, _ = select.select([self.fd], [], [], 0.05)
            if not ready:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                self.alive = False
                return
            if not data:
                self.alive = False
                return
            self.stream.feed(data)
            self.last_data = time.time()

    def send(self, text):
        os.write(self.fd, text.encode())

    def lines(self):
        return [line.rstrip() for line in self.screen.display]

    def has(self, needle):
        return any(needle in line for line in self.lines())

    def settle(self, quiet=0.8, timeout=10):
        end = time.time() + timeout
        while time.time() < end and self.alive:
            self.pump(0.1)
            if time.time() - self.last_data >= quiet:
                return True
        return False

    def kill(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        for _ in range(30):
            try:
                done, _status = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                return
            if done:
                return
            time.sleep(0.1)


class Batch:
    def __init__(self, version, mode):
        self.version, self.mode = version, mode
        if mode == "resume" and version != "0.244.0":
            raise SystemExit("/resume <id> is only a slash command on 0.244.0; refusing")
        self.place = os.environ.get("SS_PLACE", "")
        self.order = os.environ.get("SS_ORDER", "")
        self.slow_ms = os.environ.get("SS_SLOW_MS", "")
        self.fast_ms = os.environ.get("SS_FAST_MS", "")
        self.two = self.place != ""
        # slow-first puts slow in settings.json and fast in hooks.json. Only the hooks.json command runs.
        self.hooks_cmd = {"slow-first": "fast", "fast-first": "slow"}.get(self.order, "") if self.place == "split" else ""
        if self.two:
            if self.place not in ("entry", "entries", "split") or self.order not in ("slow-first", "fast-first"):
                raise SystemExit("SS_PLACE must be entry, entries or split; SS_ORDER must be slow-first or fast-first")
            if not self.slow_ms.isdigit() or not self.fast_ms.isdigit():
                raise SystemExit("two-command run needs numeric SS_SLOW_MS and SS_FAST_MS")
        self.delay_ms = int(os.environ.get("SS_DELAY_MS", "0") or "0")
        self.delay_mode = os.environ.get("SS_DELAY_MODE", "before")
        self.hook_timeout = os.environ.get("HOOK_TIMEOUT_S", "")
        self.suffix = output_suffix(self.delay_ms, self.delay_mode, self.hook_timeout, self.place, self.order, self.slow_ms, self.fast_ms)
        self.out = os.path.join(ROOT, "out-switch-%s-%s-%s" % (version, mode, self.suffix))
        os.makedirs(self.out, exist_ok=True)
        for name in ("listener.port", "hooks.jsonl", "switches.jsonl", "problems.log", "hook-lifecycle.jsonl"):
            try:
                os.remove(os.path.join(self.out, name))
            except OSError:
                pass
        self.log = os.path.join(self.out, "hooks.jsonl")
        self.markers = os.path.join(self.out, "switches.jsonl")
        self.secret = load_key()
        self.listener = subprocess.Popen([sys.executable, os.path.join(HERE, "listener.py")], env={**os.environ, "PROBE_OUT": self.out})
        port_file = os.path.join(self.out, "listener.port")
        for _ in range(100):
            if os.path.exists(port_file) and self.listener.poll() is None:
                break
            time.sleep(0.05)
        else:
            self.listener.kill()
            raise SystemExit("listener did not bind")
        self.url = "http://127.0.0.1:%s/hook" % open(port_file).read().strip()
        if version == "0.238.0":
            self.bin = os.environ.get("DROID_238", "/tmp/droid-31/bin/0.238.0/droid")
        else:
            self.bin = subprocess.check_output(["/bin/sh", "-c", "command -v droid"], text=True).strip()

    def rows(self, tag=None):
        try:
            text = open(self.log).read()
        except FileNotFoundError:
            return []
        rows = []
        for line in text.splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if tag is None or row.get("tag") == tag:
                rows.append(row)
        return rows

    def guard(self, tag):
        for row in self.rows(tag):
            if row.get("kind") != "hook" or row.get("event") not in SESSION_EVENTS:
                raise Stop("hook other than SessionStart/SessionEnd: %s" % row.get("event", row.get("kind")))

    def max_seq(self, tag):
        return max((row.get("seq", 0) for row in self.rows(tag)), default=0)

    def mark(self, record):
        with open(self.markers, "a") as handle:
            handle.write(json.dumps(record, separators=(",", ":")) + "\n")

    def close(self):
        self.listener.terminate()
        try:
            self.listener.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.listener.kill()


def redact(text, secret):
    text = text.replace(secret, "<key>") if secret else text
    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<uuid>", text)
    text = re.sub("/Us" + r"ers/\S+", "<home>", text)
    return re.sub(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", "<email>", text)


def process_stamp(pid):
    out = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "lstart=,comm="], capture_output=True, text=True, env={**os.environ, "TZ": "UTC0", "LC_ALL": "C"}).stdout.strip()
    return out.rsplit("/", 1)[-1] if out else ""


def session_files(home):
    return {os.path.basename(path)[: -len(".jsonl")] for path in glob.glob(home + "/.factory/sessions/*/*.jsonl")}


def pick_fork(home, added):
    """The new file whose header names a parent session. The original session's file may appear late and has none."""
    forks = []
    for session_id in added:
        for path in glob.glob("%s/.factory/sessions/*/%s.jsonl" % (home, session_id)):
            with open(path) as handle:
                parent = json.loads(handle.readline()).get("parent")
            if parent:
                forks.append(session_id)
    if len(forks) != 1:
        raise Stop("could not tell which new session file is the fork")
    return forks[0]


def type_slash(batch, term, tag, text):
    allowed = text in ("/fork", "/tree") or (batch.version == "0.244.0" and text.startswith("/resume "))
    if not allowed:
        raise Stop("refusing to type %r" % text.split(" ")[0])
    batch.guard(tag)
    term.send(text)
    # A slow command can leave the prompt painted while input is still ignored. Wait to see the echo.
    deadline = time.time() + (2 if getattr(batch, "two", False) else 0.6)
    while time.time() < deadline and not term.has(text.split(" ")[0]):
        term.pump(0.1)
    if not term.has(text.split(" ")[0]):
        raise Stop("typed command not on screen")
    term.send("\r")


def tree_view(term):
    lines = term.lines()
    start = max((i for i, line in enumerate(lines) if "Session tree" in line), default=None)
    if start is None:
        return None
    end = next((i for i in range(start, len(lines)) if "Esc close" in lines[i]), None)
    if end is None:
        return None
    rows = []
    summary_seen = False
    for line in lines[start + 1 : end]:
        body = line.strip().strip("│").strip()
        if not body:
            continue
        if "in this fork family" in body:
            summary_seen = True
            continue
        if not summary_seen or body.strip("╰╯─╭╮"):
            rows.append({"cursor": body.startswith(">"), "tip": "●" in body, "current": "← current" in body})
    paging = re.search(r"(\d+)-(\d+) of (\d+)", lines[end])
    window = tuple(int(n) for n in paging.groups()) if paging else (0, 0, 0)
    return {"rows": rows, "window": window}


def press(term, key, count):
    for _ in range(count):
        term.send(key)
        term.pump(0.08)
    term.pump(0.3)


def goto_other_session_tip(term):
    keys = 0
    direction = None
    for _ in range(200):
        view = tree_view(term)
        if view is None:
            raise Stop("tree not on screen")
        rows = view["rows"]
        cursor = next((i for i, row in enumerate(rows) if row["cursor"]), None)
        if cursor is None:
            raise Stop("no cursor row in tree")
        tips = [i for i, row in enumerate(rows) if row["tip"]]
        if cursor in tips:
            return keys, view["window"]
        if tips:
            count = abs(tips[0] - cursor)
            press(term, DOWN if tips[0] > cursor else UP, count)
        else:
            # Tip not in the visible page: walk one way, turn around at either end of the list.
            first, _last, total = view["window"]
            position = first + cursor
            if direction is None:
                direction = DOWN if position < total else UP
            if direction == DOWN and position >= total:
                direction = UP
            elif direction == UP and position <= 1:
                direction = DOWN
            count = 4
            press(term, direction, count)
        keys += count
    raise Stop("never reached a tip row of another session")


def wait_for_hooks(batch, term, tag, since):
    end = time.time() + 25 + EXTRA_WAIT + slow_extra(batch)
    while time.time() < end:
        term.pump(0.1)
        batch.guard(tag)
        fresh = [row for row in batch.rows(tag) if row.get("seq", 0) > since]
        start_ok = START_MAY_BE_MISSING or switch_starts_ready(batch.two, fresh, batch.hooks_cmd)
        if start_ok and any(r["event"] == "SessionEnd" for r in fresh):
            if START_MAY_BE_MISSING:
                term.pump(HOOK_SETTLE_S)
            return True
    return False


def wait_for_start_cmd(batch, term, tag, since, cmd):
    end = time.time() + 20 + slow_extra(batch)
    while time.time() < end and term.alive:
        term.pump(0.1)
        batch.guard(tag)
        if any(r.get("seq", 0) > since and r.get("event") == "SessionStart" and r.get("cmd") == cmd for r in batch.rows(tag)):
            return True
    return False


def wait_for_prompt(term, extra=0):
    end = time.time() + 15 + EXTRA_WAIT + extra
    while time.time() < end and term.alive:
        term.settle(quiet=0.8, timeout=3)
        if term.has("? for help") and not term.has("Session tree"):
            return True
    return False


def run_process(batch, index, switches):
    tag = "%s/%s-%s-p%d" % (batch.version, batch.mode, batch.suffix, index)
    label = "%s-%s-%s-p%d" % (batch.version, batch.mode, batch.suffix, index)
    env_now = {**os.environ, "PROBE_ROOT": ROOT, "HOOK_TIMEOUT_S": batch.hook_timeout}
    subprocess.check_call(["sh", os.path.join(HOOK_PROBE, "make-home.sh"), label], env=env_now, stdout=subprocess.DEVNULL)
    home = os.path.join(ROOT, "home-" + label)
    delay_env = "0" if batch.two else str(batch.delay_ms)
    mode_env = "before" if batch.two else batch.delay_mode
    env = child_env(home, {"LISTENER_URL": batch.url, "PROBE_TAG": tag, "PROBE_OUT": batch.out,
                           "SS_DELAY_MS": delay_env, "SS_DELAY_MODE": mode_env})
    term = Term([batch.bin], env, os.path.join(ROOT, "proj"))
    stamp = ""
    problems = []
    done = 0
    try:
        term.pump(1.5)
        term.send("\r")
        start_wait = (10 if START_MAY_BE_MISSING else 25) + EXTRA_WAIT + slow_extra(batch)
        end = time.time() + start_wait
        while time.time() < end and not any(r.get("event") == "SessionStart" for r in batch.rows(tag)):
            term.pump(0.1)
        if not wait_for_prompt(term, slow_extra(batch)):
            raise Stop("no prompt after start")
        # Both commands: the fast post is immediate, and the prompt can look idle while the slow one still holds input.
        if batch.two and (not batch.hooks_cmd or batch.hooks_cmd == "slow"):
            if not wait_for_start_cmd(batch, term, tag, 0, "slow"):
                raise Stop("slow SessionStart did not post after start")
            if not wait_for_prompt(term, 0):
                raise Stop("no prompt after slow SessionStart")
        stamp = process_stamp(term.pid)
        known = session_files(home)
        forks = []
        for number in range(1, switches + 1):
            # Two forks give the two sessions to alternate between. Files of sessions that were left empty can vanish.
            if number <= 2:
                type_slash(batch, term, tag, "/fork")
                end = time.time() + 10 + slow_extra(batch)
                while time.time() < end and not session_files(home) - known:
                    term.pump(0.1)
                term.pump(1.5)
                forks.append(pick_fork(home, session_files(home) - known))
                known |= session_files(home)
                wait_for_prompt(term, slow_extra(batch))
            target_id = forks[(number - 1) % 2]
            nav_keys, window = 0, (0, 0, 0)
            if batch.mode == "tree":
                type_slash(batch, term, tag, "/tree")
                end = time.time() + 10 + slow_extra(batch)
                while time.time() < end and tree_view(term) is None:
                    term.pump(0.1)
                term.settle(quiet=0.6, timeout=5)
                nav_keys, window = goto_other_session_tip(term)
                since = batch.max_seq(tag)
                t0 = time.time()
                term.send("\r")
            else:
                since = batch.max_seq(tag)
                t0 = time.time()
                type_slash(batch, term, tag, "/resume " + target_id)
            arrived = wait_for_hooks(batch, term, tag, since)
            term.pump(1.2)
            batch.guard(tag)
            after = batch.max_seq(tag)
            if term.has("Session tree"):
                term.send(ESC)
                problems.append("tree still open after switch %d" % number)
            prompt_back = wait_for_prompt(term, slow_extra(batch))
            same = process_stamp(term.pid) == stamp and stamp != ""
            record = {"tag": tag, "n": number, "mode": batch.mode, "version": batch.version, "seqBefore": since, "seqAfter": after, "hooksArrived": arrived, "promptBack": prompt_back, "sameProcess": same, "navKeys": nav_keys, "treeWindow": list(window), "ms": int((time.time() - t0) * 1000)}
            if batch.two:
                record["place"] = batch.place
                record["order"] = batch.order
                record["slowMs"] = int(batch.slow_ms)
                record["fastMs"] = int(batch.fast_ms)
            if batch.hooks_cmd:
                record["check"] = "replacement"
                record["hooksCmd"] = batch.hooks_cmd
            batch.mark(record)
            if not arrived:
                if batch.hooks_cmd:
                    missing = "no SessionStart (%s) and SessionEnd after switch %d" % (batch.hooks_cmd, number)
                elif batch.two:
                    missing = "no two SessionStart commands and one SessionEnd after switch %d" % number
                else:
                    missing = "no SessionStart and SessionEnd pair after switch %d" % number
                raise Stop(missing)
            if not term.alive or not same:
                raise Stop("process changed or exited at switch %d" % number)
            done = number
        since = batch.max_seq(tag)
        term.send("\x03")
        term.pump(0.7)
        term.send("\x03")
        end = time.time() + 8
        while time.time() < end and term.alive:
            term.pump(0.2)
        batch.mark({"tag": tag, "n": "exit", "seqBefore": since, "seqAfter": batch.max_seq(tag), "exitedOnItsOwn": not term.alive})
    except Stop as stop:
        problems.append(str(stop))
        with open(os.path.join(batch.out, "problems.log"), "a") as handle:
            handle.write("%s %s\n" % (tag, stop))
            handle.write(redact("\n".join(line for line in term.lines() if line), batch.secret) + "\n")
    finally:
        term.kill()
    return done, problems


def main():
    version, mode, processes, switches = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    batch = Batch(version, mode)
    total = 0
    stopped = None
    try:
        for index in range(1, processes + 1):
            done, problems = run_process(batch, index, switches)
            total += done
            print("process", index, "switches", done, "problems", problems, flush=True)
            if any("other than SessionStart" in p for p in problems):
                stopped = problems
                break
            time.sleep(0.5)
    finally:
        batch.close()
    print("TOTAL switches", total, "stopped", stopped)


if __name__ == "__main__":
    main()
