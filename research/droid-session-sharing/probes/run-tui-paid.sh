#!/bin/sh
# The ONE credit-spending step: a TUI session on gpt-6-luna (effort none) answers a one-word prompt. Output: out/tui-paid.log.
cd /tmp/droid-23 || exit 1
{
  ./with-key.sh python3 pty_drive.py out/tui-paid.pty 30 /tmp/droid-23/proj \
    --send '10000:Reply with the single word OK. Do not use tools.' --send '10800:\r' \
    --send '25000:\x03' --send '25800:\x03' \
    -- droid --settings /tmp/droid-23/tui-settings.json
  python3 render_screen.py out/tui-paid.pty 400 | grep -v -E '^[*. ]+$' | cut -c1-200 | tail -24
  echo "=== sessions"
  ls /tmp/droid-23/home/.factory/sessions/-private-tmp-droid-23-proj/*.jsonl | xargs -n1 basename | sort | comm -13 out/before-paid.txt - | sed -E 's/([0-9a-f]{4})[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<\1>/'
  echo "=== done"
} > out/tui-paid.log 2>&1
