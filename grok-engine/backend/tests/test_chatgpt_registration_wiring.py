from __future__ import annotations

import json
import os
import sys
import threading
import traceback
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import app_core  # noqa: E402
import chatgpt_browser  # noqa: E402
import chatgpt_build_adapter  # noqa: E402
from chatgpt_registration import flow, operations, worker  # noqa: E402


class ChatGPTRegistrationWiringTests(unittest.TestCase):
    def test_browser_context_exposes_traceback_for_exception_reporting(self) -> None:
        self.assertIs(traceback, chatgpt_browser._browser_context().traceback)

    def test_authenticated_proxy_is_split_for_camoufox(self) -> None:
        proxy_urls = chatgpt_build_adapter._proxy_pool(
            "us.1024proxy.io:3000:user-region-DE-sid-Test123-t-5:secret"
        )

        self.assertEqual(1, len(proxy_urls))
        self.assertEqual(
            {
                "server": "http://us.1024proxy.io:3000",
                "username": "user-region-DE-sid-Test123-t-5",
                "password": "secret",
            },
            chatgpt_build_adapter._proxy_for_browser(proxy_urls[0]),
        )

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

    def test_checkout_proxy_pool_rotates_by_batch_index(self) -> None:
        captured: dict[str, object] = {}

        def pick(pool, *, strategy, index):
            captured.update(pool=pool, strategy=strategy, index=index)
            return pool[index % len(pool)]

        ctx = SimpleNamespace(
            _proxy_pool=lambda text, **_kwargs: text.splitlines(),
            _pick_proxy_from_pool=pick,
        )
        selected = worker._pick_checkout_proxy(
            ctx,
            {
                "checkout_probe_enabled": True,
                "checkout_proxy": "proxy-a\nproxy-b",
                "checkout_proxy_strategy": "round_robin",
            },
            {"batch_index": 2},
        )

        self.assertEqual("proxy-b", selected)
        self.assertEqual("round_robin", captured["strategy"])
        self.assertEqual(1, captured["index"])

    def test_checkout_proxy_pool_strategy_reaches_registration_pipeline(self) -> None:
        pipeline = app_core._post_registration_config(
            SimpleNamespace(CHATGPT_SUB2API_MODELS=[]),
            {
                "registration_target": "chatgpt",
                "chatgpt_checkout_probe_enabled": True,
                "chatgpt_checkout_proxy": "proxy-a\nproxy-b",
                "chatgpt_checkout_proxy_strategy": "random",
                "concurrency": 1,
                "probe_concurrency": 1,
                "import_concurrency": 1,
            },
        )

        self.assertTrue(pipeline["checkout_probe_enabled"])
        self.assertEqual("proxy-a\nproxy-b", pipeline["checkout_proxy"])
        self.assertEqual("random", pipeline["checkout_proxy_strategy"])

    def test_disabled_checkout_probe_does_not_resolve_proxy(self) -> None:
        ctx = SimpleNamespace(
            _proxy_pool=lambda *_args, **_kwargs: self.fail(
                "disabled checkout probe must not read its proxy pool"
            )
        )

        self.assertEqual(
            "",
            worker._pick_checkout_proxy(
                ctx,
                {"checkout_probe_enabled": False, "checkout_proxy": ""},
                {},
            ),
        )


if __name__ == "__main__":
    unittest.main()
