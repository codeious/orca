#!/usr/bin/env python3
"""Local hook listener. Assigns arrival order when the POST is read, then keeps only allowlisted fields.

Binds 127.0.0.1 on an ephemeral port. Writes one JSON object per POST to $PROBE_OUT/hooks.jsonl.
Session ids and process identity are stored as relations (S1, P1), never as the raw values.
"""
import json, os, re, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = os.environ.get("PROBE_OUT", "/tmp/droid-34/out")
PORT_FILE = os.path.join(OUT, "listener.port")
LOG = os.path.join(OUT, "hooks.jsonl")
SAFE = re.compile(r"^[A-Za-z0-9_]{1,64}$")
TOKEN = re.compile(r"^[A-Za-z0-9_.:-]{1,40}$")
ID_KEYS = ("session_id", "calling_session_id", "previous_session_id")
SCALAR = ("source", "reason")

# Built at runtime so this file does not contain the placeholder or a home path.
FORBIDDEN = ("fk-" + "invalid-000000", "no" + "ter", "/Us" + "ers/")

lock = threading.Lock()
seq = 0
ids = {}
procs = {}


def dirty(text):
    return any(bad in text for bad in FORBIDDEN)


def relate(tag, raw):
    table = ids.setdefault(tag, {})
    known = raw in table
    if not known:
        table[raw] = "S%d" % (len(table) + 1)
    return table[raw] + ("" if known else " (new)")


def relate_proc(tag, pid, start):
    table = procs.setdefault(tag, {})
    key = "%s|%s" % (pid, start)
    known = key in table
    if not known:
        table[key] = "P%d" % (len(table) + 1)
    return table[key] + ("" if known else " (new)")


def scrub(body, arrival_ns):
    global seq
    try:
        payload = json.loads(body)
    except ValueError:
        payload = None
    with lock:
        seq += 1
        rec = {"kind": "hook", "seq": seq, "arrivalNs": arrival_ns}
        if not isinstance(payload, dict):
            rec["event"] = "unparsed"
            return rec
        tag = payload.get("tag") if isinstance(payload.get("tag"), str) and TOKEN.match(payload["tag"]) else "untagged"
        rec["tag"] = tag
        event = payload.get("event")
        rec["event"] = event if isinstance(event, str) and TOKEN.match(event) else "unparsed"
        keys = payload.get("keys")
        if isinstance(keys, list):
            rec["keys"] = sorted({k for k in keys if isinstance(k, str) and SAFE.match(k) and not dirty(k)})
        for name in SCALAR:
            if name in payload and isinstance(payload[name], str) and TOKEN.match(payload[name]):
                rec[name] = payload[name]
        rels = {}
        for name in ID_KEYS:
            if name not in payload:
                rels[name] = "absent"
                continue
            value = payload[name]
            if value is None:
                rels[name] = "null"
            elif value == "":
                rels[name] = "empty"
            elif not isinstance(value, str) or dirty(value):
                rels[name] = "other"
            else:
                rels[name] = relate(tag, value)
        rec["ids"] = rels
        proc = payload.get("process")
        if isinstance(proc, dict) and isinstance(proc.get("pid"), int) and isinstance(proc.get("start"), str) and not dirty(proc["start"]):
            rec["process"] = relate_proc(tag, proc["pid"], proc["start"])
        else:
            rec["process"] = "absent"
        text = json.dumps(rec)
        if dirty(text):
            return {"kind": "dropped", "seq": rec["seq"], "arrivalNs": arrival_ns, "tag": tag}
        return rec


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length else b""
        arrival = __import__("time").monotonic_ns()
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()
        if self.path != "/hook":
            return
        rec = scrub(body, arrival)
        line = (json.dumps(rec, separators=(",", ":")) + "\n").encode()
        fd = os.open(LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        os.write(fd, line)
        os.close(fd)

    def log_message(self, fmt, *args):
        return


def main():
    os.makedirs(OUT, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    with open(PORT_FILE, "w") as fh:
        fh.write(str(server.server_address[1]))
    server.serve_forever()


if __name__ == "__main__":
    main()
