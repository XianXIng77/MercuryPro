from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from browser_debug import (  # noqa: E402
    browser_debug_enabled,
    browser_debug_status,
    browser_debug_vnc,
    resolve_novnc_asset,
    same_origin_websocket_allowed,
)


class BrowserDebugHelpersTests(unittest.TestCase):
    def test_viewer_url_does_not_generate_double_slash_websocket_path(self) -> None:
        viewer_url = str(browser_debug_status()["viewer_url"])

        self.assertIn("path=api/browser-debug/vnc", viewer_url)
        self.assertNotIn("path=/api/browser-debug/vnc", viewer_url)

    def test_debug_desktop_requires_explicit_enablement(self) -> None:
        self.assertTrue(browser_debug_enabled({"BROWSER_DEBUG_DESKTOP_ENABLED": "true"}))
        self.assertFalse(browser_debug_enabled({"BROWSER_DEBUG_DESKTOP_ENABLED": "false"}))
        self.assertFalse(browser_debug_enabled({}))

    def test_websocket_only_accepts_same_origin(self) -> None:
        self.assertTrue(
            same_origin_websocket_allowed(
                "https://mercury.example.com", "mercury.example.com"
            )
        )
        self.assertTrue(
            same_origin_websocket_allowed(
                "https://mercury.example.com", "127.0.0.1:9100", "mercury.example.com"
            )
        )
        self.assertFalse(
            same_origin_websocket_allowed(
                "https://attacker.example.com", "mercury.example.com"
            )
        )

    def test_asset_resolution_stays_inside_novnc_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            viewer = root / "vnc.html"
            viewer.write_text("viewer", encoding="utf-8")

            self.assertEqual(viewer, resolve_novnc_asset("vnc.html", root))
            self.assertIsNone(resolve_novnc_asset("../secret.txt", root))


class _Reader:
    async def read(self, _size: int) -> bytes:
        await asyncio.Event().wait()
        return b""


class _Writer:
    def __init__(self) -> None:
        self.payloads: list[bytes] = []
        self.closed = False

    def write(self, payload: bytes) -> None:
        self.payloads.append(payload)

    async def drain(self) -> None:
        return None

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        return None


class _WebSocket:
    headers = {
        "origin": "https://mercury.example.com",
        "host": "mercury.example.com",
    }
    scope = {"subprotocols": ["binary"]}

    def __init__(self) -> None:
        self.accepted_subprotocol: str | None = None
        self.messages = [
            {"type": "websocket.receive", "bytes": b"client-data"},
            {"type": "websocket.disconnect"},
        ]

    async def accept(self, subprotocol: str | None = None) -> None:
        self.accepted_subprotocol = subprotocol

    async def receive(self) -> dict[str, object]:
        return self.messages.pop(0)

    async def send_bytes(self, _payload: bytes) -> None:
        return None

    async def close(self, code: int, reason: str = "") -> None:
        raise AssertionError(f"unexpected close: {code} {reason}")


class BrowserDebugBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_binary_websocket_payload_is_forwarded_to_local_vnc(self) -> None:
        websocket = _WebSocket()
        writer = _Writer()

        with patch.dict("os.environ", {"BROWSER_DEBUG_DESKTOP_ENABLED": "true"}), patch(
            "browser_debug.asyncio.open_connection",
            AsyncMock(return_value=(_Reader(), writer)),
        ):
            await browser_debug_vnc(websocket)  # type: ignore[arg-type]

        self.assertEqual("binary", websocket.accepted_subprotocol)
        self.assertEqual([b"client-data"], writer.payloads)
        self.assertTrue(writer.closed)


if __name__ == "__main__":
    unittest.main()
