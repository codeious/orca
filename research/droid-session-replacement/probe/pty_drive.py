#!/usr/bin/env python3
"""Run a command under a PTY and send timed keystrokes. usage: pty_drive.py <out-file> <duration-s> <cwd> [--send MS:TEXT]... -- cmd"""
import os, pty, sys, time, select, fcntl, termios, struct, signal

argv = sys.argv[1:]
out_path, duration, cwd = argv[0], float(argv[1]), argv[2]
rest = argv[3:]
sends, cmd = [], []
i = 0
while i < len(rest):
    if rest[i] == "--send":
        ms, text = rest[i + 1].split(":", 1)
        text = text.encode().decode("unicode_escape").replace("\\e", "\x1b")
        sends.append((int(ms) / 1000.0, text.encode()))
        i += 2
    elif rest[i] == "--":
        cmd = rest[i + 1 :]
        break
    else:
        i += 1
sends.sort()

pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(cmd[0], cmd, os.environ)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
t0 = time.time()
buf = bytearray()
sent = 0
exited = False
while time.time() - t0 < duration:
    now = time.time() - t0
    while sent < len(sends) and now >= sends[sent][0]:
        try:
            os.write(fd, sends[sent][1])
        except OSError:
            exited = True
            break
        sent += 1
    if exited:
        break
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            exited = True
            break
        if not data:
            exited = True
            break
        buf += data
open(out_path, "wb").write(bytes(buf))
if not exited:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
deadline = time.time() + 6
while time.time() < deadline:
    try:
        done, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        status = None
        break
    if done:
        break
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            os.read(fd, 65536)
        except OSError:
            pass
else:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        _, status = os.waitpid(pid, 0)
    except ChildProcessError:
        status = None
print("exited_on_its_own=%s bytes=%s status=%s" % (exited, len(buf), status))
