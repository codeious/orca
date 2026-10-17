#!/bin/sh
# Zero-cost: valid key, accept the trust dialog, reach the prompt box, submit no prompt.
# Startup, /new, /clear, then exit. usage: run-free.sh <0.238.0|0.244.0>
VER="${1:?version}"
case "$VER" in
  0.238.0) BIN=/tmp/droid-31/bin/0.238.0/droid ;;
  0.244.0) BIN=$(command -v droid) ;;
  *) echo "unknown version"; exit 1 ;;
esac
export KEY_FILE="${KEY_FILE:?set KEY_FILE}" LABEL="tui-$VER"
cd /tmp/droid-32/probes || exit 1
./make-home.sh "tui-$VER" >/dev/null
D=/tmp/droid-32/proj

TAG="tui-$VER/f1-new-clear" ./with-key.sh python3 pty_drive.py ../out/f1-$VER.pty 34 $D \
  --send '9000:\r' --mark '12000:ready' \
  --send '12500:/new' --send '13800:\r' --mark '17000:after-new' \
  --send '19000:/clear' --send '20300:\r' --mark '24000:after-clear' \
  --send '27000:\x03' --send '28000:\x03' -- "$BIN"
echo "done $VER"
