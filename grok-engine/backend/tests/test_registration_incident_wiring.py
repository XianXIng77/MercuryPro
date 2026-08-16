from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_registration import diagnostics  # noqa: E402


class RegistrationDiagnosticsWiringTests(unittest.TestCase):
    """The registration flow must persist incidents for all three triggers."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.flow_source = (
            BACKEND_DIR / "chatgpt_browser_registration.py"
        ).read_text(encoding="utf-8")
        cls.worker_source = (
            BACKEND_DIR / "chatgpt_registration" / "worker.py"
        ).read_text(encoding="utf-8")

    def test_plus_trial_check_persists_incident(self) -> None:
        self.assertIn('stage="plus-trial"', self.flow_source)
        # Captured right after the plus-trial step is recorded
        self.assertLess(
            self.flow_source.index('stage="plus-trial"'),
            self.flow_source.index('if checkout_probe_enabled:'),
        )

    def test_checkout_kind_check_persists_incident(self) -> None:
        self.assertIn('stage="checkout-kind"', self.flow_source)
        self.assertIn("checkout_proxy_configured", self.flow_source)

    def test_registration_error_and_exception_persist_incident(self) -> None:
        self.assertEqual(
            2, self.flow_source.count('stage="registration-error"')
        )
        # Captured before the visible-page hold call so the page is still
        # alive for the screenshot (rindex points at the last exception
        # block, skipping the _hold_visible_failure definition earlier on).
        self.assertLess(
            self.flow_source.rindex('stage="registration-error"'),
            self.flow_source.rindex("_hold_visible_failure()"),
        )
        self.assertIn('outcome="exception"', self.flow_source)

    def test_worker_covers_post_browser_failures(self) -> None:
        self.assertIn("session_save_failed", self.worker_source)
        self.assertIn('outcome="worker_exception"', self.worker_source)

    def test_diagnostics_dir_resolves_to_repo_log_folder(self) -> None:
        expected_root = BACKEND_DIR.parent.parent
        self.assertEqual(expected_root, diagnostics._PROJECT_ROOT)
        self.assertEqual(
            expected_root / "log", diagnostics.DEFAULT_LOG_DIR
        )
        self.assertIn("/log", str(diagnostics.DEFAULT_LOG_DIR).replace("\\", "/"))
        self.assertTrue(diagnostics.DEFAULT_LOG_DIR.is_absolute())


if __name__ == "__main__":
    unittest.main()
