from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import hotmail_local  # noqa: E402
import mercury_mail  # noqa: E402


class HotmailPoolActionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.accounts_file = Path(self.temp_dir.name) / "hotmail_accounts.json"
        self.management_file = Path(self.temp_dir.name) / "microsoft-mail-accounts.json"
        self.file_patch = patch.object(hotmail_local, "ACCOUNTS_FILE", self.accounts_file)
        self.management_file_patch = patch.object(mercury_mail, "ACCOUNTS_FILE", self.management_file)
        self.file_patch.start()
        self.management_file_patch.start()
        hotmail_local._reservations.clear()
        hotmail_local._openai_reservations.clear()
        hotmail_local._verification_states.clear()

    def tearDown(self) -> None:
        hotmail_local._reservations.clear()
        hotmail_local._openai_reservations.clear()
        hotmail_local._verification_states.clear()
        self.file_patch.stop()
        self.management_file_patch.stop()
        self.temp_dir.cleanup()

    def save(self, accounts: list[dict]) -> None:
        self.accounts_file.write_text(json.dumps(accounts), encoding="utf-8")

    def load(self) -> list[dict]:
        return json.loads(self.accounts_file.read_text(encoding="utf-8"))

    def test_restore_uses_releases_failed_slots_before_successful_slots(self) -> None:
        self.save([{
            "id": "mail-1",
            "email": "tester@example.com",
            "used_aliases": [0, 1],
            "failed_aliases": [2],
            "use_count": 2,
            "used": True,
        }])

        restored = hotmail_local.restore_uses("mail-1", 2)

        self.assertEqual(restored, 2)
        account = self.load()[0]
        self.assertEqual(account["failed_aliases"], [])
        self.assertEqual(account["used_aliases"], [0])
        self.assertEqual(account["use_count"], 1)
        self.assertFalse(account["used"])

    def test_delete_accounts_skips_reserved_and_reports_missing(self) -> None:
        self.save([
            {"id": "mail-1", "email": "one@example.com"},
            {"id": "mail-2", "email": "two@example.com"},
        ])
        hotmail_local._reservations["mail-2"] = {0}

        result = hotmail_local.delete_accounts(["mail-1", "mail-2", "missing"])

        self.assertEqual(result, {"deleted": 1, "skipped_reserved": 1, "missing": 1})
        self.assertEqual([item["id"] for item in self.load()], ["mail-2"])

    def test_mail_management_source_syncs_usage_and_filters_manual_pool(self) -> None:
        self.management_file.write_text(json.dumps([{
            "accountId": 7,
            "email": "managed@example.com",
            "clientId": "managed-client",
            "refreshToken": "managed-token",
            "status": "0",
        }]), encoding="utf-8")
        self.save([{
            "id": "manual-1",
            "email": "manual@example.com",
            "client_id": "manual-client",
            "refresh_token": "manual-token",
            "sources": ["manual"],
            "used_aliases": [],
            "failed_aliases": [],
        }])

        managed_pool = hotmail_local.list_accounts("mail_management")
        manual_pool = hotmail_local.list_accounts("manual")

        self.assertEqual(managed_pool["total"], 1)
        self.assertEqual(managed_pool["accounts"][0]["email"], "managed@example.com")
        self.assertEqual(manual_pool["total"], 1)
        self.assertEqual(manual_pool["accounts"][0]["email"], "manual@example.com")

        reserved = hotmail_local.reserve_account(account_source="mail_management")
        hotmail_local.mark_failed(reserved["id"], "page timeout", reserved["alias_index"])
        managed = json.loads(self.management_file.read_text(encoding="utf-8"))[0]
        self.assertEqual(managed["registrationUseCount"], 1)
        self.assertEqual(managed["status"], "2")

        self.assertEqual(hotmail_local.restore_uses(reserved["id"], 1), 1)
        managed = json.loads(self.management_file.read_text(encoding="utf-8"))[0]
        self.assertEqual(managed["registrationUseCount"], 0)
        self.assertEqual(managed["status"], "0")

        self.assertTrue(hotmail_local.set_used(reserved["id"], True))
        managed = json.loads(self.management_file.read_text(encoding="utf-8"))[0]
        self.assertEqual(managed["registrationUseCount"], 3)
        self.assertEqual(managed["status"], "1")

        openai_reserved = hotmail_local.reserve_account(
            account_source="mail_management", registration_target="chatgpt"
        )
        self.assertTrue(hotmail_local.mark_used(
            openai_reserved["id"],
            openai_reserved["alias_index"],
            registration_target="chatgpt",
        ))
        managed = json.loads(self.management_file.read_text(encoding="utf-8"))[0]
        self.assertEqual(managed["registrationUseCount"], 3)
        self.assertEqual(managed["openaiRegistrationUseCount"], 1)
        self.assertTrue(managed["openaiRegistrationUsed"])

    def test_grok_and_openai_usage_are_independent(self) -> None:
        self.save([{
            "id": "mail-1",
            "email": "tester@example.com",
            "client_id": "client",
            "refresh_token": "token",
            "used_aliases": [0],
            "failed_aliases": [],
        }])

        grok_pool = hotmail_local.list_accounts("manual", "grok")
        openai_pool = hotmail_local.list_accounts("manual", "chatgpt")
        self.assertEqual(grok_pool["accounts"][0]["use_count"], 1)
        self.assertEqual(grok_pool["accounts"][0]["remaining_uses"], 2)
        self.assertEqual(openai_pool["accounts"][0]["use_count"], 0)
        self.assertEqual(openai_pool["accounts"][0]["remaining_uses"], 1)

        reserved = hotmail_local.reserve_account(
            account_source="manual", registration_target="chatgpt"
        )
        self.assertEqual(reserved["registration_email"], "tester@example.com")
        self.assertTrue(hotmail_local.mark_used(
            reserved["id"],
            reserved["alias_index"],
            registration_target="chatgpt",
        ))

        grok_pool = hotmail_local.list_accounts("manual", "grok")
        openai_pool = hotmail_local.list_accounts("manual", "chatgpt")
        self.assertEqual(grok_pool["accounts"][0]["use_count"], 1)
        self.assertEqual(grok_pool["accounts"][0]["remaining_uses"], 2)
        self.assertEqual(openai_pool["accounts"][0]["use_count"], 1)
        self.assertEqual(openai_pool["accounts"][0]["remaining_uses"], 0)

        self.assertEqual(hotmail_local.restore_uses("mail-1", 1, "chatgpt"), 1)
        openai_pool = hotmail_local.list_accounts("manual", "chatgpt")
        self.assertEqual(openai_pool["accounts"][0]["remaining_uses"], 1)

    def test_openai_failure_does_not_consume_grok_alias(self) -> None:
        self.save([{
            "id": "mail-1",
            "email": "tester@example.com",
            "client_id": "client",
            "refresh_token": "token",
            "used_aliases": [],
            "failed_aliases": [],
        }])
        reserved = hotmail_local.reserve_account(
            account_source="manual", registration_target="chatgpt"
        )
        self.assertTrue(hotmail_local.mark_failed(
            reserved["id"],
            "page timeout",
            reserved["alias_index"],
            registration_target="chatgpt",
        ))

        stored = self.load()[0]
        self.assertEqual(stored["failed_aliases"], [])
        self.assertTrue(stored["openai_failed"])
        self.assertEqual(hotmail_local.list_accounts("manual", "grok")["available"], 3)
        self.assertEqual(hotmail_local.list_accounts("manual", "chatgpt")["available"], 0)


if __name__ == "__main__":
    unittest.main()
