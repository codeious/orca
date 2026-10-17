#!/bin/sh
# usage: make-home.sh <label>   Creates a throwaway HOME whose only Factory file is a hooks-only settings.json.
set -eu
LABEL="${1:?label}"
H="/tmp/droid-32/home-$LABEL"
rm -rf "$H"
mkdir -p "$H/.factory" /tmp/droid-32/proj
node -e '
const cmd = "/usr/bin/python3 /tmp/droid-32/probes/hook-log.py"
const entry = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd }] }]
const hooks = {}
for (const e of ["SessionStart","SessionEnd","UserPromptSubmit","Stop","SubagentStop","Notification","PreCompact"]) hooks[e] = entry()
for (const e of ["PreToolUse","PostToolUse"]) hooks[e] = entry("*")
process.stdout.write(JSON.stringify({ hooks }, null, 2))
' > "$H/.factory/settings.json"
echo "home $H ready"
