"""Same-origin browser debug viewer for Linux desktop registrations."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response


router = APIRouter()

_TRUTHY = {"1", "true", "yes", "on"}
_DEFAULT_NOVNC_ROOT = Path("/usr/share/novnc")


def browser_debug_enabled(environ: object = os.environ) -> bool:
    getter = getattr(environ, "get", None)
    if not callable(getter):
        return False
    return str(getter("BROWSER_DEBUG_DESKTOP_ENABLED", "false")).strip().lower() in _TRUTHY


def novnc_root(environ: object = os.environ) -> Path:
    getter = getattr(environ, "get", None)
    configured = getter("NOVNC_WEB_ROOT", "") if callable(getter) else ""
    return Path(str(configured or _DEFAULT_NOVNC_ROOT)).expanduser().resolve()


def same_origin_websocket_allowed(origin: str, host: str, forwarded_host: str = "") -> bool:
    """Reject browser WebSockets opened from a different website."""

    if not origin:
        return True
    origin_host = urlsplit(origin).netloc.lower()
    candidates = {
        value.strip().lower()
        for value in (host, forwarded_host.split(",", 1)[0])
        if value and value.strip()
    }
    return bool(origin_host and origin_host in candidates)


def resolve_novnc_asset(asset_path: str, root: Path) -> Path | None:
    relative = (asset_path or "vnc.html").lstrip("/")
    requested = (root / relative).resolve()
    if not requested.is_relative_to(root) or not requested.is_file():
        return None
    return requested


@router.get("/api/browser-debug/status")
def browser_debug_status() -> dict[str, object]:
    root = novnc_root()
    enabled = browser_debug_enabled()
    return {
        "enabled": enabled,
        "viewer_available": enabled and (root / "vnc.html").is_file(),
        "viewer_url": "/browser-debug/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=1000&resize=scale&path=api/browser-debug/vnc",
    }


@router.websocket("/api/browser-debug/vnc")
async def browser_debug_vnc(websocket: WebSocket) -> None:
    if not browser_debug_enabled():
        await websocket.close(code=1008, reason="Browser debug desktop is disabled")
        return

    if not same_origin_websocket_allowed(
        websocket.headers.get("origin", ""),
        websocket.headers.get("host", ""),
        websocket.headers.get("x-forwarded-host", ""),
    ):
        await websocket.close(code=1008, reason="Cross-origin browser debug access denied")
        return

    protocols = websocket.scope.get("subprotocols") or []
    subprotocol = "binary" if "binary" in protocols else None
    await websocket.accept(subprotocol=subprotocol)

    vnc_host = os.environ.get("VNC_HOST", "127.0.0.1").strip() or "127.0.0.1"
    try:
        vnc_port = int(os.environ.get("VNC_PORT", "5900"))
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(vnc_host, vnc_port), timeout=5
        )
    except (OSError, ValueError, asyncio.TimeoutError):
        await websocket.close(code=1013, reason="Browser desktop is not ready")
        return

    async def websocket_to_vnc() -> None:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            payload = message.get("bytes")
            if payload is None and message.get("text") is not None:
                payload = base64.b64decode(message["text"], validate=True)
            if payload:
                writer.write(payload)
                await writer.drain()

    async def vnc_to_websocket() -> None:
        while True:
            payload = await reader.read(65536)
            if not payload:
                return
            await websocket.send_bytes(payload)

    tasks = {
        asyncio.create_task(websocket_to_vnc()),
        asyncio.create_task(vnc_to_websocket()),
    }
    try:
        _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    except (WebSocketDisconnect, OSError, ValueError):
        pass
    finally:
        writer.close()
        with contextlib.suppress(OSError, RuntimeError):
            await writer.wait_closed()


@router.get("/browser-debug", include_in_schema=False)
def browser_debug_redirect() -> Response:
    if not browser_debug_enabled():
        return JSONResponse(status_code=404, content={"detail": "Browser debug desktop is disabled"})
    return RedirectResponse("/browser-debug/vnc.html")


@router.get("/browser-debug/{asset_path:path}", include_in_schema=False)
def browser_debug_asset(asset_path: str) -> Response:
    if not browser_debug_enabled():
        return JSONResponse(status_code=404, content={"detail": "Browser debug desktop is disabled"})
    asset = resolve_novnc_asset(asset_path, novnc_root())
    if asset is None:
        return JSONResponse(status_code=404, content={"detail": "noVNC asset not found"})
    return FileResponse(asset, headers={"Cache-Control": "no-cache"})
