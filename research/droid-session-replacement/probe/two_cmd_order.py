#!/usr/bin/env python3
"""Two SessionStart commands. Counts only. Does not launch Droid or read a key.

usage: two_cmd_order.py <out-dir> [<out-dir>...]
       two_cmd_order.py --fixtures <hooks.jsonl> <switches.jsonl>

Order is the listener seq, not log-line order. Launch times are the hook's launchNs
(wall clock at process start, carried on the post). Launch gap is fast minus slow.
Together: absolute gap <= 100 ms. Sequential: absolute gap >= 500 ms. Otherwise close.
The ~10 s wait is labeled only when the launches are sequential, because a shared clock
and a per-command clock look the same when both commands start together:
  per-command — SessionEnd launches ~10 s after the later command
  per-event   — SessionEnd launches ~10 s after the earlier command, and not ~10 s after the later one
Otherwise the wait label is indistinguishable.
fastAfterEnd counts a switch only when that window has one fast SessionStart and one SessionEnd other.
"""
import json, statistics, sys

TOGETHER_MS = 100
SEQUENTIAL_MS = 500
CAP_LO = 9000
CAP_HI = 11500


def load(path):
    with open(path) as handle:
        return [json.loads(line) for line in handle if line.strip()]


def about_cap(ms):
    return CAP_LO <= ms <= CAP_HI


def classify(slow_launch_ns, fast_launch_ns, end_launch_ns):
    slow = slow_launch_ns / 1e6
    fast = fast_launch_ns / 1e6
    end = end_launch_ns / 1e6
    gap = fast - slow
    first = min(slow, fast)
    second = max(slow, fast)
    end_first = end - first
    end_second = end - second
    if abs(gap) <= TOGETHER_MS:
        launch = "parallel"
    elif abs(gap) >= SEQUENTIAL_MS:
        launch = "sequential"
    else:
        launch = "close"
    if launch != "sequential":
        wait = "indistinguishable"
    elif about_cap(end_second) and not about_cap(end_first):
        wait = "per-command"
    elif about_cap(end_first) and end_second < CAP_LO:
        wait = "per-event"
    else:
        wait = "other"
    return launch, wait


def ints(value):
    return type(value) is int


def bounds(name, values, places):
    if not values:
        return {}
    mid = statistics.median(values)
    if places:
        return {name + "Min": round(min(values), places), name + "Median": round(mid, places), name + "Max": round(max(values), places)}
    return {name + "Min": round(min(values)), name + "Median": round(mid), name + "Max": round(max(values))}


def agreed(values):
    chosen = set(values)
    if not chosen:
        return "none"
    if len(chosen) == 1:
        return values[0]
    return "mixed"


def field(markers, key):
    found = []
    for marker in markers:
        if key in marker and marker[key] not in found:
            found.append(marker[key])
    if not found:
        return ""
    if len(found) == 1:
        return found[0]
    return "mixed"


def summarize(name, hooks, markers):
    switches = [m for m in markers if isinstance(m.get("n"), int)]
    by_tag = {}
    for row in hooks:
        by_tag.setdefault(row.get("tag"), []).append(row)
    for rows in by_tag.values():
        rows.sort(key=lambda row: row.get("seq", 0))
    out = {
        "capture": name,
        "version": field(switches, "version"),
        "command": field(switches, "mode"),
        "place": field(switches, "place"),
        "order": field(switches, "order"),
        "slowMs": field(switches, "slowMs"),
        "fastMs": field(switches, "fastMs"),
        "switches": len(switches),
        "exactTriple": 0,
        "exactPair": 0,
        "fastAfterEnd": 0,
        "ranAfterEnd": 0,
        "extraRows": 0,
        "hooksCmd": field(switches, "hooksCmd"),
        "sameProcess": sum(1 for m in switches if m.get("sameProcess") is True),
        "processChanged": sum(1 for m in switches if m.get("sameProcess") is not True),
    }
    launch_votes, wait_votes = [], []
    launch_gap, end_slow, end_fast, arr_slow, arr_fast = [], [], [], [], []
    for marker in switches:
        window = [row for row in by_tag.get(marker.get("tag"), []) if marker["seqBefore"] < row.get("seq", 0) <= marker["seqAfter"]]
        slow = [row for row in window if row.get("event") == "SessionStart" and row.get("cmd") == "slow" and row.get("source") == "resume"]
        fast = [row for row in window if row.get("event") == "SessionStart" and row.get("cmd") == "fast" and row.get("source") == "resume"]
        ends = [row for row in window if row.get("event") == "SessionEnd" and row.get("reason") == "other"]
        fast_any = [row for row in window if row.get("event") == "SessionStart" and row.get("cmd") == "fast"]
        if len(fast_any) == 1 and len(ends) == 1 and fast_any[0]["seq"] > ends[0]["seq"]:
            out["fastAfterEnd"] += 1
        if marker.get("check") == "replacement" or marker.get("place") == "split":
            hooks_cmd = marker.get("hooksCmd", "")
            starts = [row for row in window if row.get("event") == "SessionStart" and row.get("source") == "resume"]
            ran = [row for row in starts if row.get("cmd") == hooks_cmd] if hooks_cmd else starts
            if len(window) == 2 and len(starts) == 1 and len(ran) == 1 and len(ends) == 1:
                out["exactPair"] += 1
                one, end = ran[0], ends[0]
                if one["seq"] > end["seq"]:
                    out["ranAfterEnd"] += 1
                launch_votes.append("single")
                wait_votes.append("single")
                if ints(one.get("arrivalNs")) and ints(end.get("arrivalNs")):
                    gap = (end["arrivalNs"] - one["arrivalNs"]) / 1e6
                    (arr_fast if one.get("cmd") == "fast" else arr_slow).append(gap)
                if ints(one.get("launchNs")) and ints(end.get("launchNs")):
                    gap = (end["launchNs"] - one["launchNs"]) / 1e6
                    (end_fast if one.get("cmd") == "fast" else end_slow).append(gap)
            else:
                out["extraRows"] += 1
            continue
        exact = len(window) == 3 and len(slow) == 1 and len(fast) == 1 and len(ends) == 1
        if exact:
            out["exactTriple"] += 1
        else:
            out["extraRows"] += 1
            continue
        start, quick, end = slow[0], fast[0], ends[0]
        if ints(start.get("arrivalNs")) and ints(quick.get("arrivalNs")) and ints(end.get("arrivalNs")):
            arr_slow.append((end["arrivalNs"] - start["arrivalNs"]) / 1e6)
            arr_fast.append((end["arrivalNs"] - quick["arrivalNs"]) / 1e6)
        if not (ints(start.get("launchNs")) and ints(quick.get("launchNs")) and ints(end.get("launchNs"))):
            continue
        launch, wait = classify(start["launchNs"], quick["launchNs"], end["launchNs"])
        launch_votes.append(launch)
        wait_votes.append(wait)
        launch_gap.append((quick["launchNs"] - start["launchNs"]) / 1e6)
        end_slow.append((end["launchNs"] - start["launchNs"]) / 1e6)
        end_fast.append((end["launchNs"] - quick["launchNs"]) / 1e6)
    out["launch"] = agreed(launch_votes)
    out["wait"] = agreed(wait_votes)
    out.update(bounds("launchGapMs", launch_gap, 0))
    out.update(bounds("endFromSlowMs", end_slow, 0))
    out.update(bounds("endFromFastMs", end_fast, 0))
    out.update(bounds("arrivalGapSlowMs", arr_slow, 1))
    out.update(bounds("arrivalGapFastMs", arr_fast, 1))
    return out


def main(argv):
    if argv and argv[0] == "--fixtures":
        hooks, markers = load(argv[1]), load(argv[2])
        names = sorted({row["capture"] for row in markers})
        for name in names:
            print(json.dumps(summarize(name, [row for row in hooks if row.get("capture") == name], [row for row in markers if row.get("capture") == name])))
        return
    for directory in argv:
        print(json.dumps(summarize(directory.rstrip("/").split("/")[-1], load(directory + "/hooks.jsonl"), load(directory + "/switches.jsonl"))))


if __name__ == "__main__":
    main(sys.argv[1:])
