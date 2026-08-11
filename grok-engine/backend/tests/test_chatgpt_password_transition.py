from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_browser_registration import _wait_for_password_transition  # noqa: E402


class _FakePage:
    def __init__(self) -> None:
        self.waits = 0

    def wait_for_timeout(self, _milliseconds: int) -> None:
        self.waits += 1


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


if __name__ == "__main__":
    unittest.main()
