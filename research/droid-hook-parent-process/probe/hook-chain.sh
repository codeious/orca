#!/bin/sh
# Probe hook for ticket "Does a Droid hook command's parent process identify the droid terminal process?"
# Records only: event name, 8-char session id prefix, pids, start times, and command basenames. Never the payload.
payload=$(cat)
printf 'ran %s %s\n' "${PROBE_TAG:-}" "$(printf '%s' "$payload" | sed -n 's/.*"hook_event_name" *: *"\([A-Za-z]*\)".*/\1/p' | head -n1)" >> "${PROBE_OUT:-/tmp/droid-31/out}/hooks-ran.log"
printf '{}\n'
event=$(printf '%s' "$payload" | sed -n 's/.*"hook_event_name" *: *"\([A-Za-z]*\)".*/\1/p' | head -n1)
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id" *: *"\([0-9a-f]\{8\}\).*/\1/p' | head -n1)
src=$(printf '%s' "$payload" | sed -n 's/.*"source" *: *"\([A-Za-z_]*\)".*/\1/p' | head -n1)
reason=$(printf '%s' "$payload" | sed -n 's/.*"reason" *: *"\([A-Za-z_]*\)".*/\1/p' | head -n1)
callsid=$(printf '%s' "$payload" | sed -n 's/.*"calling_session_id" *: *"\([0-9a-f]\{8\}\).*/\1/p' | head -n1)

# Orca's real capture lines (generated from src/main/agent-hooks/hook-process-capture.ts); sets orca_agent_process.
. /tmp/droid-31/probes/capture.sh

chain=""
p=$$
n=0
while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null && [ "$n" -lt 8 ]; do
  if [ -r "/proc/$p/stat" ]; then
    pstat=$(cat "/proc/$p/stat" 2>/dev/null)
    prest=${pstat##*) }
    pp=$(printf '%s' "$prest" | awk '{print $2}')
    st=$(printf '%s' "$prest" | awk '{print $20}')
    cm=$(cat "/proc/$p/comm" 2>/dev/null)
  else
    pp=$(/bin/ps -p "$p" -o ppid= 2>/dev/null | tr -d ' ')
    st=$(TZ=UTC0 LC_ALL=C /bin/ps -p "$p" -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//')
    cm=$(/bin/ps -p "$p" -o comm= 2>/dev/null | sed 's/^ *//;s/ *$//')
  fi
  cm=${cm##*/}
  chain="$chain{\"pid\":$p,\"ppid\":\"$pp\",\"start\":\"$st\",\"comm\":\"$cm\"},"
  p=$pp
  n=$((n + 1))
done
chain="[${chain%,}]"

cap=${orca_agent_process:-null}
printf '{"kind":"hook","tag":"%s","event":"%s","session":"%s","source":"%s","reason":"%s","callingSession":"%s","scriptPid":%s,"capturedAgentPid":"%s","orcaCapture":%s,"chain":%s}\n' \
  "${PROBE_TAG:-}" "$event" "$sid" "$src" "$reason" "$callsid" "$$" "${ORCA_HOOK_AGENT_PID:-}" "$cap" "$chain" >> "${PROBE_OUT:-/tmp/droid-31/out}/hooks.jsonl"
exit 0
