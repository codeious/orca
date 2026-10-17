#!/bin/sh
# PAID, one turn (approved cap: 4 turns in total; this is turn 3). The lead launches ONE background Task
# (built-in `worker`, which sleeps ~20 s through Execute) and ends its turn without waiting.
# Descendant processes of the TUI are marked every 4 s to see whether a background subagent is a separate process.
# usage: KEY_FILE=... run-paid-bg.sh <0.238.0|0.244.0> <n>
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
PROMPT='Use the Task tool exactly once, with subagent_type worker, description probe, run_in_background true, and prompt: Run the shell command sleep 20 with the Execute tool, then reply with the single word OK. After the Task call returns, reply with only the word DONE and end your turn. Do not call TaskOutput or any other tool.'
MARKS=""
for t in 14 18 22 26 30 34 38 42 46 50 56 62; do MARKS="$MARKS --mark ${t}000:t$t"; done
echo ">>> sending the background Task prompt on $VER, turn $N (credits are spent now)"
TAG="tui-$VER/p$N-bg" ./with-key.sh python3 pty_drive.py ../out/p$N-$VER.pty 80 $D \
  --send "11000:$PROMPT" --send '11800:\r' $MARKS \
  --send '75000:\x03' --send '76000:\x03' \
  -- "$BIN" --auto low --settings /tmp/droid-32/probes/tui-settings.json
echo "done $VER turn $N"
