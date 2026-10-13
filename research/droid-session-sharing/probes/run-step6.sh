#!/bin/sh
# Credit-free checks over the TUI-created session (valid key only for TUI processes that submit no prompt).
cd /tmp/droid-23 || exit 1
D=home/.factory/sessions/-private-tmp-droid-23-proj
TUI=$(ls $D/c626*.jsonl | xargs -n1 basename | sed 's/\.jsonl$//')
STR=$(ls $D/fc3c*.jsonl | xargs -n1 basename | sed 's/\.jsonl$//')
BAD="env HOME=/tmp/droid-23/home FACTORY_DISABLE_KEYRING=1 FACTORY_DROID_AUTO_UPDATE_ENABLED=false FACTORY_API_KEY=fk-invalid-orca-probe-23"
{
  echo "##### a. Orca vault parser over every transcript"
  (cd "${ORCA_REPO:?set ORCA_REPO to an Orca checkout}" && bun run /tmp/droid-23/parse-with-orca-vault.ts) 2>&1 | grep -A9 -E "^file c626"

  echo; echo "##### b. droid exec --fork on the TUI-created session (invalid key)"
  ls $D/*.jsonl | xargs -n1 basename | sort > out/before-b.txt
  (cd /tmp/droid-23/proj && $BAD droid exec --fork "$TUI" "FORK-MARK-TUI say hi" 2>&1 | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g' | head -3)
  node fork-report.mjs out/before-b.txt "$TUI"
  COPY=$(ls $D/*.jsonl | xargs -n1 basename | sort | comm -13 out/before-b.txt - | head -1 | sed 's/\.jsonl$//')

  echo; echo "##### e. model change on the provider-locked copy"
  [ -n "$COPY" ] && node step6e-provider-lock.mjs "$COPY" 2>&1 | head -8

  echo; echo "##### c. interactive droid --fork on a structured-written session (valid key, no prompt)"
  ls $D/*.jsonl | xargs -n1 basename | sort > out/before-c.txt
  ./with-key.sh python3 pty_drive.py out/tui-fork.pty 18 /tmp/droid-23/proj --send '14500:\x03' --send '15300:\x03' -- droid --settings /tmp/droid-23/tui-settings.json --fork "$STR"
  python3 render_screen.py out/tui-fork.pty 60 | grep -v -E '^[*. ]+$' | grep -i -E "fork|resum|session|error|fail|cannot|not found|GPT" | cut -c1-160 | head -8
  node fork-report.mjs out/before-c.txt "$STR"

  echo; echo "##### d. TUI resumes the session and holds it; a structured process writes into it"
  cp $D/$TUI.jsonl out/tui-session-before-d.jsonl
  ./with-key.sh python3 pty_drive.py out/tui-holds.pty 34 /tmp/droid-23/proj --send '28000:\x03' --send '28800:\x03' -- droid --settings /tmp/droid-23/tui-settings.json --resume "$TUI" &
  PYPID=$!
  sleep 12
  node step6d-structured-writes.mjs "$TUI" "$D/$TUI.jsonl" 2>&1 | head -12
  wait $PYPID
  echo "TUI screen after the structured write (filtered):"
  python3 render_screen.py out/tui-holds.pty 80 | grep -v -E '^[*. ]+$' | grep -i -E "STRUCT-MARK|authentication|invalid|updated|changed|conflict|another|modified|external|reload|sync|session" | cut -c1-170 | head -10
  echo "=== done"
} > out/step6.log 2>&1
