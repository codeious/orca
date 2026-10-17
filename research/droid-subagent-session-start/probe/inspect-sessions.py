#!/usr/bin/env python3
"""On-disk shape of each session in a throwaway HOME: KEY NAMES of the first transcript record and the settings sidecar,
the relation of callingSessionId / parent to the other sessions, tag names, and factoryCredits.
Never prints message content. usage: inspect-sessions.py <home-label>"""
import glob, json, os, re, sys

home = '/tmp/droid-32/home-' + sys.argv[1]
files = sorted(glob.glob(home + '/.factory/sessions/*/*.jsonl'), key=os.path.getmtime)
ids = {os.path.basename(f)[:-6]: 'F%d' % (i + 1) for i, f in enumerate(files)}


def rel(v):
    if v is None:
        return 'null'
    if v == '':
        return 'empty'
    return ids.get(v, 'unseen-id') if isinstance(v, str) else type(v).__name__


for f in files:
    sid = os.path.basename(f)[:-6]
    first = json.loads(open(f).readline())
    side = f[:-6] + '.settings.json'
    st = json.load(open(side)) if os.path.exists(side) else {}
    tags = [(t.get('name'), sorted((t.get('metadata') or {}).keys())) for t in st.get('tags', [])]
    cred = st.get('tokenUsage', {}) if isinstance(st.get('tokenUsage'), dict) else {}
    print(json.dumps({
        'file': ids[sid], 'idPrefix': sid[:8], 'records': sum(1 for _ in open(f)),
        'startKeys': sorted(first.keys()), 'startType': first.get('type'),
        'callingSessionId': rel(first.get('callingSessionId')) if 'callingSessionId' in first else 'absent',
        'callingToolUseId': 'present' if first.get('callingToolUseId') else 'absent',
        'parent': rel(first.get('parent')) if 'parent' in first else 'absent',
        'sidecarKeys': sorted(st.keys()),
        'sidecarCallingSessionId': rel(st.get('callingSessionId')) if 'callingSessionId' in st else 'absent',
        'tags': tags,
        'factoryCredits': st.get('factoryCredits', cred.get('factoryCredits')),
    }))
