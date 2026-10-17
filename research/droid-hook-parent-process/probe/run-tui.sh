#!/bin/sh
# Zero-cost terminal half: valid key, no prompt submitted. usage: run-tui.sh <0.238.0|0.244.0>
# T1 startup + /new + exit, T2 resume in a new process, T3 pane-close style exits (SIGHUP, SIGTERM).
VER="${1:?version}"
case "$VER" in
  0.238.0) BIN=/tmp/droid-31/bin/0.238.0/droid ;;
  0.244.0) BIN=$(command -v droid) ;;
  *) echo "unknown version"; exit 1 ;;
esac
export KEY_FILE="${KEY_FILE:?set KEY_FILE}" LABEL="tui-$VER"
cd /tmp/droid-31/probes || exit 1
./make-home.sh "tui-$VER" >/dev/null
SESS="/tmp/droid-31/home-tui-$VER/.factory/sessions"
D=/tmp/droid-31/proj

TAG="tui-$VER/t1-new" ./with-key.sh python3 pty_drive.py ../out/t1-$VER.pty 30 $D \
  --send '9000:\r' --mark '12000:ready' --send '12500:/new' --send '13800:\r' --mark '16500:after-new' \
  --send '19000:\x03' --send '20000:\x03' -- "$BIN"

ID=$(ls -t "$SESS"/*/*.jsonl 2>/dev/null | head -1 | xargs -I{} basename {} .jsonl)
echo "sessions after T1: $(ls "$SESS"/*/*.jsonl 2>/dev/null | wc -l | tr -d ' ') file(s); resuming newest ($(printf '%s' "$ID" | cut -c1-8))"

TAG="tui-$VER/t2-resume" ./with-key.sh python3 pty_drive.py ../out/t2-$VER.pty 24 $D \
  --send '9000:\r' --mark '12000:ready' --send '16000:\x03' --send '17000:\x03' -- "$BIN" --resume "$ID"

TAG="tui-$VER/t3-hup" END=hup ./with-key.sh python3 pty_drive.py ../out/t3h-$VER.pty 14 $D \
  --send '9000:\r' --mark '12000:ready' -- "$BIN"

TAG="tui-$VER/t3-term" ./with-key.sh python3 pty_drive.py ../out/t3t-$VER.pty 14 $D \
  --send '9000:\r' --mark '12000:ready' -- "$BIN"
echo "done $VER"
