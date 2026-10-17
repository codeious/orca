#!/usr/bin/env python3
"""Crude text render of a raw PTY capture: strip escapes, keep printable lines. usage: render_screen.py <file> [tail-lines]"""
import re, sys
raw = open(sys.argv[1], 'rb').read().decode('utf-8', 'replace')
raw = re.sub(r'\x1b\[[0-9;?]*[ -/]*[@-~]', '\n', raw)
raw = re.sub(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)', '', raw)
raw = re.sub(r'\x1b[()][A-Za-z0-9]', '', raw)
raw = raw.replace('\r', '\n')
raw = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', raw)
lines, last = [], None
for l in raw.split('\n'):
    l = l.strip()
    if not l or l == last:
        continue
    lines.append(l); last = l
n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
print('\n'.join(lines[-n:]))
