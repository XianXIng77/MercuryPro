from __future__ import annotations

import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_registration import worker  # noqa: E402


class RegistrationCancelled(RuntimeError):
    pass


class ChatGPTAccessTokenCompletionTests(unittest.TestCase):
    def test_worker_completes_immediately_after_access_token_is_saved(self) -> None:
        session_id = "cgpt_at_only"
        sessions = {
            session_id: {
                "id": session_id,
                "email": "person@example.com",
                "password": "secret",
                "events": [],
                "_post_registration": {"step_delay_ms": 0},
                "_headless": True,
            }
        }

        def append_event(session, status, message, *, at):
            session.setdefault("events", []).append(
                {"status": status, "message": message, "at": at}
            )

        ctx = SimpleNamespace(
            _lock=threading.RLock(),
            _sessions=sessions,
            _session_cancel_requested=lambda _session: False,
            _RegCancelled=RegistrationCancelled,
            _now=time.time,
            _append_session_event=append_event,
            _proxy_for_browser=lambda proxy: {"server": proxy},
            _save_original_chatgpt_session=lambda data, **_kwargs: "saved/session.json",
            threading=threading,
            time=time,
        )
        browser_module = SimpleNamespace(
            register_chatgpt_account=lambda **_kwargs: {
                "ok": True,
                "session": {"accessToken": "test-access-token"},
                "steps": [{"step": "password", "status": "submitted"}],
                "plus_trial": {
                    "status": "eligible",
                    "eligible": True,
                    "reason": "今日应付金额为 0",
                },
            }
        )

        with patch.dict(sys.modules, {"chatgpt_browser": browser_module}):
            worker._run_registration(ctx, session_id, "", SimpleNamespace())

        result = sessions[session_id]
        self.assertEqual("completed", result["status"])
        self.assertEqual("test-access-token", result["session_data"]["accessToken"])
        self.assertEqual(
            "eligible",
            result["session_data"]["mercuryPlusTrialEligibility"]["status"],
        )
        self.assertEqual("eligible", result["plus_trial"]["status"])
        self.assertEqual(
            "secret", result["session_data"]["mercuryRegistrationPassword"]
        )
        self.assertIn("Plus 试用资格：有资格", result["message"])
        self.assertEqual("saved/session.json", result["session_file"])
        self.assertTrue(result["auto_import"]["skipped"])
        self.assertEqual("access_token_only", result["auto_import"]["reason"])

    def test_worker_no_longer_runs_agent_identity_or_site_import(self) -> None:
        source = (BACKEND_DIR / "chatgpt_registration" / "worker.py").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("chatgpt_session_to_auth", source)
        self.assertNotIn("import_account(auth_payload", source)
        self.assertNotIn("正在注册 Codex Agent Identity", source)

    def test_browser_flow_handles_accept_all_cookie_dialog(self) -> None:
        source = (BACKEND_DIR / "chatgpt_browser_registration.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("cookie-policy-manage-dialog-accept-button", source)
        self.assertIn('action_pattern("cookie_accept_all")', source)
        self.assertIn('"cookie_consent", "detected"', source)
        self.assertIn('"unsupported",\n                language=detected_language', source)
        self.assertIn('_step("cookie_consent", "accepted", language=language)', source)


if __name__ == "__main__":
    unittest.main()
