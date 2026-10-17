#!/bin/sh
# Zero-cost: valid key, accept the trust dialog in each probe folder, reach the prompt box, submit nothing, exit.
cd /tmp/droid-28/probes || exit 1
export KEY_FILE="${KEY_FILE:?set KEY_FILE}"
for d in proj-a proj-b proj-c; do
  ./with-key.sh python3 pty_drive.py ../out/trust-$d.pty 22 /tmp/droid-28/$d \
    --send '9000:\r' --send '16000:\x03' --send '16800:\x03' \
    -- droid --settings /tmp/droid-28/probes/tui-settings.json
  echo "[$d] saw trust text: $(python3 render_screen.py ../out/trust-$d.pty 600 | grep -ci 'trust')  reached prompt hint: $(python3 render_screen.py ../out/trust-$d.pty 600 | grep -ci -E 'ctrl\+c|esc|shift')"
done
echo "=== files in throwaway HOME mentioning probe folders (names only)"
grep -rl -E 'droid-28/proj-(a|b|c)' /tmp/droid-28/home/.factory --include='*.json' 2>/dev/null | grep -v '/sessions/' | sed 's#/tmp/droid-28/home/##'
echo "=== session files created by the TUI runs"
ls /tmp/droid-28/home/.factory/sessions/*/ | grep -c '\.jsonl'
