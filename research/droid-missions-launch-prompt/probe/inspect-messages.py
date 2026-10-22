#!/usr/bin/env python3
"""Per session in a throwaway HOME: shape of each transcript record (never its text) and numeric token/time counters.
For user messages: content item types, text length, and booleans for 'starts with /' and 'equals /missions'.
usage: inspect-messages.py <label>"""
import glob, json, os, re

home = '/tmp/droid-41/home-' + __import__('sys').argv[1]
SAFE = re.compile(r'^[A-Za-z0-9_.:-]{1,40}$')


def safe(v):
    return v if isinstance(v, str) and SAFE.match(v) else type(v).__name__


def numbers(d):
    if not isinstance(d, dict):
        return d if isinstance(d, (int, float)) else None
    return {k: numbers(v) for k, v in d.items() if isinstance(v, (int, float, dict))}


for f in sorted(glob.glob(home + '/.factory/sessions/*/*.jsonl'), key=os.path.getmtime):
    print('session', os.path.basename(f)[:8])
    for i, line in enumerate(open(f)):
        rec = json.loads(line)
        out = {'n': i, 'type': safe(rec.get('type')), 'keys': sorted(rec.keys())}
        msg = rec.get('message')
        if isinstance(msg, dict):
            out['msgKeys'] = sorted(msg.keys())
            out['role'] = safe(msg.get('role'))
            if 'hookEventName' in msg:
                out['hook'] = [safe(msg.get('hookEventName')), safe(msg.get('hookStatus'))]
            content = msg.get('content')
            if isinstance(content, list):
                out['content'] = [{'type': safe(c.get('type')), 'len': len(c.get('text', '')) if isinstance(c.get('text'), str) else None,
                                   'startsWithSlash': c.get('text', '').lstrip().startswith('/') if isinstance(c.get('text'), str) else None,
                                   'equalsMissions': c.get('text', '').strip() == '/missions' if isinstance(c.get('text'), str) else None,
                                   'startsWithAngle': c.get('text', '').lstrip().startswith('<') if isinstance(c.get('text'), str) else None}
                                  for c in content if isinstance(c, dict)]
            elif isinstance(content, str):
                out['content'] = {'str': True, 'len': len(content), 'startsWithSlash': content.lstrip().startswith('/'),
                                  'equalsMissions': content.strip() == '/missions'}
        for k in ('messageType', 'visibility', 'source'):
            if k in rec:
                out[k] = safe(rec[k])
        print(' ', json.dumps(out))
    side = f[:-6] + '.settings.json'
    st = json.load(open(side)) if os.path.exists(side) else {}
    print('  counters', json.dumps({k: numbers(st.get(k)) for k in ('tokenUsage', 'inclusiveTokenUsage', 'assistantActiveTimeMs', 'childInclusiveTokenUsageBySessionId') if k in st}))
