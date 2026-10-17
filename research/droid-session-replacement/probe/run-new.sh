#!/bin/sh
# Intended /new arrival run. Not run for this note: both binaries exited at auth before a prompt.
# usage: run-new.sh <0.238.0|0.244.0> <run-label> <new-count>
set -eu
VER="${1:?version}"
LABEL="${2:?label}"
COUNT="${3:?count}"
ROOT="${PROBE_ROOT:-/tmp/droid-34}"
PROBE="${ROOT}/probe"
export PROBE_ROOT="$ROOT" PROBE_OUT="${ROOT}/out" PROBE_TAG="${VER}/${LABEL}"
mkdir -p "$PROBE_OUT"
rm -f "$PROBE_OUT/listener.port"
case "$VER" in
  0.238.0) BIN="${DROID_238:-/tmp/droid-31/bin/0.238.0/droid}" ;;
  0.244.0) BIN="$(command -v droid)" ;;
  *) echo "unknown version"; exit 1 ;;
esac
python3 "$PROBE/listener.py" &
LISTENER=$!
trap 'kill "$LISTENER" 2>/dev/null || true' EXIT
i=0
while [ ! -f "$PROBE_OUT/listener.port" ]; do
  i=$((i + 1))
  [ "$i" -gt 50 ] && echo "listener did not bind" && exit 1
  sleep 0.05
done
PORT=$(cat "$PROBE_OUT/listener.port")
export LISTENER_URL="http://127.0.0.1:${PORT}/hook"
sh "$PROBE/make-home.sh" "$LABEL" >/dev/null
# Enter at 9s, then /new. Spacing is copied from the earlier free-run driver and was not rechecked.
SENDS="--send 9000:\r"
T=12000
N=0
while [ "$N" -lt "$COUNT" ]; do
  SENDS="$SENDS --send ${T}:/new --send $((T + 800)):\r"
  T=$((T + 4000))
  N=$((N + 1))
done
END_MS=$((T + 3000))
SENDS="$SENDS --send $((END_MS - 1500)):\x03 --send $((END_MS - 700)):\x03"
export SENDS
cd "$PROBE"
python3 -c '
import os, shlex, sys
sys.path.insert(0, os.getcwd())
from env_child import child_env
env = child_env(sys.argv[1], {"LISTENER_URL": os.environ["LISTENER_URL"], "PROBE_TAG": os.environ["PROBE_TAG"], "PROBE_OUT": os.environ["PROBE_OUT"]})
sends = shlex.split(os.environ["SENDS"])
out = os.path.join(os.environ["PROBE_OUT"], sys.argv[3] + ".pty")
duration = str(int(sys.argv[4]) / 1000)
os.execvpe(sys.executable, [sys.executable, "pty_drive.py", out, duration, os.environ["PROBE_ROOT"] + "/proj", *sends, "--", sys.argv[2]], env)
' "$ROOT/home-$LABEL" "$BIN" "$LABEL" "$END_MS"
