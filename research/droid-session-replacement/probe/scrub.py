#!/usr/bin/env python3
"""Fail if added files contain the placeholder, the account name, a home prefix, or the key value.

Prints only a count of hits, never the matching text. Set KEY_FILE to the key file so the value is checked.
usage: scrub.py <dir> [<dir>...]
"""
import os, sys

FORBIDDEN = ["fk-" + "invalid-000000", "no" + "ter", "/Us" + "ers/"]


def key_value():
    path = os.environ.get("KEY_FILE", "")
    if not path:
        return ""
    with open(path) as handle:
        for raw in handle:
            line = raw.strip()
            if line.startswith("export "):
                line = line[len("export "):]
            if line.startswith("FACTORY_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return ""


secret = key_value()
if secret:
    FORBIDDEN.append(secret)
roots = sys.argv[1:]
hits = 0
for root in roots:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in (".git", "__pycache__")]
        for name in filenames:
            path = os.path.join(dirpath, name)
            try:
                text = open(path, "rb").read().decode("utf-8", "replace")
            except OSError:
                continue
            if any(bad and bad in text for bad in FORBIDDEN):
                hits += 1
if hits:
    print("hits %d" % hits)
    sys.exit(1)
print("clean")
