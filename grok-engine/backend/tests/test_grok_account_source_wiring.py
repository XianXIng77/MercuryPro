from __future__ import annotations

import inspect
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import grok_build_adapter as adapter  # noqa: E402


class GrokAccountSourceWiringTests(unittest.TestCase):
    def test_all_registration_wrappers_accept_account_source(self) -> None:
        for name in (
            "start_registration",
            "_spawn_batch_runner",
            "_prepare_registration_session",
            "_start_one_registration",
            "_make_email_receiver",
        ):
            self.assertIn(
                "hotmail_account_source",
                inspect.signature(getattr(adapter, name)).parameters,
                name,
            )

    def test_start_registration_forwards_account_source(self) -> None:
        with patch.object(adapter._flow, "start_registration", return_value={"ok": True}) as mocked:
            result = adapter.start_registration(hotmail_account_source="manual")

        self.assertTrue(result["ok"])
        self.assertEqual(mocked.call_args.kwargs["hotmail_account_source"], "manual")

    def test_worker_wrappers_forward_account_source(self) -> None:
        with patch.object(adapter._flow, "_prepare_registration_session", return_value={"ok": True}) as prepared:
            adapter._prepare_registration_session(
                yescaptcha_key="",
                proxy="",
                hotmail_account_source="mail_management",
            )
        self.assertEqual(
            prepared.call_args.kwargs["hotmail_account_source"], "mail_management"
        )

        with patch.object(adapter._batch, "_spawn_batch_runner", return_value={"ok": True}) as spawned:
            adapter._spawn_batch_runner(
                "batch-test",
                remaining=1,
                concurrency=1,
                stagger_ms=0,
                captcha_provider="browser",
                yescaptcha_key="",
                proxy="",
                moemail_api_key=None,
                moemail_base_url=None,
                prefix=None,
                domain=None,
                expiry_ms=None,
                hotmail_account_source="mail_management",
            )
        self.assertEqual(
            spawned.call_args.kwargs["hotmail_account_source"], "mail_management"
        )


if __name__ == "__main__":
    unittest.main()
