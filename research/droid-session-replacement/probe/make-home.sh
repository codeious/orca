#!/bin/sh
# usage: make-home.sh <label>
# Throwaway HOME whose only Factory file is a hooks settings.json. Never reads the real home.
set -eu
LABEL="${1:?label}"
ROOT="${PROBE_ROOT:-/tmp/droid-34}"
HOOK="${ROOT}/probe/hook-log.py"
H="${ROOT}/home-${LABEL}"
rm -rf "$H"
mkdir -p "$H/.factory" "${ROOT}/proj"
CMD="/usr/bin/python3 ${HOOK}"
node -e '
const cmd = process.argv[1]
const entry = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd }] }]
const hooks = {}
for (const name of ["SessionStart","SessionEnd","UserPromptSubmit","Stop","SubagentStop","Notification","PreCompact"]) hooks[name] = entry()
for (const name of ["PreToolUse","PostToolUse"]) hooks[name] = entry("*")
process.stdout.write(JSON.stringify({ hooks }, null, 2))
' "$CMD" > "$H/.factory/settings.json"
echo "home ready"
