#!/bin/sh
# usage: KEY_FILE=<file with FACTORY_API_KEY=...> run.sh <name> <duration-seconds> [capture options...]; prints the final rendered screen. Key never printed. Paths assume /tmp/droid-hooks-probe.
R=/tmp/droid-hooks-probe
NAME=$1; DUR=$2; shift 2
for v in $(env | awk -F= '/^ORCA_/{print $1}'); do unset "$v"; done
unset FACTORY_SESSION_ID FACTORY_UPSTREAM_CLIENT_TYPE
set -a; . $KEY_FILE; set +a
export HOME=$R/home FACTORY_DISABLE_KEYRING=1 FACTORY_DROID_AUTO_UPDATE_ENABLED=false
cd $R/work
node <repo>/config/scripts/capture-agent-pty-transcript.mjs --out $R/transcripts/$NAME.txt --duration "$DUR" --cols 120 --rows 40 "$@" -- droid > $R/transcripts/$NAME.stdout 2>&1
echo "capture exit: $?"
cd $R/capture && node render.mjs $R/transcripts/$NAME.txt 120 40
