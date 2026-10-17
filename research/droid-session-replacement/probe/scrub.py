#!/usr/bin/env python3
"""Fail if any file under the given roots contains the placeholder, the account name, or a home prefix.

Prints only the relative path and the word hit. Does not print the matching line.
usage: scrub.py <dir> [<dir>...]
"""
import os, sys

FORBIDDEN = ("fk-" + "invalid-000000", "no" + "ter", "/Us" + "ers/")
roots = sys.argv[1:]
failed = False
for root in roots:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name != ".git"]
        for name in filenames:
            path = os.path.join(dirpath, name)
            try:
                text = open(path, "rb").read().decode("utf-8", "replace")
            except OSError:
                continue
            if any(bad in text for bad in FORBIDDEN):
                print("hit %s" % os.path.relpath(path, root))
                failed = True
if failed:
    sys.exit(1)
print("clean")
