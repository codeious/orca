#!/bin/sh
# Second logger: tells apart a settings.json hook from a hooks.json hook.
cat >/dev/null
printf '{"src":"b"}\n' >> /tmp/droid-hooks-probe/hook-events-b.jsonl
exit 0
