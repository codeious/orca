#!/usr/bin/env python3
"""Combine the out-switch-* captures of the slow-SessionStart runs into three committed fixture files.

usage: build_slow_start_fixtures.py <probe-root> <dest-dir> [prefix]

prefix defaults to slow-start. Pass two-cmd to write two-cmd-hooks.jsonl and the matching switch and lifecycle files.

Writes slow-start-hooks.jsonl, slow-start-switches.jsonl and slow-start-lifecycle.jsonl, each row tagged with `capture`.
Clock fields are rebased per capture (wall-clock ones to the capture's first stamp, the listener's monotonic one to its
first arrival), so only differences remain and no absolute time is committed. Smoke-test directories are not included.
"""
import glob, json, os, sys

HOOK_KEEP = ("kind", "seq", "tag", "event", "cmd", "keys", "source", "reason", "ids", "delayMs", "process")


def load(path):
    try:
        with open(path) as handle:
            return [json.loads(line) for line in handle if line.strip()]
    except FileNotFoundError:
        return []


def main(root, dest, prefix="slow-start"):
    hooks_out, switches_out, life_out = [], [], []
    for directory in sorted(glob.glob(os.path.join(root, "out-switch-*"))):
        name = os.path.basename(directory)[len("out-switch-"):]
        hooks = load(directory + "/hooks.jsonl")
        life = load(directory + "/hook-lifecycle.jsonl")
        switches = load(directory + "/switches.jsonl")
        if not hooks and not life:
            continue
        wall = [r["launchNs"] for r in hooks if "launchNs" in r] + [r["arrivalWallNs"] for r in hooks if "arrivalWallNs" in r]
        wall += [r["launchNs"] for r in life] + [r["ns"] for r in life]
        base_wall = min(wall)
        base_mono = min((r["arrivalNs"] for r in hooks), default=0)
        for r in hooks:
            row = {k: r[k] for k in HOOK_KEEP if k in r}
            row["arrivalNs"] = r["arrivalNs"] - base_mono
            if "arrivalWallNs" in r:
                row["arrivalWallNs"] = r["arrivalWallNs"] - base_wall
            if "launchNs" in r:
                row["launchNs"] = r["launchNs"] - base_wall
            row["capture"] = name
            hooks_out.append(row)
        for r in life:
            life_row = {"capture": name, "tag": r["tag"], "event": r["event"], "stage": r["stage"], "delayMs": r["delayMs"],
                        "ns": r["ns"] - base_wall, "launchNs": r["launchNs"] - base_wall}
            if "cmd" in r:
                life_row["cmd"] = r["cmd"]
            life_out.append(life_row)
        for m in switches:
            m = dict(m)
            m["capture"] = name
            switches_out.append(m)
    os.makedirs(dest, exist_ok=True)
    for filename, rows in (("%s-hooks.jsonl" % prefix, hooks_out), ("%s-switches.jsonl" % prefix, switches_out), ("%s-lifecycle.jsonl" % prefix, life_out)):
        with open(os.path.join(dest, filename), "w") as handle:
            for row in rows:
                handle.write(json.dumps(row, separators=(",", ":")) + "\n")
        print(filename, len(rows), "rows")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "slow-start")
