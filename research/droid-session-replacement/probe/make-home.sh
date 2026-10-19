#!/bin/sh
# usage: make-home.sh <label>
# Throwaway HOME. Never reads the real ~/.factory. Writes no key.
#
# SS_PLACE unset: one command per event in settings.json, same bytes as the one-command probe.
# SS_PLACE=entry|entries|split, SS_ORDER=slow-first|fast-first, SS_SLOW_MS, SS_FAST_MS:
#   entry   — one SessionStart group, two commands, array order (slow-first or fast-first)
#   entries — two SessionStart groups in settings.json, that same order
#   split   — slow-first puts slow in settings.json and fast in ~/.factory/hooks.json;
#             fast-first swaps the files. That is file placement, not which file runs first.
#             The hooks guide reads settings.json hooks only when hooks.json is absent, so a
#             split home may run only the hooks.json command.
# SessionEnd stays one plain command in settings.json. Other events stay one plain command.
set -eu
LABEL="${1:?label}"
ROOT="${PROBE_ROOT:-/tmp/droid-34}"
HOOK="${ROOT}/probe/hook-log.py"
H="${ROOT}/home-${LABEL}"
rm -rf "$H"
mkdir -p "$H/.factory" "${ROOT}/proj"
export HOOK_CMD="/usr/bin/python3 ${HOOK}"
if [ "${SS_PLACE:-}" = "split" ]; then
  export HOOKS_OUT="$H/.factory/hooks.json"
else
  unset HOOKS_OUT
fi
node <<'EOF' > "$H/.factory/settings.json"
const fs = require("fs")
const cmd = process.env.HOOK_CMD
const timeout = process.env.HOOK_TIMEOUT_S ? Number(process.env.HOOK_TIMEOUT_S) : undefined
const place = process.env.SS_PLACE || ""
const order = process.env.SS_ORDER || ""
function fail(msg) {
  process.stderr.write(msg + "\n")
  process.exit(1)
}
function group(commands, matcher) {
  const hooks = commands.map((command) => ({ type: "command", command, ...(timeout ? { timeout } : {}) }))
  return { ...(matcher ? { matcher } : {}), hooks }
}
function entry(command, matcher) {
  return [group([command], matcher)]
}
const hooks = {}
if (!place) {
  for (const name of ["SessionStart", "SessionEnd", "UserPromptSubmit", "Stop", "SubagentStop", "Notification", "PreCompact"]) hooks[name] = entry(cmd)
  for (const name of ["PreToolUse", "PostToolUse"]) hooks[name] = entry(cmd, "*")
  process.stdout.write(JSON.stringify({ hooks }, null, 2))
  process.exit(0)
}
if (!["entry", "entries", "split"].includes(place)) fail("SS_PLACE must be entry, entries or split")
if (!["slow-first", "fast-first"].includes(order)) fail("SS_ORDER must be slow-first or fast-first")
function timed(role, ms, mode) {
  if (!/^\d+$/.test(ms || "")) fail("SS_SLOW_MS and SS_FAST_MS must be numeric")
  if (mode !== "before" && mode !== "after") fail("delay mode must be before or after")
  return cmd + " --cmd " + role + " --delay-ms " + ms + " --delay-mode " + mode
}
const slow = timed("slow", process.env.SS_SLOW_MS, process.env.SS_SLOW_MODE || "before")
const fast = timed("fast", process.env.SS_FAST_MS, process.env.SS_FAST_MODE || "before")
const pair = order === "slow-first" ? [slow, fast] : [fast, slow]
for (const name of ["SessionEnd", "UserPromptSubmit", "Stop", "SubagentStop", "Notification", "PreCompact"]) hooks[name] = entry(cmd)
for (const name of ["PreToolUse", "PostToolUse"]) hooks[name] = entry(cmd, "*")
if (place === "entry") hooks.SessionStart = [group(pair)]
if (place === "entries") hooks.SessionStart = [group([pair[0]]), group([pair[1]])]
if (place === "split") {
  if (!process.env.HOOKS_OUT) fail("split place needs HOOKS_OUT")
  const settingsCmd = order === "slow-first" ? slow : fast
  const hooksCmd = order === "slow-first" ? fast : slow
  hooks.SessionStart = entry(settingsCmd)
  fs.writeFileSync(process.env.HOOKS_OUT, JSON.stringify({ SessionStart: entry(hooksCmd) }, null, 2))
}
process.stdout.write(JSON.stringify({ hooks }, null, 2))
EOF
echo "home ready"
