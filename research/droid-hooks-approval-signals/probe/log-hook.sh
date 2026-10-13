#!/bin/sh
# Appends one JSON line per hook event: key names plus a few non-sensitive fields. Raw payload goes to a separate file.
DIR=/tmp/droid-hooks-probe
payload=$(cat)
printf '%s\n' "$payload" >> "$DIR/raw-payloads.jsonl"
printf '%s' "$payload" | jq -c --arg t "$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')" '{ms: ($t|tonumber), event: (.hook_event_name // .event // "?"), keys: (keys), tool_name: (.tool_name // .name // null), tool_input_keys: ((.tool_input // .input // .arguments // null) | if type=="object" then keys else null end), risk: (.riskLevel // .risk_level // .tool_input.riskLevel // .tool_input.risk_level // null), message: (.message // null)}' >> "$DIR/hook-events.jsonl" 2>/dev/null || printf '{"event":"unparseable"}\n' >> "$DIR/hook-events.jsonl"
exit 0
