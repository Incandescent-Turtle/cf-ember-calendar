"""One persistent SSH connection (key + one Duo push), driven from localhost.

    python rk_bridge.py serve fir.alliancecan.ca rorsmacd      # background; prints READY
    python rk_bridge.py run "hostname"                          # -> stdout/stderr, exit code
    python rk_bridge.py put LOCAL REMOTE | get REMOTE LOCAL     # SFTP single files

Listens on 127.0.0.1 only; every request must carry the token written to bridge_token.txt
next to this script (readable only by this user's session).
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import socketserver
import sys
import threading
from pathlib import Path

HERE = Path(__file__).parent
TOKEN_F = HERE / "bridge_token.txt"
PORT_F = HERE / "bridge_port.txt"


def serve(host: str, user: str) -> None:
    import paramiko

    key = paramiko.Ed25519Key.from_private_key_file(os.path.expanduser("~/.ssh/id_ed25519"))
    sock = socket.create_connection((host, 22), timeout=30)
    t = paramiko.Transport(sock)
    t.set_keepalive(30)
    t.start_client(timeout=30)
    hk = paramiko.HostKeys(os.path.expanduser("~/.ssh/known_hosts"))
    srv_key = t.get_remote_server_key()
    known = hk.lookup(host)
    if not known or known.get(srv_key.get_name()) != srv_key:
        raise SystemExit(f"host key for {host} not in known_hosts or different: refusing")
    remaining = t.auth_publickey(user, key)
    print(f"publickey ok; remaining {remaining}", flush=True)
    if not t.is_authenticated():
        def handler(title, instructions, prompts):
            for p, _ in prompts:
                print(f"prompt: {p.strip()[-120:]!r} -> '1' (Duo push)", flush=True)
            return ["1" for _ in prompts]
        t.auth_interactive(user, handler)
    assert t.is_authenticated()
    lock = threading.Lock()
    token = secrets.token_hex(16)
    TOKEN_F.write_text(token)

    class H(socketserver.StreamRequestHandler):
        def handle(self):
            req = json.loads(self.rfile.readline())
            if req.get("token") != token:
                self.wfile.write(b'{"rc": 99, "err": "bad token"}\n')
                return
            try:
                if "cmd" in req:
                    ch = t.open_session()
                    ch.exec_command(req["cmd"])
                    out = ch.makefile("rb").read().decode(errors="replace")
                    err = ch.makefile_stderr("rb").read().decode(errors="replace")
                    res = {"rc": ch.recv_exit_status(), "out": out, "err": err}
                else:
                    with lock:
                        sftp = paramiko.SFTPClient.from_transport(t)
                        if "put" in req:
                            sftp.put(req["put"], req["remote"])
                        else:
                            sftp.get(req["get"], req["local"])
                        sftp.close()
                    res = {"rc": 0, "out": "ok", "err": ""}
            except Exception as exc:  # noqa: BLE001
                res = {"rc": 98, "out": "", "err": repr(exc)}
            self.wfile.write((json.dumps(res) + "\n").encode())

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), H) as s:
        PORT_F.write_text(str(s.server_address[1]))
        print(f"READY on 127.0.0.1:{s.server_address[1]}", flush=True)
        threading.Thread(target=s.serve_forever, daemon=True).start()
        while t.is_active():
            threading.Event().wait(10)
        print("transport closed", flush=True)


def call(req: dict) -> dict:
    req["token"] = TOKEN_F.read_text()
    with socket.create_connection(("127.0.0.1", int(PORT_F.read_text()))) as c:
        c.sendall((json.dumps(req) + "\n").encode())
        return json.loads(c.makefile().readline())


def main() -> None:
    op = sys.argv[1]
    if op == "serve":
        serve(sys.argv[2], sys.argv[3])
        return
    if op == "run":
        r = call({"cmd": sys.argv[2]})
    elif op == "put":
        r = call({"put": sys.argv[2], "remote": sys.argv[3]})
    else:
        r = call({"get": sys.argv[2], "local": sys.argv[3]})
    sys.stdout.write(r.get("out", ""))
    sys.stderr.write(r.get("err", ""))
    sys.exit(r["rc"])


if __name__ == "__main__":
    main()
