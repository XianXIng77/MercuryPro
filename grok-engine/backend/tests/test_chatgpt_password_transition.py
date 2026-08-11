from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_browser_registration import (  # noqa: E402
    _wait_for_password_transition,
    _wait_for_visible_debug_release,
)


class _FakePage:
    def __init__(self) -> None:
        self.waits = 0

    def wait_for_timeout(self, _milliseconds: int) -> None:
        self.waits += 1


class _DebugPage(_FakePage):
    def __init__(self, close_after: int | None = None) -> None:
        super().__init__()
        self.close_after = close_after

    def is_closed(self) -> bool:
        return self.close_after is not None and self.waits >= self.close_after


class ChatGPTPasswordTransitionTests(unittest.TestCase):
    def test_stale_password_form_waits_for_verification_page(self) -> None:
        states = iter(("new_password", "new_password", "verification"))
        clock = {"value": 0.0}
        page = _FakePage()

        def signup_state(_page):
            clock["value"] += 0.2
            return next(states, "verification")

        ctx = SimpleNamespace(
            time=SimpleNamespace(time=lambda: clock["value"]),
            _signup_state=signup_state,
        )

        state = _wait_for_password_transition(ctx, page, lambda: None, timeout=3)

        self.assertEqual("verification", state)
        self.assertEqual(2, page.waits)

    def test_password_validation_page_can_still_be_retried(self) -> None:
        clock = {"value": 0.0}
        page = _FakePage()

        def signup_state(_page):
            clock["value"] += 0.2
            return "new_password"

        ctx = SimpleNamespace(
            time=SimpleNamespace(time=lambda: clock["value"]),
            _signup_state=signup_state,
        )

        state = _wait_for_password_transition(ctx, page, lambda: None, timeout=1)

        self.assertEqual("new_password", state)
        self.assertGreater(page.waits, 0)

    def test_visible_debug_page_waits_until_task_is_stopped(self) -> None:
        page = _DebugPage()
        checks = {"count": 0}

        def should_cancel() -> bool:
            checks["count"] += 1
            return checks["count"] >= 3

        reason = _wait_for_visible_debug_release(page, should_cancel, poll_ms=50)

        self.assertEqual("task_stopped", reason)
        self.assertEqual(2, page.waits)

    def test_visible_debug_page_can_be_released_by_closing_window(self) -> None:
        page = _DebugPage(close_after=2)

        reason = _wait_for_visible_debug_release(page, lambda: False, poll_ms=50)

        self.assertEqual("window_closed", reason)
        self.assertEqual(2, page.waits)

    def test_direct_visible_call_keeps_twenty_second_style_timeout_fallback(self) -> None:
        page = _DebugPage()

        reason = _wait_for_visible_debug_release(
            page,
            poll_ms=50,
            fallback_timeout_ms=100,
        )

        self.assertEqual("timeout", reason)
        self.assertEqual(2, page.waits)


if __name__ == "__main__":
    unittest.main()
