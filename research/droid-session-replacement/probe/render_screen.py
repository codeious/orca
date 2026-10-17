#!/usr/bin/env python3
"""Plain last lines of a raw PTY capture. Drops escapes and uuid-shaped ids. usage: render_screen.py <file> [tail]"""
import re, sys

raw = open(sys.argv[1], "rb").read().decode("utf-8", "replace")
raw = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "\n", raw)
raw = re.sub(r"\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", raw)
raw = re.sub(r"\x1b[()][A-Za-z0-9]", "", raw)
raw = raw.replace("\r", "\n")
raw = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<uuid>", raw)
lines, last = [], None
for line in raw.split("\n"):
    line = line.strip()
    if not line or line == last:
        continue
    lines.append(line)
    last = line
count = int(sys.argv[2]) if len(sys.argv) > 2 else 40
print("\n".join(lines[-count:]))
