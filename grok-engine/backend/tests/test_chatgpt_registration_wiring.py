from __future__ import annotations

import json
import os
import sys
import threading
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import app_core  # noqa: E402
import chatgpt_build_adapter  # noqa: E402
from chatgpt_registration import flow, operations  # noqa: E402


class ChatGPTRegistrationWiringTests(unittest.TestCase):
    def test_prepare_session_uses_selected_mailbox_source(self) -> None:
        captured: dict[str, object] = {}
        receiver = SimpleNamespace(account_id="mail-1", alias_index=0)

        def make_receiver(**kwargs):
            captured.update(kwargs)
            return "person@example.com", receiver

        ctx = SimpleNamespace(
            time=SimpleNamespace(sleep=lambda _seconds: None),
            _make_email_receiver=make_receiver,
            os=os,
            uuid=uuid,
            _now=lambda: 123.0,
            CHATGPT_ADAPTER_BUILD="test",
            _lock=threading.RLock(),
            _sessions={},
            _batches={},
            _compact_session=lambda session: dict(session),
        )

        result = flow._prepare_registration_session(
            ctx,
            proxy="",
            mail_provider="hotmail_local",
            hotmail_account_source="mail_management",
        )

        self.assertTrue(result["ok"])
        self.assertEqual("mail_management", captured["hotmail_account_source"])
        self.assertEqual("chatgpt", result["registration_target"])

    def test_access_token_is_hidden_until_explicit_request(self) -> None:
        raw = {
            "id": "cgpt_test",
            "email": "person@example.com",
            "session_data": {"accessToken": "secret-at"},
        }
        compact = chatgpt_build_adapter._compact_session(raw)
        self.assertNotIn("session_data", compact)
        self.assertNotIn("access_token", compact)
        self.assertTrue(compact["access_token_available"])

        ctx = SimpleNamespace(
            _lock=threading.RLock(),
            _sessions={"cgpt_test": raw},
            _session_data_for=lambda session: session.get("session_data") or {},
        )
        result = operations.get_registration_access_token(ctx, "cgpt_test")
        self.assertTrue(result["ok"])
        self.assertEqual("secret-at", result["access_token"])

    def test_load_config_preserves_chatgpt_target(self) -> None:
        config_file = Path(self.id().replace(".", "_") + ".json")
        try:
            config_file.write_text(
                json.dumps({"registration_target": "chatgpt"}), encoding="utf-8"
            )
            defaults = {
                "registration_target": "grok",
                "registration_mode": "browser",
                "mail_provider": "hotmail_local",
                "hotmail_account_source": "mail_management",
                "mail_provider_configs": {},
                "registration_json_format": "cpa",
                "auto_import_target": "cpa",
                "concurrency": 1,
                "probe_concurrency": 1,
                "import_concurrency": 1,
                "chatgpt_headless": True,
                "grok_headless": True,
            }
            ctx = SimpleNamespace(
                _config_lock=threading.RLock(),
                DEFAULT_CONFIG=defaults,
                CONFIG_FILE=config_file,
                json=json,
                os=os,
                _normalize_mail_provider_configs=lambda value: dict(value or {}),
                CHATGPT_SUB2API_MODELS=["gpt-test"],
            )
            loaded = app_core.load_config(ctx)
            self.assertEqual("chatgpt", loaded["registration_target"])
        finally:
            config_file.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
