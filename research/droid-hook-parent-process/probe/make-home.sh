#!/bin/sh
# usage: make-home.sh <label>   Creates a throwaway HOME whose only Factory file is a hooks-only settings.json.
set -eu
LABEL="${1:?label}"
H="/tmp/droid-31/home-$LABEL"
rm -rf "$H"
mkdir -p "$H/.factory" "/tmp/droid-31/proj"
PREFIX=$(cat /tmp/droid-31/probes/command-prefix.txt)
CMD="${PREFIX}/bin/sh /tmp/droid-31/probes/hook-chain.sh"
node -e '
const cmd = process.argv[1]
const entry = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd }] }]
const hooks = {}
for (const e of ["SessionStart","SessionEnd","UserPromptSubmit","Stop","SubagentStop","Notification","PreCompact"]) hooks[e] = entry()
for (const e of ["PreToolUse","PostToolUse"]) hooks[e] = entry("*")
process.stdout.write(JSON.stringify({ hooks }, null, 2))
' "$CMD" > "$H/.factory/settings.json"
echo "home $H ready"
