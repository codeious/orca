#!/usr/bin/env python3
"""Print listener records in arrival order. usage: render.py <hooks.jsonl> [tag-prefix]"""
import json, sys

path = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else ""
rows = [json.loads(line) for line in open(path) if line.strip()]
if prefix:
    rows = [row for row in rows if str(row.get("tag", "")).startswith(prefix)]
rows.sort(key=lambda row: (row.get("seq", 10**9), row.get("arrivalNs", 0)))
base = next((row["arrivalNs"] for row in rows if "arrivalNs" in row), 0)
for row in rows:
    delta = (row.get("arrivalNs", base) - base) / 1e9
    ids = row.get("ids", {})
    extra = " ".join("%s=%s" % (name, row[name]) for name in ("source", "reason") if name in row)
    print("%4s %+8.3fs %-16s S=%-12s calling=%-12s prev=%-12s proc=%s %s" % (
        row.get("seq", ""), delta, row.get("event", row.get("kind")),
        ids.get("session_id", ""), ids.get("calling_session_id", ""), ids.get("previous_session_id", ""),
        row.get("process", ""), extra))
