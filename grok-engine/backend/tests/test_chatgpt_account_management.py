from __future__ import annotations

import json
import os
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
                    "mercuryPaymentMethods": ["apple_pay", "paypal", "gcash", "gopay"],
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
            self.assertEqual(
                listed["accounts"][0]["payment_methods"],
                ["apple_pay", "paypal", "gcash", "gopay"],
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

    def test_account_list_is_filtered_paginated_and_newest_first(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = Path(temp_dir)
            fixtures = [
                ("old.json", "old@gmail.com", 1000, "eligible", "oaics", ["paypal"]),
                ("middle.json", "middle@outlook.com", 2000, "unknown", "unknown", []),
                ("new.json", "new@gmail.com", 3000, "ineligible", "cs_live", ["apple_pay"]),
            ]
            for name, email, modified, plus_status, checkout_kind, methods in fixtures:
                path = store / name
                path.write_text(
                    json.dumps({
                        "accessToken": f"token-{name}",
                        "user": {"email": email},
                        "mercuryPlusTrialEligibility": {"status": plus_status},
                        "mercuryCheckoutProbe": {"kind": checkout_kind},
                        "mercuryPaymentMethods": methods,
                    }),
                    encoding="utf-8",
                )
                os.utime(path, (modified, modified))
            ctx = SimpleNamespace(CHATGPT_SESSIONS_DIR=store, json=json)

            first_page = operations.list_registration_accounts(
                ctx, page=1, page_size=2
            )
            self.assertEqual(first_page["total"], 3)
            self.assertEqual(first_page["pages"], 2)
            self.assertEqual(first_page["page"], 1)
            self.assertEqual(
                [item["email"] for item in first_page["accounts"]],
                ["new@gmail.com", "middle@outlook.com"],
            )
            second_page = operations.list_registration_accounts(
                ctx, page=2, page_size=2
            )
            self.assertEqual(second_page["page"], 2)
            self.assertEqual(
                [item["email"] for item in second_page["accounts"]],
                ["old@gmail.com"],
            )

            filtered = operations.list_registration_accounts(
                ctx,
                page=1,
                page_size=20,
                mail_type="gmail",
                payment_method="paypal",
            )
            self.assertEqual(filtered["total"], 1)
            self.assertEqual(filtered["accounts"][0]["email"], "old@gmail.com")
            self.assertEqual(filtered["summary"]["total"], 3)
            self.assertEqual(filtered["summary"]["plus_trial_eligible"], 1)


if __name__ == "__main__":
    unittest.main()
