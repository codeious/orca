#!/usr/bin/env python3
"""One row per run: what fired, what the screen showed, and the session's on-disk shape. Shapes and counters only."""
import glob, json, os, re

OUT = '/tmp/droid-41/out'
RUNS = [(v, kind, 'a%s' % v if kind == 'auto' else 's%s' % v, '%s%s-%s' % ('a' if kind == 'auto' else 's', v, kind)) for v in ('238', '245', '247') for kind in ('plain', 'auto', 'resume')]
VERSION = {'238': '0.238.0', '245': '0.245.0', '247': '0.247.0'}
ARGS = {'plain': 'droid "/missions"', 'auto': 'droid --auto low "/missions"', 'resume': 'droid resume <id> "/missions"'}


def screen(path):
    raw = open(path, 'rb').read().decode('utf-8', 'replace')
    raw = re.sub(r'\x1b\[[0-9;?]*[ -/]*[@-~]', '\n', raw)
    raw = re.sub(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)', '', raw).replace('\r', '\n')
    return raw


rows = []
for v, kind, home, tag in RUNS:
    hooks = [json.loads(l) for l in open('%s/%s/hooks.jsonl' % (OUT, tag))]
    ev = [h.get('event') + ('/' + h.get('source', h.get('reason', ''))) for h in hooks if h.get('kind') == 'hook']
    marks = [h['stage'] for h in hooks if h.get('kind') == 'tui']
    text = screen('%s/%s.pty' % (OUT, tag))
    fac = '/tmp/droid-41/home-%s/.factory' % home
    sids = sorted(glob.glob(fac + '/sessions/*/*.jsonl'))
    st = json.load(open(sids[0][:-6] + '.settings.json'))
    tu = st.get('inclusiveTokenUsage', {})
    rows.append({
        'version': VERSION[v], 'invocation': ARGS[kind],
        'trustDialogSeen': 'Trust this folder?' in text, 'enterSentOnTrust': 'when-sent' in marks,
        'hooks': ev, 'userPromptSubmit': any(e.startswith('UserPromptSubmit') for e in ev),
        'pickerShown': 'Begin new mission' in text and 'Missions' in text,
        'loginGate': 'Please login' in text or 'Authentication failed' in text,
        'interactionMode': st.get('interactionMode'), 'autonomyLevel': st.get('autonomyLevel'), 'autonomyMode': st.get('autonomyMode'),
        'tags': len(st.get('tags', [])),
        'tokens': sum(v for k, v in tu.items() if k.endswith('Tokens') and isinstance(v, (int, float))),
        'credits': tu.get('factoryCredits'), 'assistantActiveTimeMs': st.get('assistantActiveTimeMs'),
        'sessionFilesInHome': len(sids),
        'authFiles': [n for n in os.listdir(fac) if n.startswith('auth')],
        'missionsDirEntries': len(os.listdir(fac + '/missions')) if os.path.isdir(fac + '/missions') else 0,
    })

for r in rows:
    print(json.dumps(r))
print()
print('ANY userPromptSubmit:', any(r['userPromptSubmit'] for r in rows))
print('ALL pickerShown:', all(r['pickerShown'] for r in rows))
print('ANY loginGate:', any(r['loginGate'] for r in rows))
print('ALL interactionMode auto:', all(r['interactionMode'] == 'auto' for r in rows), '| ANY tags:', any(r['tags'] for r in rows))
print('ALL tokens 0 and credits 0:', all(r['tokens'] == 0 and r['credits'] == 0 and r['assistantActiveTimeMs'] == 0 for r in rows))
print('ANY authFiles:', any(r['authFiles'] for r in rows), '| ANY missions dir entries:', any(r['missionsDirEntries'] for r in rows))
