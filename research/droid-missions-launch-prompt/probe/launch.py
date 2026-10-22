#!/usr/bin/env python3
"""usage: launch.py <label> <tag> <signed|out> <pty_drive args...>
Builds a clean environment (no inherited FACTORY_*/DROID_*/ORCA_* vars), points HOME at the throwaway profile, and for
'signed' loads FACTORY_API_KEY from $KEY_FILE into that environment only. The key never reaches argv, logs, or output."""
import os, re, sys

label, tag, mode = sys.argv[1:4]
args = sys.argv[4:]
env = {k: os.environ[k] for k in ('USER', 'LOGNAME') if k in os.environ}
env.update(
    HOME='/tmp/droid-41/home-' + label, SHELL='/bin/zsh', LANG='en_US.UTF-8', TERM='xterm-256color',
    PATH='/usr/bin:/bin:/usr/sbin:/sbin', FACTORY_DISABLE_KEYRING='1', FACTORY_DROID_AUTO_UPDATE_ENABLED='false',
    ORCA_PANE_KEY='probe-pane', PROBE_OUT='/tmp/droid-41/out/' + tag, PROBE_TAG=tag,
)
os.makedirs(env['PROBE_OUT'], exist_ok=True)
if mode == 'signed':
    key = None
    for line in open(os.environ['KEY_FILE']):
        m = re.match(r'\s*(?:export\s+)?FACTORY_API_KEY\s*=\s*(.*?)\s*$', line)
        if m:
            key = m.group(1).strip('"\'')
            break
    if not key:
        sys.exit('launch: no FACTORY_API_KEY line in the key file')
    env['FACTORY_API_KEY'] = key
os.execve('/usr/bin/python3', ['/usr/bin/python3', '/tmp/droid-41/probes/pty_drive.py', *args], env)
