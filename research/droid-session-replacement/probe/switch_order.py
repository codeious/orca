#!/usr/bin/env python3
"""Per-switch arrival order from the listener's seq. Prints counts only.

usage: switch_order.py <out-dir> [<out-dir>...]
       switch_order.py --fixtures <tree-resume-hooks.jsonl> <tree-resume-switches.jsonl>

Reads hooks.jsonl and switches.jsonl written by tree_resume_switches.py (or the committed combined fixtures, split by
their `capture` field). For each switch it takes the rows whose seq falls between the markers and checks them against
one SessionStart (resume) and one SessionEnd (other).
"""
import json, statistics, sys


def rel(value):
    return (value or "absent").replace(" (new)", "")


def load(path):
    with open(path) as handle:
        return [json.loads(line) for line in handle if line.strip()]


def summarize(name, hooks, markers):
    tags = sorted({m["tag"] for m in markers})
    result = {"capture": name, "processes": len(tags), "switches": 0, "exactPair": 0, "endBeforeStart": 0,
              "clear": 0, "extraRows": 0, "processChanged": 0, "newSessionNotStartedOnce": 0, "startPreviousIsOld": 0,
              "sessionsWithMoreThanOnePreviousId": 0, "callingPresent": 0, "promptBack": 0, "exitRowsOk": 0,
              "nonSessionHooks": sum(1 for r in hooks if r.get("kind") != "hook" or r.get("event") not in ("SessionStart", "SessionEnd")),
              "arrivalClockBackwards": 0, "gapMs": [], "launchGapMs": [], "startHookMs": [],
              "endLaunchedBeforeStartPosted": 0, "withLaunchStamps": 0}
    for tag in tags:
        rows = sorted((r for r in hooks if r.get("tag") == tag), key=lambda r: r["seq"])
        if not all(a["arrivalNs"] <= b["arrivalNs"] for a, b in zip(rows, rows[1:])):
            result["arrivalClockBackwards"] += 1
        procs = {rel(r.get("process")) for r in rows}
        if len(procs) != 1 or "absent" in procs:
            result["processChanged"] += 1
        startup = next((r for r in rows if r["event"] == "SessionStart"), None)
        if startup is None:
            # Timeout captures: the start hook was killed before it posted, so there is no order to count.
            result["processesWithoutStartRow"] = result.get("processesWithoutStartRow", 0) + 1
            continue
        current = rel(startup["ids"]["session_id"])
        last_after = startup["seq"]
        previous_by_session = {}
        for r in rows:
            if r["event"] == "SessionStart" and r.get("source") == "resume":
                previous_by_session.setdefault(rel(r["ids"]["session_id"]), set()).add(rel(r["ids"].get("previous_session_id")))
        result["sessionsWithMoreThanOnePreviousId"] += sum(1 for v in previous_by_session.values() if len(v) > 1)
        for m in (m for m in markers if m["tag"] == tag and isinstance(m["n"], int)):
            result["switches"] += 1
            window = [r for r in rows if m["seqBefore"] < r["seq"] <= m["seqAfter"]]
            starts = [r for r in window if r["event"] == "SessionStart"]
            ends = [r for r in window if r["event"] == "SessionEnd"]
            result["clear"] += sum(1 for r in ends if r.get("reason") == "clear")
            result["promptBack"] += 1 if m.get("promptBack") else 0
            if not m.get("sameProcess"):
                result["processChanged"] += 1
            if len(window) != 2 or len(starts) != 1 or len(ends) != 1:
                result["extraRows"] += 1
                continue
            start, end = starts[0], ends[0]
            if start.get("source") != "resume" or end.get("reason") != "other":
                result["extraRows"] += 1
                continue
            result["exactPair"] += 1
            if end["seq"] < start["seq"]:
                result["endBeforeStart"] += 1
            # The ended session must be the one the pane was on, and the started one must be a different session.
            if rel(end["ids"]["session_id"]) != current or rel(start["ids"]["session_id"]) == current:
                result["newSessionNotStartedOnce"] += 1
            if rel(start["ids"].get("previous_session_id")) == current:
                result["startPreviousIsOld"] += 1
            if rel(start["ids"].get("calling_session_id")) != "absent":
                result["callingPresent"] += 1
            result["gapMs"].append((end["arrivalNs"] - start["arrivalNs"]) / 1e6)
            if "launchNs" in start and "launchNs" in end and "arrivalWallNs" in start:
                result["withLaunchStamps"] += 1
                result["launchGapMs"].append((end["launchNs"] - start["launchNs"]) / 1e6)
                result["startHookMs"].append((start["arrivalWallNs"] - start["launchNs"]) / 1e6)
                if end["launchNs"] < start["arrivalWallNs"]:
                    result["endLaunchedBeforeStartPosted"] += 1
            current = rel(start["ids"]["session_id"])
            last_after = m["seqAfter"]
        tail = [r for r in rows if r["seq"] > last_after]
        if len(tail) == 1 and tail[0]["event"] == "SessionEnd" and tail[0].get("reason") == "other" and rel(tail[0]["ids"]["session_id"]) == current:
            result["exitRowsOk"] += 1
    for key in ("launchGapMs", "startHookMs"):
        values = result.pop(key)
        if values:
            result[key + "Min"] = round(min(values))
            result[key + "Median"] = round(statistics.median(values))
            result[key + "Max"] = round(max(values))
    gaps = result.pop("gapMs")
    if gaps:
        result["gapMsMin"] = round(min(gaps), 1)
        result["gapMsMedian"] = round(statistics.median(gaps), 1)
        result["gapMsMax"] = round(max(gaps), 1)
    return result


def main(argv):
    if argv and argv[0] == "--fixtures":
        hooks, markers = load(argv[1]), load(argv[2])
        for name in sorted({r["capture"] for r in markers}):
            print(json.dumps(summarize(name, [r for r in hooks if r["capture"] == name], [m for m in markers if m["capture"] == name])))
        return
    for directory in argv:
        print(json.dumps(summarize(directory.rstrip("/").split("/")[-1], load(directory + "/hooks.jsonl"), load(directory + "/switches.jsonl"))))


if __name__ == "__main__":
    main(sys.argv[1:])
