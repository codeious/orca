#!/usr/bin/env python3
"""Signed-in Droid processes that replace their session in place with /tree or /resume <id>, many times each.

usage: tree_resume_switches.py <0.238.0|0.244.0> <tree|resume> <processes> <switches-per-process>

Needs pyte (pip install pyte) to read the rendered screen. Set KEY_FILE to a file with a FACTORY_API_KEY= line;
the value only goes into the child environment and is never printed or written.

Only /fork, /tree and (0.244.0 only) /resume <id> are ever typed. Any hook other than SessionStart and
SessionEnd stops the run at once, because it would mean a prompt was submitted.
Writes hooks.jsonl (from listener.py) and switches.jsonl (one marker per switch) under $PROBE_ROOT/out-switch-<version>-<mode>.
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
        self.out = os.path.join(ROOT, "out-switch-%s-%s" % (version, mode))
        os.makedirs(self.out, exist_ok=True)
        for name in ("listener.port", "hooks.jsonl", "switches.jsonl", "problems.log"):
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
    term.pump(0.6)
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
    end = time.time() + 25
    while time.time() < end:
        term.pump(0.1)
        batch.guard(tag)
        fresh = [row for row in batch.rows(tag) if row.get("seq", 0) > since]
        if any(r["event"] == "SessionStart" for r in fresh) and any(r["event"] == "SessionEnd" for r in fresh):
            return True
    return False


def wait_for_prompt(term):
    end = time.time() + 15
    while time.time() < end and term.alive:
        term.settle(quiet=0.8, timeout=3)
        if term.has("? for help") and not term.has("Session tree"):
            return True
    return False


def run_process(batch, index, switches):
    tag = "%s/%s-p%d" % (batch.version, batch.mode, index)
    label = "%s-%s-p%d" % (batch.version, batch.mode, index)
    env_now = {**os.environ, "PROBE_ROOT": ROOT}
    subprocess.check_call(["sh", os.path.join(HOOK_PROBE, "make-home.sh"), label], env=env_now, stdout=subprocess.DEVNULL)
    home = os.path.join(ROOT, "home-" + label)
    env = child_env(home, {"LISTENER_URL": batch.url, "PROBE_TAG": tag, "PROBE_OUT": batch.out})
    term = Term([batch.bin], env, os.path.join(ROOT, "proj"))
    stamp = ""
    problems = []
    done = 0
    try:
        term.pump(1.5)
        term.send("\r")
        end = time.time() + 25
        while time.time() < end and not any(r.get("event") == "SessionStart" for r in batch.rows(tag)):
            term.pump(0.1)
        if not wait_for_prompt(term):
            raise Stop("no prompt after start")
        stamp = process_stamp(term.pid)
        known = session_files(home)
        forks = []
        for number in range(1, switches + 1):
            # Two forks give the two sessions to alternate between. Files of sessions that were left empty can vanish.
            if number <= 2:
                type_slash(batch, term, tag, "/fork")
                end = time.time() + 10
                while time.time() < end and not session_files(home) - known:
                    term.pump(0.1)
                term.pump(1.5)
                forks.append(pick_fork(home, session_files(home) - known))
                known |= session_files(home)
                wait_for_prompt(term)
            target_id = forks[(number - 1) % 2]
            nav_keys, window = 0, (0, 0, 0)
            if batch.mode == "tree":
                type_slash(batch, term, tag, "/tree")
                end = time.time() + 10
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
            prompt_back = wait_for_prompt(term)
            same = process_stamp(term.pid) == stamp and stamp != ""
            batch.mark({"tag": tag, "n": number, "mode": batch.mode, "version": batch.version, "seqBefore": since, "seqAfter": after, "hooksArrived": arrived, "promptBack": prompt_back, "sameProcess": same, "navKeys": nav_keys, "treeWindow": list(window), "ms": int((time.time() - t0) * 1000)})
            if not arrived:
                raise Stop("no SessionStart and SessionEnd pair after switch %d" % number)
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
