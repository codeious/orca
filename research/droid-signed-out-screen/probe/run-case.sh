#!/bin/sh
# usage: ORCA_REPO=<orca checkout> run-case.sh <capture|timing> <version> <case> <duration-s> [cols rows]
# Cases: bare | prompt | auto-prompt | badkey-bare | badkey-prompt
# Needs $PROBE_ROOT/bin/<version>/droid (a pinned download). Runs droid typed into an interactive bash, as an
# Orca automation pane does, with a clean env, a throwaway signed-out HOME whose settings.json only logs hook
# key names, and `open`/`xdg-open`/`wslview` stubs that record a launch attempt and open nothing.
set -eu
MODE="$1"; VER="$2"; CASE="$3"; DUR="$4"; COLS="${5:-120}"; ROWS="${6:-40}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${PROBE_ROOT:-/tmp/droid-signed-out-probe}"
REPO="${ORCA_REPO:?set ORCA_REPO to an orca checkout}"
NODE_BIN="$(command -v node)"
TAG="$MODE-$VER-$CASE-${COLS}x${ROWS}"
NAME="droid-$(printf '%s' "$VER" | tr . -)-signed-out-$CASE-${COLS}x${ROWS}"
H="$ROOT/home/$TAG"; PROJ="$ROOT/proj/$TAG"; OUT="$ROOT/out/$TAG"
rm -rf "$H" "$PROJ" "$OUT"; mkdir -p "$H/.factory" "$PROJ" "$OUT" "$ROOT/shim/$VER" "$ROOT/stub" "$ROOT/fixtures"
ln -sf "$ROOT/bin/$VER/droid" "$ROOT/shim/$VER/droid"
for stub in open xdg-open wslview; do cp "$HERE/open-stub.sh" "$ROOT/stub/$stub"; chmod +x "$ROOT/stub/$stub"; done
git -C "$PROJ" init -q
HOOK_CMD="/usr/bin/python3 $HERE/hook-log.py" node -e '
const cmd = process.env.HOOK_CMD
const entry = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd }] }]
const hooks = {}
for (const e of ["SessionStart","SessionEnd","UserPromptSubmit","Stop","SubagentStop","Notification","PreCompact"]) hooks[e] = entry()
for (const e of ["PreToolUse","PostToolUse"]) hooks[e] = entry("*")
process.stdout.write(JSON.stringify({ hooks }, null, 2))
' > "$H/.factory/settings.json"

PROMPT='ORCA-PROBE-PROMPT-q7'
case "$CASE" in
  bare|badkey-bare) LINE='droid' ;;
  prompt|badkey-prompt) LINE="droid \"$PROMPT\"" ;;
  auto-prompt) LINE="droid --auto high \"$PROMPT\"" ;;
  *) echo "unknown case $CASE" >&2; exit 2 ;;
esac

set -- /usr/bin/env -i \
  USER="${USER:-u}" LOGNAME="${LOGNAME:-u}" HOME="$H" SHELL=/bin/bash LANG=en_US.UTF-8 TERM=xterm-256color \
  PATH="$ROOT/shim/$VER:$ROOT/stub:/usr/bin:/bin:/usr/sbin:/sbin" PS1='$ ' BASH_SILENCE_DEPRECATION_WARNING=1 \
  FACTORY_DISABLE_KEYRING=1 FACTORY_DROID_AUTO_UPDATE_ENABLED=false \
  ORCA_PANE_KEY=probe-pane PROBE_OUT="$OUT" PROBE_TAG="$TAG"
case "$CASE" in
  badkey-*) set -- "$@" FACTORY_API_KEY=fk-made-up-for-signed-out-probe-0000 ;;
esac

SEND="1200:$LINE\\r"
if [ "$MODE" = capture ]; then
  cd "$PROJ"
  # The repo capture script writes the scanner-clean transcript and its .meta.json.
  exec "$@" "$NODE_BIN" "$REPO/config/scripts/capture-agent-pty-transcript.mjs" \
    --name "$NAME" --out "$ROOT/fixtures/$NAME.txt" --cols "$COLS" --rows "$ROWS" \
    --duration "$DUR" --send "$SEND" --note "droid $VER case $CASE signed out, throwaway HOME" \
    -- /bin/bash --noprofile --norc -i
else
  exec "$@" /usr/bin/python3 "$HERE/pty-timing-drive.py" "$OUT/run" "$DUR" "$COLS" "$ROWS" "$PROJ" \
    --send "$SEND" -- /bin/bash --noprofile --norc -i
fi
