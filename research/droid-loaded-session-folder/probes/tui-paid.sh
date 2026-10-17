#!/bin/sh
# PAID, one turn (approved): TUI --resume or --fork of Z from folder B, one pwd prompt.
# usage: KEY_FILE=... ./tui-paid.sh resume|fork
cd /tmp/droid-28/probes || exit 1
export KEY_FILE="${KEY_FILE:?set KEY_FILE}"
mode="${1:?resume|fork}"
Z=$(cat /tmp/droid-28/out/Z.id)
PROMPT='Run the shell command pwd using the shell tool and reply with only its output. Do not use any other tool.'
node tui-evidence.mjs snapshot ../out/before-$mode.json
echo ">>> sending the pwd prompt in TUI --$mode (credits are spent now)"
PROBE_TAG="tui-$mode-from-B" ./with-key.sh python3 pty_drive.py ../out/paid-$mode.pty 46 /tmp/droid-28/proj-b \
  --send "11000:$PROMPT" --send '11800:\r' --send '40000:\x03' --send '40800:\x03' \
  -- droid --auto low --settings /tmp/droid-28/probes/tui-settings.json --$mode "$Z"
echo "=== evidence (session files that changed)"
node tui-evidence.mjs diff ../out/before-$mode.json
