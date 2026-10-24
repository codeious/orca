#!/usr/bin/env python3
"""usage: analyze.py <out-dir> [--text]
Reads <out-dir>/run.raw + run.timing.jsonl. Prints: bytes per 1 s bucket, longest silent gap after the command was typed,
the time of the last output, every OSC title with the time it arrived, and (with --text) a crude text render."""
import json, re, sys

d = sys.argv[1]
show_text = '--text' in sys.argv
raw = open(d + '/run.raw', 'rb').read()
rows = [json.loads(l) for l in open(d + '/run.timing.jsonl')]
chunks = [r for r in rows if 'n' in r]
sends = [r for r in rows if 'sent' in r]
t_cmd = sends[0]['t'] if sends else 0


def time_at(offset):
    for c in chunks:
        if c['off'] <= offset < c['off'] + c['n']:
            return c['t']
    return None


end_ms = int(json.load(open(d + '/run.end.json'))['duration_ms'])
buckets = {}
for c in chunks:
    buckets[c['t'] // 1000] = buckets.get(c['t'] // 1000, 0) + c['n']
print('bytes per second (s:bytes):', ' '.join('%d:%d' % (s, buckets.get(s, 0)) for s in range(0, end_ms // 1000)))

after = [c for c in chunks if c['t'] >= t_cmd]
gaps = []
prev = t_cmd
for c in after:
    gaps.append((c['t'] - prev, prev, c['t']))
    prev = c['t']
gaps.append((end_ms - prev, prev, end_ms))
gaps.sort(reverse=True)
print('command typed at %d ms; chunks after it: %d; last output at %d ms; longest gaps (gap_ms, from, to): %s' % (
    t_cmd, len(after), prev if after else -1, gaps[:3]))

titles = []
for m in re.finditer(rb'\x1b\]([0-2]);([^\x07\x1b]*)(?:\x07|\x1b\\)', raw):
    titles.append((time_at(m.start()), m.group(1).decode(), m.group(2).decode('utf-8', 'replace')))
print('OSC titles (t_ms, kind, title):')
for t in titles:
    print('  ', t)

if show_text:
    s = raw.decode('utf-8', 'replace')
    s = re.sub(r'\x1b\[[0-9;?]*[ -/]*[@-~]', '\n', s)
    s = re.sub(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)', '', s)
    s = re.sub(r'\x1b[()][A-Za-z0-9]', '', s).replace('\r', '\n')
    out, last = [], None
    for l in s.split('\n'):
        l = l.strip()
        if l and l != last:
            out.append(l)
            last = l
    print('--- crude text (deduped lines) ---')
    print('\n'.join(out[-60:]))
