from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app_routes import (  # noqa: E402
    _browser_debug_desktop_disabled,
    _effective_registration_concurrency,
)


class RegistrationRouteConfigTests(unittest.TestCase):
    def test_disabled_container_debug_desktop_is_detected(self) -> None:
        self.assertTrue(
            _browser_debug_desktop_disabled(
                {
                    "BROWSER_DEBUG_DESKTOP_ENABLED": "false",
                    "DISPLAY": ":99",
                }
            )
        )

    def test_enabled_container_debug_desktop_is_available(self) -> None:
        self.assertFalse(
            _browser_debug_desktop_disabled(
                {
                    "BROWSER_DEBUG_DESKTOP_ENABLED": "true",
                    "DISPLAY": ":99",
                }
            )
        )

    def test_native_desktop_is_not_blocked(self) -> None:
        self.assertFalse(
            _browser_debug_desktop_disabled(
                {
                    "BROWSER_DEBUG_DESKTOP_ENABLED": "false",
                    "DISPLAY": ":0",
                }
            )
        )

    def test_visible_grok_registration_keeps_requested_concurrency(self) -> None:
        actual = _effective_registration_concurrency(
            {"concurrency": 3, "grok_headless": False}, "grok"
        )
        self.assertEqual(3, actual)

    def test_headless_grok_registration_keeps_requested_concurrency(self) -> None:
        actual = _effective_registration_concurrency(
            {"concurrency": 3, "grok_headless": True}, "grok"
        )
        self.assertEqual(3, actual)

    def test_other_targets_are_not_changed(self) -> None:
        actual = _effective_registration_concurrency(
            {"concurrency": 3, "grok_headless": False}, "chatgpt"
        )
        self.assertEqual(3, actual)


if __name__ == "__main__":
    unittest.main()
