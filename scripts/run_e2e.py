#!/usr/bin/env python3
"""End-to-end runner: boots the receiver, API/worker, and dashboard on free loopback
ports with a temporary SQLite database, then runs the Playwright suite against them.

Usage:
    python3 scripts/run_e2e.py [-- playwright args...]
"""

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def wait_ready(url: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(0.1)
    raise RuntimeError(f"service did not become ready: {url}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("playwright_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    extra = args.playwright_args[1:] if args.playwright_args[:1] == ["--"] else args.playwright_args

    receiver_port, api_port, dashboard_port = free_port(), free_port(), free_port()
    temp_dir = tempfile.mkdtemp(prefix="benji-e2e-")
    environment = {
        **os.environ,
        "PYTHONPATH": "backend",
        "BENJI_DB_PATH": str(Path(temp_dir) / "e2e.sqlite3"),
        "BENJI_RECEIVER_ORIGIN": f"http://127.0.0.1:{receiver_port}",
        "BENJI_RETRY_DELAYS": "0.3,0.6",
        "BENJI_TICK_INTERVAL": "0.1",
        "BENJI_API_ORIGIN": f"http://127.0.0.1:{api_port}",
    }

    processes: list[subprocess.Popen] = []
    try:
        processes.append(
            subprocess.Popen(
                [
                    "uv", "run", "--python", "3.12", "--group", "dev",
                    "uvicorn", "receiver_app.app:app", "--app-dir", "receiver",
                    "--host", "127.0.0.1", "--port", str(receiver_port),
                ],
                cwd=ROOT,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        processes.append(
            subprocess.Popen(
                [
                    "uv", "run", "--python", "3.12", "--group", "dev",
                    "uvicorn", "app.api:app", "--app-dir", "backend",
                    "--host", "127.0.0.1", "--port", str(api_port),
                ],
                cwd=ROOT,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        processes.append(
            subprocess.Popen(
                ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(dashboard_port), "--strictPort"],
                cwd=FRONTEND,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )

        wait_ready(f"http://127.0.0.1:{receiver_port}/api/requests")
        wait_ready(f"http://127.0.0.1:{api_port}/api/health")
        wait_ready(f"http://127.0.0.1:{dashboard_port}/")

        result = subprocess.run(
            ["npx", "playwright", "test", *extra],
            cwd=FRONTEND,
            env={
                **environment,
                "PW_BASE_URL": f"http://127.0.0.1:{dashboard_port}",
                "PW_API_URL": f"http://127.0.0.1:{api_port}",
                "PW_RECEIVER_URL": f"http://127.0.0.1:{receiver_port}",
            },
        )
        return result.returncode
    finally:
        for process in processes:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
