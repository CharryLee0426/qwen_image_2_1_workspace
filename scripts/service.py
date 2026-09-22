#!/usr/bin/env python3
"""Start or stop this workspace's local ComfyUI server."""
import json
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
PID = ROOT / "deployment/comfyui.pid"
URL = "http://127.0.0.1:8188"


def running_pid():
    if not PID.exists():
        return None
    pid = int(PID.read_text())
    command = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True).stdout
    if str(ROOT) in command and "main.py" in command:
        return pid
    return None


def main():
    pid = running_pid()
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action == "stop":
        if pid:
            os.kill(pid, signal.SIGTERM)
            for _ in range(40):
                if not running_pid():
                    break
                time.sleep(0.25)
            else:
                raise SystemExit("ComfyUI is still stopping; its PID file was retained.")
            print(f"Stopped ComfyUI (PID {pid}).")
        else:
            print("This workspace's ComfyUI is not running.")
        PID.unlink(missing_ok=True)
        return
    if action == "start" and not pid:
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", 8188)) == 0:
                raise SystemExit("Port 8188 is already in use by another process.")
        (ROOT / "logs").mkdir(exist_ok=True)
        with (ROOT / "logs/comfyui.log").open("a") as log:
            process = subprocess.Popen([str(ROOT / "run.sh")], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        PID.write_text(str(process.pid) + "\n")
        for _ in range(240):
            if process.poll() is not None:
                raise SystemExit("ComfyUI failed to start. See logs/comfyui.log.")
            try:
                with urllib.request.urlopen(URL + "/system_stats", timeout=1) as response:
                    json.load(response)
                print(f"ComfyUI is running at {URL} (PID {process.pid}).")
                return
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.5)
        raise SystemExit("Server still starting; check logs/comfyui.log.")
    print(f"ComfyUI is running at {URL} (PID {pid})." if pid else "ComfyUI is stopped.")


if __name__ == "__main__":
    main()
