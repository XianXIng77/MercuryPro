"""Runtime helpers for MercuryPro's embedded Python services."""

from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
from collections import deque
from pathlib import Path
from typing import Any

import httpx


ENGINE_HOST = "127.0.0.1"
ENGINE_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ENGINE_ROOT.parent
RUNTIME_ROOT = ENGINE_ROOT / "runtime"
SOLVER_ROOT = ENGINE_ROOT / "vendor" / "turnstile-solver"
TOOLS_ROOT = ENGINE_ROOT / "tools"


def _managed_port(env_key: str, preferred: int) -> int:
    """Use the configured port, or fall back to a free loopback port."""

    configured = str(os.environ.get(env_key) or "").strip()
    if configured:
        return int(configured)
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind((ENGINE_HOST, preferred))
        except OSError:
            probe.bind((ENGINE_HOST, 0))
        return int(probe.getsockname()[1])
    finally:
        probe.close()


SOLVER_PORT = int(os.environ.get("GROK_SOLVER_PORT", "39182"))
MAIL_HELPER_PORT = _managed_port("GROK_MAIL_HELPER_PORT", 39183)


class RuntimeServiceError(RuntimeError):
    """Raised when one of the managed helper services cannot be started."""


def _service_url(port: int, path: str = "") -> str:
    return f"http://{ENGINE_HOST}:{port}{path}"


def configure_environment() -> None:
    """Set embedded service defaults before the Grok application is imported."""

    os.environ.setdefault("PROGROK_SOLVER_URL", _service_url(SOLVER_PORT))
    os.environ.setdefault("PROGROK_HOTMAIL_HELPER_URL", _service_url(MAIL_HELPER_PORT))
    os.environ.setdefault(
        "PROGROK_SOLVER_PROXY_FILE", str(SOLVER_ROOT / "proxies.txt")
    )


class _ManagedService:
    def __init__(
        self,
        name: str,
        health_url: str,
        args: list[str],
        cwd: Path,
        env: dict[str, str],
        startup_timeout: float,
    ) -> None:
        self.name = name
        self.health_url = health_url
        self.args = args
        self.cwd = cwd
        self.env = env
        self.startup_timeout = startup_timeout
        self.process: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()
        self.logs: deque[str] = deque(maxlen=80)
        self.log_tasks: list[asyncio.Task[None]] = []

    async def _healthy(self, timeout: float = 1.0) -> bool:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(self.health_url)
            return response.is_success
        except httpx.HTTPError:
            return False

    async def _remember(self, stream: asyncio.StreamReader | None) -> None:
        if stream is None:
            return
        while True:
            line = await stream.readline()
            if not line:
                return
            self.logs.append(line.decode("utf-8", errors="backslashreplace").rstrip())

    async def ensure(self) -> None:
        if await self._healthy(1.5):
            return
        async with self.lock:
            if await self._healthy(1.5):
                return
            if self.process and self.process.returncode is None:
                await self._wait_until_healthy()
                return

            RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
            environment = {
                **os.environ,
                "PYTHONUTF8": "1",
                "PYTHONIOENCODING": "utf-8",
                **self.env,
            }
            try:
                self.process = await asyncio.create_subprocess_exec(
                    _python_executable(self.name),
                    *self.args,
                    cwd=str(self.cwd),
                    env=environment,
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    creationflags=(
                        subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
                    ),
                )
            except (OSError, ValueError) as exc:
                raise RuntimeServiceError(f"{self.name} 启动失败：{exc}") from exc

            self.log_tasks = [
                asyncio.create_task(self._remember(self.process.stdout)),
                asyncio.create_task(self._remember(self.process.stderr)),
            ]
            try:
                await self._wait_until_healthy()
            except Exception:
                await self.stop()
                raise

    async def _wait_until_healthy(self) -> None:
        deadline = asyncio.get_running_loop().time() + self.startup_timeout
        while asyncio.get_running_loop().time() < deadline:
            if await self._healthy():
                return
            if self.process and self.process.returncode is not None:
                break
            await asyncio.sleep(0.3)
        detail = "\n".join(list(self.logs)[-12:])
        suffix = f"：\n{detail}" if detail else ""
        raise RuntimeServiceError(f"{self.name} 启动失败{suffix}")

    async def stop(self) -> None:
        process = self.process
        self.process = None
        if not process or process.returncode is not None:
            return
        if os.name == "nt":
            killer = await asyncio.create_subprocess_exec(
                "taskkill",
                "/PID",
                str(process.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            await killer.wait()
        else:
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
        log_tasks = list(self.log_tasks)
        for task in log_tasks:
            task.cancel()
        self.log_tasks.clear()
        if log_tasks:
            await asyncio.gather(*log_tasks, return_exceptions=True)


def _python_executable(service: str) -> str:
    override_key = (
        "GROK_SOLVER_PYTHON" if service == "solver" else "GROK_MAIL_HELPER_PYTHON"
    )
    override = os.environ.get(override_key, "").strip()
    if override:
        return override
    configured = os.environ.get("GROK_ENGINE_PYTHON", "").strip()
    if configured:
        return configured
    return sys.executable


_solver = _ManagedService(
    name="solver",
    health_url=_service_url(SOLVER_PORT, "/health"),
    args=[
        "api_solver.py",
        "--browser_type",
        "camoufox",
        "--thread",
        str(max(1, min(8, int(os.environ.get("GROK_SOLVER_THREADS", "3"))))),
        "--proxy",
        "--host",
        ENGINE_HOST,
        "--port",
        str(SOLVER_PORT),
    ],
    cwd=SOLVER_ROOT,
    env={
        "TURNSTILE_LAZY": os.environ.get("TURNSTILE_LAZY", "1"),
        "TURNSTILE_REUSE_PAGE": os.environ.get("TURNSTILE_REUSE_PAGE", "1"),
        "TURNSTILE_IDLE_SEC": os.environ.get("TURNSTILE_IDLE_SEC", "600"),
    },
    startup_timeout=90,
)

_mail_helper = _ManagedService(
    name="mail",
    health_url=_service_url(MAIL_HELPER_PORT, "/health"),
    args=[
        "hotmail_helper.py",
        "--host",
        ENGINE_HOST,
        "--port",
        str(MAIL_HELPER_PORT),
    ],
    cwd=TOOLS_ROOT,
    env={"PROGROK_HOTMAIL_DATA_DIR": str(RUNTIME_ROOT / "hotmail")},
    startup_timeout=12,
)


async def ensure_for_path(path: str, body: Any = None) -> None:
    """Start helper services needed by a Grok API request."""

    payload = body if isinstance(body, dict) else {}
    if path == "/api/register":
        if (payload.get("captcha_provider") or "local") == "local":
            await _solver.ensure()
        if payload.get("mail_provider") == "hotmail_local":
            await _mail_helper.ensure()
    elif path.startswith("/api/solver/"):
        await _solver.ensure()
    elif path in {
        "/api/mail/hotmail/test",
        "/api/mail/hotmail/accounts/import",
        "/api/mail/hotmail/accounts/probe",
    } or (path.startswith("/api/mail/hotmail/accounts/") and path.endswith("/probe")):
        await _mail_helper.ensure()


async def shutdown_managed_processes() -> None:
    await asyncio.gather(_solver.stop(), _mail_helper.stop())


def setup_hint(error: Exception) -> str:
    message = str(error)
    if any(token in message for token in ("No module named", "找不到", "not found")):
        return "内置 Grok 运行环境尚未安装，请执行 npm run setup:grok。"
    return "请检查 Grok 运行日志，或重新执行 npm run setup:grok。"
