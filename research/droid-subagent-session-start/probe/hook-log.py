#!/usr/bin/env python3
"""Key-name hook logger for the Task-subagent / /new SessionStart probe.

Records, per hook: the event, the payload's top-level KEY NAMES, a few short allowlisted scalar values
(source, reason, tool_name, agent_type), the session id's 8-char prefix, and the RELATION between ids
(session_id / calling_session_id / previous_session_id become S1, S2, ... in order of first sight per run).
Also the ancestor process names, whether ORCA_PANE_KEY reached the hook, and FACTORY_*/DROID_* env var NAMES.
Never records prompts, tool input, messages, paths, or any other payload value.
"""
import fcntl, json, os, re, subprocess, sys, time

out_dir = os.environ.get('PROBE_OUT', '/tmp/droid-32/out')
tag = os.environ.get('PROBE_TAG', '')

raw = sys.stdin.read()
sys.stdout.write('{}\n')
sys.stdout.flush()

SAFE = re.compile(r'^[A-Za-z0-9_.:-]{1,40}$')
SCALAR_KEYS = ('hook_event_name', 'source', 'reason', 'tool_name', 'agent_type', 'notification_type')
ID_KEYS = ('session_id', 'calling_session_id', 'previous_session_id')


def safe(v):
    if isinstance(v, str):
        return v if SAFE.match(v) else '<other-string>'
    return type(v).__name__


try:
    payload = json.loads(raw)
except ValueError:
    payload = None

rec = {'kind': 'hook', 'tag': tag, 'ts': int(time.time() * 1000)}

if isinstance(payload, dict):
    rec['event'] = safe(payload.get('hook_event_name'))
    rec['keys'] = sorted(payload.keys())
    for k in SCALAR_KEYS[1:]:
        if k in payload:
            rec[k] = safe(payload[k])

    table_path = os.path.join(out_dir, 'ids-' + re.sub(r'[^A-Za-z0-9_.-]', '_', tag) + '.json')
    with open(table_path + '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            table = json.load(open(table_path))
        except (OSError, ValueError):
            table = {}
        rels = {}
        for k in ID_KEYS:
            if k not in payload:
                rels[k] = 'absent'
                continue
            v = payload[k]
            if v is None:
                rels[k] = 'null'
            elif v == '':
                rels[k] = 'empty'
            elif not isinstance(v, str):
                rels[k] = type(v).__name__
            else:
                known = v in table
                if not known:
                    table[v] = 'S%d' % (len(table) + 1)
                rels[k] = table[v] + ('' if known else ' (new)')
                if k == 'session_id':
                    rec['sessionPrefix'] = v[:8]
        json.dump(table, open(table_path, 'w'))
    rec['ids'] = rels
else:
    rec['event'] = 'unparsed'

env = os.environ
rec['paneKeyPresent'] = bool(env.get('ORCA_PANE_KEY'))
rec['envNames'] = sorted(n for n in env if n.startswith(('FACTORY_', 'DROID_')))

ps_env = dict(env, TZ='UTC0', LC_ALL='C')
chain = []
pid = os.getppid()
for _ in range(6):
    if pid <= 1:
        break
    out = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'ppid=,lstart=,comm='], capture_output=True, text=True, env=ps_env).stdout.strip()
    parts = out.split(None, 6)
    if len(parts) < 7:
        break
    chain.append({'pid': pid, 'start': ' '.join(parts[1:6]), 'comm': parts[6].split('/')[-1]})
    pid = int(parts[0])
rec['chain'] = chain
droid = next((c for c in chain if c['comm'] == 'droid'), None)
rec['droid'] = {'pid': droid['pid'], 'start': droid['start']} if droid else None

fd = os.open(os.path.join(out_dir, 'hooks.jsonl'), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
os.write(fd, (json.dumps(rec) + '\n').encode())
os.close(fd)
