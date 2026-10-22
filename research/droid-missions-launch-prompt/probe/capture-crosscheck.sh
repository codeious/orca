#!/bin/sh
# Repeats `droid "/missions"` (0.245.0, signed in) through the repo's own PTY recorder, with a timed Enter for the trust dialog.
# usage: KEY_FILE=<file with a FACTORY_API_KEY= line> capture-crosscheck.sh
set -eu
: "${KEY_FILE:?}"
REPO="${REPO:?path to the orca checkout}"
./make-home.sh c245 >/dev/null
OUT=/tmp/droid-41/out/c245-repo-capture
mkdir -p "$OUT"
cd /tmp/droid-41/proj-c245
# Key goes into the child environment only: never argv, never a log.
env -i HOME=/tmp/droid-41/home-c245 USER="$USER" LOGNAME="$USER" SHELL=/bin/zsh LANG=en_US.UTF-8 \
  PATH="/usr/bin:/bin:/usr/sbin:/sbin:$(dirname "$(command -v node)")" \
  FACTORY_DISABLE_KEYRING=1 FACTORY_DROID_AUTO_UPDATE_ENABLED=false ORCA_PANE_KEY=probe-pane \
  PROBE_OUT="$OUT" PROBE_TAG=c245 KEY_FILE="$KEY_FILE" \
  /bin/sh -c '
    set -a; . "$KEY_FILE"; set +a; unset KEY_FILE
    exec node '"$REPO"'/config/scripts/capture-agent-pty-transcript.mjs \
      --out /tmp/droid-41/out/c245-repo-capture.txt --cols 120 --rows 40 --duration 40 \
      --send "12000:\r" --note "droid /missions, 0.245.0, signed in, trust Enter only" \
      -- /tmp/droid-41/bin/0.245.0/droid "/missions" >/dev/null 2>&1
  ' || true
echo "capture exit: $?"
ls -la /tmp/droid-41/out/c245-repo-capture.txt /tmp/droid-41/out/c245-repo-capture.meta.json 2>&1
