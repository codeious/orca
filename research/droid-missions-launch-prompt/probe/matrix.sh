#!/bin/sh
# Signed-in matrix. Types nothing except one Enter, sent only while "Trust this folder?" is on screen. Starts no Mission.
# For each version: `droid "/missions"`, `droid --auto low "/missions"`, `droid resume <id> "/missions"`.
set -u
cd /tmp/droid-41/probes
: "${KEY_FILE:?file with a FACTORY_API_KEY= line}"; export KEY_FILE

run() { # home-label tag duration bin args...
  hl=$1; tag=$2; dur=$3; bin=$4; shift 4
  echo "[$(date +%H:%M:%S)] start $tag"
  ./launch.py "$hl" "$tag" signed "/tmp/droid-41/out/$tag.pty" "$dur" "/tmp/droid-41/proj-$hl" \
    --when 'Trust this folder\?::\r' -- "$bin" "$@"
  echo "[$(date +%H:%M:%S)] done  $tag"
}

for v in 238 245 247; do
  case $v in
    238) BIN=/tmp/droid-31/bin/0.238.0/droid ;;
    245) BIN=/tmp/droid-41/bin/0.245.0/droid ;;
    247) BIN=/tmp/droid-41/bin/0.247.0/droid ;;
  esac
  ./make-home.sh "s$v" >/dev/null
  run "s$v" "s$v-plain" 45 "$BIN" "/missions"
  ./make-home.sh "a$v" >/dev/null
  run "a$v" "a$v-auto" 45 "$BIN" --auto low "/missions"
  id=$(ls /tmp/droid-41/home-s$v/.factory/sessions/*/*.jsonl 2>/dev/null | head -1 | xargs -I{} basename {} .jsonl)
  if [ -n "$id" ]; then
    run "s$v" "s$v-resume" 40 "$BIN" resume "$id" "/missions"
  else
    echo "no session id for s$v, resume skipped"
  fi
done
echo MATRIX_DONE
