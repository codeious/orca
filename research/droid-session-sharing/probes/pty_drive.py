#!/usr/bin/env python3
"""Run a command under a PTY, type timed input, record raw output.
usage: pty_drive.py <out-file> <duration-s> <cwd> [--send MS:TEXT]... -- cmd args...
TEXT escapes: \\r \\n \\x03 (Ctrl-C) \\e. Env is inherited."""
import os, pty, sys, time, select, fcntl, termios, struct, signal

argv = sys.argv[1:]
out_path, duration, cwd = argv[0], float(argv[1]), argv[2]
rest = argv[3:]
sends, cmd = [], []
i = 0
while i < len(rest):
    if rest[i] == '--send':
        ms, text = rest[i + 1].split(':', 1)
        text = text.encode().decode('unicode_escape').replace('\\e', '\x1b')
        sends.append((int(ms) / 1000.0, text.encode()))
        i += 2
    elif rest[i] == '--':
        cmd = rest[i + 1:]
        break
    else:
        i += 1
sends.sort()

pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    env = dict(os.environ, TERM='xterm-256color')
    os.execvpe(cmd[0], cmd, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
t0 = time.time()
buf = bytearray()
sent = 0
exited = False
while time.time() - t0 < duration:
    while sent < len(sends) and time.time() - t0 >= sends[sent][0]:
        os.write(fd, sends[sent][1]); sent += 1
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
status = None
if not exited:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
deadline = time.time() + 3
while time.time() < deadline:
    try:
        done, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        break
    if done:
        break
    time.sleep(0.1)
else:
    try:
        os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError):
        pass
print(f'exited_on_its_own={exited} bytes={len(buf)} status={status}')
