from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_registration import operations  # noqa: E402


class ChatGPTAccountManagementTests(unittest.TestCase):
    def test_saved_accounts_hide_tokens_until_explicit_copy(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = Path(temp_dir)
            (store / "account.json").write_text(
                json.dumps({
                    "accessToken": "saved-access-token",
                    "user": {"email": "tester@example.com"},
                    "mercuryPlusTrialEligibility": {
                        "status": "eligible",
                        "eligible": True,
                        "reason": "今日应付金额为 0",
                    },
                    "mercuryCheckoutProbe": {
                        "status": "detected",
                        "kind": "oaics",
                        "reason": "检测到 oaics checkout",
                    },
                    "mercuryRegistrationPassword": "OpenAI-secret-123!",
                }),
                encoding="utf-8",
            )
            ctx = SimpleNamespace(CHATGPT_SESSIONS_DIR=store, json=json)

            listed = operations.list_registration_accounts(ctx)
            self.assertEqual(listed["total"], 1)
            self.assertEqual(listed["accounts"][0]["email"], "tester@example.com")
            self.assertEqual(
                listed["accounts"][0]["plus_trial"]["status"], "eligible"
            )
            self.assertEqual(
                listed["accounts"][0]["checkout_probe"]["kind"], "oaics"
            )
            self.assertNotIn("access_token", listed["accounts"][0])
            self.assertTrue(listed["accounts"][0]["password_available"])
            self.assertEqual(
                listed["accounts"][0]["password"], "OpenAI-secret-123!"
            )

            copied = operations.get_registration_access_tokens(
                ctx, ["account.json"], False
            )
            self.assertEqual(copied["total"], 1)
            self.assertEqual(copied["tokens"][0]["access_token"], "saved-access-token")

    def test_old_saved_account_without_password_reports_empty_password(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = Path(temp_dir)
            (store / "legacy.json").write_text(
                json.dumps(
                    {
                        "accessToken": "legacy-token",
                        "user": {"email": "legacy@example.com"},
                    }
                ),
                encoding="utf-8",
            )
            ctx = SimpleNamespace(CHATGPT_SESSIONS_DIR=store, json=json)

            account = operations.list_registration_accounts(ctx)["accounts"][0]

            self.assertFalse(account["password_available"])
            self.assertEqual(account["password"], "")
            self.assertEqual(account["checkout_probe"]["kind"], "unknown")


if __name__ == "__main__":
    unittest.main()
