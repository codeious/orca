#!/bin/sh
# Zero-cost: valid key, trust the folder, reach the prompt box, submit nothing, exit. Writes everything to out/tui-ready.log.
cd /tmp/droid-23 || exit 1
{
  ./with-key.sh python3 pty_drive.py out/tui-ready.pty 24 /tmp/droid-23/proj \
    --send '9000:\r' --send '19000:\x03' --send '19800:\x03' \
    -- droid --settings /tmp/droid-23/tui-settings.json
  python3 render_screen.py out/tui-ready.pty 400 | grep -v -E '^[*. ]+$' | cut -c1-200 | tail -40
  echo "=== sessions"
  ls /tmp/droid-23/home/.factory/sessions/-private-tmp-droid-23-proj/*.jsonl | xargs -n1 basename | sort | comm -13 out/before-tui.txt - | sed -E 's/([0-9a-f]{4})[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<\1>/'
  echo "=== done"
} > out/tui-ready.log 2>&1
