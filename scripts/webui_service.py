#!/usr/bin/env python3
"""Manage the local Next.js production server."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PID = ROOT / "deployment/webui.pid"
URL = "http://127.0.0.1:3000"


def running_pid():
    if not PID.exists():
        return None
    pid = int(PID.read_text())
    cwd = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True).stdout
    return pid if f"n{ROOT / 'webui'}\n" in cwd else None


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    pid = running_pid()
    if action == "stop":
        if pid:
            os.kill(pid, signal.SIGTERM)
            for _ in range(40):
                if not running_pid():
                    break
                time.sleep(0.25)
            else:
                raise SystemExit("Web UI is still stopping; its PID file was retained.")
        PID.unlink(missing_ok=True)
        print("Web UI stopped.")
        return
    if action == "start" and not pid:
        if not (ROOT / "webui/.next/BUILD_ID").exists():
            raise SystemExit("Build the app first: cd webui && npm run build")
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", 3000)) == 0:
                raise SystemExit("Port 3000 is already in use.")
        with (ROOT / "logs/webui.log").open("a") as log:
            process = subprocess.Popen([str(ROOT / "run-webui.sh")], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        PID.write_text(str(process.pid) + "\n")
        for _ in range(80):
            if process.poll() is not None:
                raise SystemExit("Web UI failed to start. See logs/webui.log.")
            try:
                with urllib.request.urlopen(URL, timeout=1):
                    print(f"Qwen Image Studio is running at {URL}")
                    return
            except (urllib.error.URLError, TimeoutError):
                time.sleep(.5)
        raise SystemExit("Web UI is still starting. See logs/webui.log.")
    print(f"Qwen Image Studio is running at {URL}" if pid else "Web UI is stopped.")


if __name__ == "__main__":
    main()
