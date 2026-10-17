#!/bin/sh
# PAID, one turn per call (approved cap: 4 turns in total). The lead is asked to launch one foreground
# Task subagent (built-in `explorer`); the subagent is asked to answer one word and use no tools.
# usage: KEY_FILE=... run-paid.sh <0.238.0|0.244.0> <n>
# Reuses the HOME that run-free.sh made, so the folder is already trusted.
VER="${1:?version}"
N="${2:?turn number}"
case "$VER" in
  0.238.0) BIN=/tmp/droid-31/bin/0.238.0/droid ;;
  0.244.0) BIN=$(command -v droid) ;;
  *) echo "unknown version"; exit 1 ;;
esac
export KEY_FILE="${KEY_FILE:?set KEY_FILE}" LABEL="tui-$VER"
cd /tmp/droid-32/probes || exit 1
D=/tmp/droid-32/proj
PROMPT='Use the Task tool exactly once, with subagent_type explorer, description probe, and prompt: Reply with the single word OK. Do not use any tools. Wait for it to finish, then reply with only the word DONE. Do not use any other tool.'
echo ">>> sending the Task prompt on $VER, turn $N (credits are spent now)"
TAG="tui-$VER/p$N-task" ./with-key.sh python3 pty_drive.py ../out/p$N-$VER.pty 80 $D \
  --send "11000:$PROMPT" --send '11800:\r' \
  --mark '14000:t14' --mark '18000:t18' --mark '22000:t22' --mark '26000:t26' --mark '32000:t32' --mark '40000:t40' --mark '55000:t55' --mark '68000:before-exit' \
  --send '70000:\x03' --send '71000:\x03' \
  -- "$BIN" --auto low --settings /tmp/droid-32/probes/tui-settings.json
echo "done $VER turn $N"
