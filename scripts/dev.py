"""Run the FastAPI backend and Vite frontend together for local development."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENV_PYTHON = PROJECT_ROOT / "grok-engine" / "runtime" / ".venv" / (
    "Scripts/python.exe" if os.name == "nt" else "bin/python"
)


def main() -> int:
    if not VENV_PYTHON.is_file():
        print("[ERROR] Python 运行环境不存在，请先执行 npm run setup:grok。")
        return 1
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        print("[ERROR] npm 未安装。")
        return 1

    backend_env = os.environ.copy()
    backend_env.update(
        {
            "HOST": "127.0.0.1",
            "PORT": os.environ.get("GROK_ENGINE_PORT", "39181"),
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
        }
    )
    backend = subprocess.Popen(
        [str(VENV_PYTHON), str(PROJECT_ROOT / "scripts" / "start_server.py")],
        cwd=PROJECT_ROOT,
        env=backend_env,
    )
    try:
        frontend = subprocess.run([npm, "run", "dev:web"], cwd=PROJECT_ROOT)
        return frontend.returncode
    except KeyboardInterrupt:
        return 130
    finally:
        if backend.poll() is None:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(backend.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            else:
                backend.terminate()
                try:
                    backend.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    backend.kill()


if __name__ == "__main__":
    raise SystemExit(main())
