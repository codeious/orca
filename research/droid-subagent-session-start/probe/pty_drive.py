#!/usr/bin/env python3
"""Run a command under a PTY, type timed input, record raw output, and log the process identity + descendants at marks.
usage: pty_drive.py <out-file> <duration-s> <cwd> [--send MS:TEXT]... [--mark MS:stage]... -- cmd args...
TEXT escapes: \\r \\n \\x03 (Ctrl-C) \\e. Env is inherited. Marks append {"kind":"tui",...} to $PROBE_OUT/hooks.jsonl (command basenames only)."""
import os, pty, sys, time, select, fcntl, termios, struct, signal, subprocess, json

argv = sys.argv[1:]
out_path, duration, cwd = argv[0], float(argv[1]), argv[2]
rest = argv[3:]
sends, marks, cmd = [], [], []
i = 0
while i < len(rest):
    if rest[i] == '--send':
        ms, text = rest[i + 1].split(':', 1)
        text = text.encode().decode('unicode_escape').replace('\\e', '\x1b')
        sends.append((int(ms) / 1000.0, text.encode()))
        i += 2
    elif rest[i] == '--mark':
        ms, stage = rest[i + 1].split(':', 1)
        marks.append((int(ms) / 1000.0, stage))
        i += 2
    elif rest[i] == '--':
        cmd = rest[i + 1:]
        break
    else:
        i += 1
sends.sort()
marks.sort()

hooks_log = os.path.join(os.environ.get('PROBE_OUT', '/tmp/droid-32/out'), 'hooks.jsonl')
tag = os.environ.get('PROBE_TAG', '')
ps_env = dict(os.environ, TZ='UTC0', LC_ALL='C')


def ps(pid, field):
    try:
        return subprocess.run(['/bin/ps', '-p', str(pid), '-o', field + '='], capture_output=True, text=True, env=ps_env).stdout.strip()
    except Exception:
        return ''


def descendants(root):
    rows = subprocess.run(['/bin/ps', '-A', '-o', 'pid=,ppid=,comm='], capture_output=True, text=True).stdout.splitlines()
    kids = {}
    info = {}
    for r in rows:
        parts = r.split(None, 2)
        if len(parts) < 3:
            continue
        p, pp, comm = int(parts[0]), int(parts[1]), parts[2].strip().split('/')[-1]
        kids.setdefault(pp, []).append(p)
        info[p] = (pp, comm)
    out, queue = [], list(kids.get(root, []))
    while queue:
        p = queue.pop(0)
        out.append({'pid': p, 'ppid': info[p][0], 'comm': info[p][1]})
        queue.extend(kids.get(p, []))
    return out


def mark(pid, stage):
    start = ps(pid, 'lstart')
    rec = {'kind': 'tui', 'tag': tag, 'stage': stage, 'pid': pid, 'start': start, 'ppid': ps(pid, 'ppid'),
           'comm': ps(pid, 'comm').split('/')[-1], 'alive': start != '', 'descendants': descendants(pid) if start else []}
    with open(hooks_log, 'a') as f:
        f.write(json.dumps(rec) + '\n')


pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    env = dict(os.environ, TERM='xterm-256color')
    os.execvpe(cmd[0], cmd, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
t0 = time.time()
buf = bytearray()
sent = 0
marked = 0
exited = False
while time.time() - t0 < duration:
    now = time.time() - t0
    while sent < len(sends) and now >= sends[sent][0]:
        os.write(fd, sends[sent][1]); sent += 1
    while marked < len(marks) and now >= marks[marked][0]:
        mark(pid, marks[marked][1]); marked += 1
    r, _, _ = select.select([fd], [], [], 0.1)
    if r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            exited = True; break
        if not data:
            exited = True; break
        buf += data
open(out_path, 'wb').write(bytes(buf))
mark(pid, 'at-end-of-drive')
status = None
fd_open = True
if not exited:
    if os.environ.get('END') == 'hup':
        os.close(fd)  # closing the master sends SIGHUP to the session, like closing a pane
        fd_open = False
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def reap(seconds):
    """Wait for the child, still draining the pty: an exiting tty process can block until its output is read."""
    end = time.time() + seconds
    while time.time() < end:
        try:
            done, st = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return True, None
        if done:
            return True, st
        if fd_open:
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                try:
                    os.read(fd, 65536)
                except OSError:
                    pass
        else:
            time.sleep(0.1)
    return False, None


reaped, status = reap(6)
if not reaped:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    reaped, status = reap(6)
time.sleep(0.3)
mark(pid, 'after-exit')
print(f'exited_on_its_own={exited} bytes={len(buf)} status={status}')
