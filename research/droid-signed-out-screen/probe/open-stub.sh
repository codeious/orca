#!/bin/sh
# Records that a browser launch was attempted (argument count and URL host only); opens nothing.
H=$(printf '%s' "${1:-}" | sed -n 's#^[a-z]*://\([^/:?]*\).*#\1#p')
printf '{"stub":"%s","argc":%s,"host":"%s","t":%s}\n' "$(basename "$0")" "$#" "$H" "$(date +%s)" >> "${PROBE_OUT:-/tmp/droid-signed-out-probe/out}/browser-launch.jsonl"
exit 0
