#!/bin/sh
# usage: make-home.sh <label>
# Throwaway signed-out HOME whose only Factory file is a hooks-only settings.json, plus a scratch git folder.
set -eu
LABEL="${1:?label}"
H="/tmp/droid-41/home-$LABEL"
PROJ="/tmp/droid-41/proj-$LABEL"
rm -rf "$H" "$PROJ"
mkdir -p "$H/.factory" "$PROJ"
git -C "$PROJ" init -q
node -e '
const cmd = "/usr/bin/python3 /tmp/droid-41/probes/hook-log.py"
const entry = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd }] }]
const hooks = {}
for (const e of ["SessionStart","SessionEnd","UserPromptSubmit","Stop","SubagentStop","Notification","PreCompact"]) hooks[e] = entry()
for (const e of ["PreToolUse","PostToolUse"]) hooks[e] = entry("*")
process.stdout.write(JSON.stringify({ hooks }, null, 2))
' > "$H/.factory/settings.json"
echo "home $H  proj $PROJ"
