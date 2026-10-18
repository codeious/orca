#!/usr/bin/env python3
"""Hook timeout check. Prints, per capture, what happened to each SessionStart hook and when SessionEnd was launched.
Counts and milliseconds only.

usage: timeout_check.py <out-dir> [<out-dir>...]
       timeout_check.py --fixtures <slow-start-lifecycle.jsonl> <slow-start-hooks.jsonl>

Joins hook-lifecycle.jsonl (written by the hook command itself, so it survives a kill) with hooks.jsonl (the listener).
The first SessionStart launch of a process is its startup hook; the rest are one per switch. For each: how long it ran
before a signal, whether its post arrived, and how long after its launch the next SessionEnd hook was launched.
"""
import json, statistics, sys


def load(path):
    try:
        with open(path) as handle:
            return [json.loads(line) for line in handle if line.strip()]
    except FileNotFoundError:
        return []


def stats(values):
    if not values:
        return None
    return {"n": len(values), "min": round(min(values)), "median": round(statistics.median(values)), "max": round(max(values))}


def summarize(name, life, hooks):
    posted = {(r.get("tag"), r.get("launchNs")) for r in hooks if r.get("event") == "SessionStart"}
    tags = sorted({r["tag"] for r in life})
    out = {"capture": name, "processes": len(tags), "startupHooks": 0, "startupSignalled": 0, "startupRanMs": [],
           "switchStartHooks": 0, "switchSignalled": 0, "switchPosted": 0, "switchRanMsBeforeSignal": [],
           "endLaunchGapMs": [], "endLaunchedBeforeDelayElapsed": 0, "signals": {}}
    for tag in tags:
        rows = [r for r in life if r["tag"] == tag]
        launches = sorted((r for r in rows if r["stage"] == "launch"), key=lambda r: r["launchNs"])
        starts = [r for r in launches if r["event"] == "SessionStart"]
        ends = [r for r in launches if r["event"] == "SessionEnd"]
        for index, row in enumerate(starts):
            startup = index == 0
            after = [r for r in rows if r["launchNs"] == row["launchNs"] and r["stage"] != "launch"]
            sig = [r for r in after if r["stage"].startswith("signal")]
            for r in sig:
                out["signals"][r["stage"]] = out["signals"].get(r["stage"], 0) + 1
            ran = (sig[0]["ns"] - row["launchNs"]) / 1e6 if sig else None
            if startup:
                out["startupHooks"] += 1
                out["startupSignalled"] += 1 if sig else 0
                if ran is not None:
                    out["startupRanMs"].append(ran)
                continue
            out["switchStartHooks"] += 1
            out["switchSignalled"] += 1 if sig else 0
            out["switchPosted"] += 1 if (tag, row["launchNs"]) in posted else 0
            if ran is not None:
                out["switchRanMsBeforeSignal"].append(ran)
            nxt = next((e for e in ends if e["launchNs"] > row["launchNs"]), None)
            if nxt is not None:
                gap = (nxt["launchNs"] - row["launchNs"]) / 1e6
                out["endLaunchGapMs"].append(gap)
                if row["delayMs"] and gap < row["delayMs"]:
                    out["endLaunchedBeforeDelayElapsed"] += 1
    for key in ("startupRanMs", "switchRanMsBeforeSignal", "endLaunchGapMs"):
        out[key] = stats(out[key])
    return out


def main(argv):
    if argv and argv[0] == "--fixtures":
        life, hooks = load(argv[1]), load(argv[2])
        for name in sorted({r["capture"] for r in life}):
            print(json.dumps(summarize(name, [r for r in life if r["capture"] == name], [r for r in hooks if r["capture"] == name])))
        return
    for directory in argv:
        print(json.dumps(summarize(directory.rstrip("/").split("/")[-1], load(directory + "/hook-lifecycle.jsonl"), load(directory + "/hooks.jsonl"))))


if __name__ == "__main__":
    main(sys.argv[1:])
