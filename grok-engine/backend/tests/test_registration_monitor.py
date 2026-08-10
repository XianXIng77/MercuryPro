from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from grok_registration import monitor  # noqa: E402
from grok_registration.management import _is_cancelled_stopping  # noqa: E402


class RegistrationMonitorTests(unittest.TestCase):
    def test_cancelled_stopping_work_can_be_cleared_after_restart(self) -> None:
        self.assertTrue(
            _is_cancelled_stopping(
                {"status": "stopping", "cancel_requested": True}
            )
        )
        self.assertFalse(
            _is_cancelled_stopping(
                {"status": "stopping", "cancel_requested": False}
            )
        )

    def test_paused_sessions_are_not_counted_as_running(self) -> None:
        sessions = {
            "session-1": {"status": "paused"},
            "session-2": {"status": "paused"},
            "session-3": {"status": "paused"},
        }

        with patch.object(
            monitor.state,
            "_load_reg_sess",
            side_effect=lambda session_id: sessions.get(session_id),
        ):
            stats = monitor.batch_stats(
                list(sessions),
                batch={"status": "paused", "count": 3},
            )

        self.assertEqual(stats["running"], 0)
        self.assertEqual(stats["paused"], 3)
        self.assertEqual(stats["batch_status"], "paused")


if __name__ == "__main__":
    unittest.main()
