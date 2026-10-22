#!/usr/bin/env python3
"""On-disk shape of a throwaway HOME after a run. Prints key names, interactionMode, tag names, record-type counts,
and top-level file NAMES under .factory. Never prints message content, ids, or paths. usage: inspect.py <label>"""
import glob, json, os, re, sys
from collections import Counter

home = '/tmp/droid-41/home-' + sys.argv[1]
fac = home + '/.factory'
SAFE = re.compile(r'^[A-Za-z0-9_.:-]{1,40}$')


def safe(v):
    return v if isinstance(v, str) and SAFE.match(v) else type(v).__name__


names = sorted(os.listdir(fac)) if os.path.isdir(fac) else []
print(json.dumps({'factoryTopLevel': names, 'authLike': [n for n in names if n.startswith('auth')],
                  'missionsDirEntries': len(os.listdir(fac + '/missions')) if os.path.isdir(fac + '/missions') else 0}))

files = sorted(glob.glob(fac + '/sessions/*/*.jsonl'), key=os.path.getmtime)
stray = sorted(os.path.basename(p) for p in glob.glob(fac + '/sessions/*.settings.json'))
for i, f in enumerate(files):
    side = f[:-6] + '.settings.json'
    st = json.load(open(side)) if os.path.exists(side) else {}
    types = Counter()
    for line in open(f):
        try:
            rec = json.loads(line)
        except ValueError:
            types['unparsed'] += 1
            continue
        t = rec.get('type')
        role = (rec.get('message') or {}).get('role') if isinstance(rec.get('message'), dict) else None
        types[safe(t) + ('/' + safe(role) if role else '')] += 1
    tags = [(t.get('name'), sorted((t.get('metadata') or {}).keys())) for t in st.get('tags', [])]
    scalars = {k: safe(v) for k, v in st.items()
               if k in ('interactionMode', 'autonomyMode', 'autonomyLevel', 'reasoningEffort') or 'utonomy' in k}
    print(json.dumps({'session': 'F%d' % (i + 1), 'idPrefix': os.path.basename(f)[:8], 'recordTypes': dict(types),
                      'sidecarKeys': sorted(st.keys()), 'scalars': scalars, 'tags': tags}))
if stray:
    print(json.dumps({'strayTopLevelSidecars': len(stray)}))
