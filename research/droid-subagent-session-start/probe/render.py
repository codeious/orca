#!/usr/bin/env python3
"""Print hooks.jsonl as a compact timeline. usage: render.py <hooks.jsonl> <tag-prefix>"""
import json, sys

path, prefix = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in open(path) if l.strip()]
rows = [r for r in rows if r.get('tag', '').startswith(prefix)]
t0 = next((r['ts'] for r in rows if r['kind'] == 'hook'), 0)
for r in rows:
    if r['kind'] == 'tui':
        print('        tui  %-14s pid=%s alive=%s kids=%s' % (r['stage'], r['pid'], r['alive'], ','.join(d['comm'] for d in r['descendants'])))
        continue
    ids = r.get('ids', {})
    extra = ' '.join('%s=%s' % (k, r[k]) for k in ('source', 'reason', 'tool_name', 'agent_type') if k in r)
    drop = r['droid']['pid'] if r.get('droid') else None
    print('%+6.1fs %-17s sid=%-8s S=%-10s calling=%-10s prev=%-10s droid=%s pane=%s %s' % (
        (r['ts'] - t0) / 1000.0, r['event'], r.get('sessionPrefix', ''), ids.get('session_id', ''),
        ids.get('calling_session_id', ''), ids.get('previous_session_id', ''), drop, r.get('paneKeyPresent'), extra))
