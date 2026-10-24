#!/usr/bin/env python3
"""Run a command under a PTY and record WHEN output arrives, for a quiescence/idle analysis.
usage: pty-timing-drive.py <out-prefix> <duration-s> <cols> <rows> <cwd> [--send MS:TEXT]... -- cmd args...
Writes <prefix>.raw (bytes as the terminal received them), <prefix>.timing.jsonl ({t,off,n} per read, ms since spawn),
<prefix>.procs.jsonl (command names of the shell's descendants every 2 s) and <prefix>.end.json.
TEXT escapes: \\r \\n \\x03. Env is inherited."""
import fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time

argv = sys.argv[1:]
prefix, duration, cols, rows, cwd = argv[0], float(argv[1]), int(argv[2]), int(argv[3]), argv[4]
rest = argv[5:]
sends, cmd = [], []
i = 0
while i < len(rest):
    if rest[i] == '--send':
        ms, text = rest[i + 1].split(':', 1)
        sends.append((int(ms) / 1000.0, text.replace('\\r', '\r').replace('\\n', '\n').replace('\\x03', '\x03').encode()))
        i += 2
    elif rest[i] == '--':
        cmd = rest[i + 1:]
        break
    else:
        i += 1
sends.sort()


def descendants(root):
    rows_ = subprocess.run(['/bin/ps', '-A', '-o', 'pid=,ppid=,comm='], capture_output=True, text=True).stdout.splitlines()
    kids, info = {}, {}
    for r in rows_:
        parts = r.split(None, 2)
        if len(parts) < 3:
            continue
        p, pp = int(parts[0]), int(parts[1])
        kids.setdefault(pp, []).append(p)
        info[p] = parts[2].strip().split('/')[-1]
    out, queue = [], list(kids.get(root, []))
    while queue:
        p = queue.pop(0)
        out.append(info[p])
        queue.extend(kids.get(p, []))
    return out


pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(cmd[0], cmd, dict(os.environ, TERM='xterm-256color'))
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
t0 = time.time()
raw = bytearray()
timing = open(prefix + '.timing.jsonl', 'w')
procs = open(prefix + '.procs.jsonl', 'w')
sent, next_probe, eof_at = 0, 0.0, None
while True:
    now = time.time() - t0
    if now >= duration:
        break
    while sent < len(sends) and now >= sends[sent][0]:
        os.write(fd, sends[sent][1])
        timing.write(json.dumps({'t': int(now * 1000), 'sent': sends[sent][1].decode('utf-8', 'replace')}) + '\n')
        sent += 1
    if now >= next_probe:
        procs.write(json.dumps({'t': int(now * 1000), 'descendants': descendants(pid)}) + '\n')
        next_probe = now + 2.0
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            eof_at = int((time.time() - t0) * 1000)
            break
        if not data:
            eof_at = int((time.time() - t0) * 1000)
            break
        timing.write(json.dumps({'t': int((time.time() - t0) * 1000), 'off': len(raw), 'n': len(data)}) + '\n')
        raw += data
timing.close()
procs.close()
open(prefix + '.raw', 'wb').write(bytes(raw))
alive = descendants(pid)
try:
    os.close(fd)
except OSError:
    pass
time.sleep(0.3)
try:
    os.killpg(pid, signal.SIGKILL)
except (ProcessLookupError, PermissionError):
    pass
json.dump({'duration_ms': int(duration * 1000), 'bytes': len(raw), 'pty_eof_ms': eof_at, 'descendants_at_end': alive}, open(prefix + '.end.json', 'w'))
