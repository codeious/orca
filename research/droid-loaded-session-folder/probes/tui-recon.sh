#!/bin/sh
# Zero-cost: start the TUI with --resume / --fork of Z from folder B, submit nothing, show the screen, exit.
cd /tmp/droid-28/probes || exit 1
export KEY_FILE="${KEY_FILE:?set KEY_FILE}"
Z=$(cat /tmp/droid-28/out/Z.id)
for mode in resume fork; do
  ./with-key.sh python3 pty_drive.py ../out/recon-$mode.pty 20 /tmp/droid-28/proj-b \
    --send '13000:\x03' --send '13800:\x03' \
    -- droid --auto low --settings /tmp/droid-28/probes/tui-settings.json --$mode "$Z"
  echo "=== [$mode] screen tail (lines with @ removed)"
  python3 render_screen.py ../out/recon-$mode.pty 400 | grep -v -E '^[*. ]+$|@' | cut -c1-160 | tail -22
done
