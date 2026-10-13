#!/bin/sh
# Loads FACTORY_API_KEY from the key file into this process's environment only, then execs the command. Never prints the value.
set -u
KEY_FILE="${KEY_FILE:?set KEY_FILE to a file holding a FACTORY_API_KEY= line}"
line=$(grep -m1 -E '^(export )?FACTORY_API_KEY=' "$KEY_FILE" 2>/dev/null || true)
if [ -n "$line" ]; then
  key=$(printf '%s' "$line" | sed -E "s/^(export )?FACTORY_API_KEY=//; s/^[\"']//; s/[\"']\$//")
else
  key=$(head -n1 "$KEY_FILE" | tr -d '\r\n ')
fi
[ -n "$key" ] || { echo "with-key: no key found in key file" >&2; exit 64; }
export FACTORY_API_KEY="$key"
export HOME=/tmp/droid-23/home FACTORY_DISABLE_KEYRING=1 FACTORY_DROID_AUTO_UPDATE_ENABLED=false
unset FACTORY_SESSION_ID FACTORY_UPSTREAM_CLIENT_TYPE
for v in $(env | grep -E '^ORCA_' | cut -d= -f1); do unset "$v"; done
exec "$@"
