from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import app_core  # noqa: E402
from mail_protocols import common  # noqa: E402
from mail_protocols import imap_mail  # noqa: E402


class DomainEmailMailTests(unittest.TestCase):
    def test_normalize_mail_provider_maps_domain_email_to_imap(self) -> None:
        for alias in (
            "domain_email",
            "domain-email",
            "domain_mail",
            "domain_qq",
            "qq_forward",
            "cloudflare_forward",
        ):
            self.assertEqual("imap", common.normalize_mail_provider(alias))
        self.assertEqual(
            "imap",
            common.normalize_mail_provider(
                "domain_email", base_url="imaps://imap.qq.com/INBOX"
            ),
        )

    def test_human_local_part_shape(self) -> None:
        pattern = re.compile(r"^[a-z][a-z0-9._+-]{4,22}[a-z0-9]$")
        seen: set[str] = set()
        for _ in range(300):
            local = imap_mail._human_local_part()
            self.assertRegex(local, pattern)
            self.assertGreaterEqual(len(local), 6)
            self.assertLessEqual(len(local), 24)
            self.assertNotIn(local, seen)
            seen.add(local)

    def test_imap_config_parses_qq_authorization_code(self) -> None:
        config = imap_mail._imap_config(
            "imaps://imap.qq.com/INBOX",
            "123456789@qq.com:0123456789abcdef",
        )
        self.assertEqual("imap.qq.com", config["host"])
        self.assertEqual(993, config["port"])
        self.assertTrue(config["secure"])
        self.assertEqual("123456789@qq.com", config["username"])
        self.assertEqual("0123456789abcdef", config["password"])
        self.assertEqual("INBOX", config["folder"])

    def test_imap_config_requires_username_colon_code(self) -> None:
        with self.assertRaises(ValueError):
            imap_mail._imap_config("imaps://imap.qq.com/INBOX", "just-a-code")

    def test_pick_domain_normalizes_cloudflare_domain(self) -> None:
        self.assertEqual(
            "example.com",
            imap_mail._pick_domain("  @example.com  "),
        )
        with self.assertRaises(ValueError):
            imap_mail._pick_domain("not a domain")

    def test_app_core_composes_imap_key(self) -> None:
        cfg = {
            "domain_email_qq": "123456789@qq.com",
            "domain_email_auth_code": "0123456789abcdef",
        }
        self.assertEqual(
            "123456789@qq.com:0123456789abcdef",
            app_core._domain_email_imap_key(cfg),
        )
        self.assertEqual("", app_core._domain_email_imap_key({"domain_email_qq": "a"}))

    def test_email_module_import_for_message_parsing(self) -> None:
        # 回归测试:imap_mail 内部用 email.message_from_bytes 解析验证码邮件,
        # 模块顶部必须保留 `import email`,否则收到邮件时抛 NameError。
        self.assertTrue(hasattr(imap_mail, "email"))
        raw = (
            b"From: noreply@openai.com\r\n"
            b"To: christian.clark@example.com\r\n"
            b"Subject: Your code is 123456\r\n"
            b"\r\n"
            b"Your verification code is 123456\r\n"
        )
        message = imap_mail.email.message_from_bytes(
            raw, policy=imap_mail.policy.default
        )
        self.assertEqual("Your code is 123456", str(message.get("subject")))

    def test_message_recipients_and_content_parsing(self) -> None:
        raw = (
            b"From: noreply@openai.com\r\n"
            b"To: christian.clark@example.com\r\n"
            b"Subject: Verify your email\r\n"
            b"MIME-Version: 1.0\r\n"
            b"Content-Type: text/plain; charset=utf-8\r\n"
            b"\r\n"
            b"Your verification code is 654321\r\n"
        )
        message = imap_mail.email.message_from_bytes(
            raw, policy=imap_mail.policy.default
        )
        self.assertIn(
            "christian.clark@example.com", imap_mail._message_recipients(message)
        )
        text, _html = imap_mail._message_content(message)
        self.assertIn("654321", text)

    def test_save_config_persists_domain_email_profile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_file = Path(tmp_dir) / "config.json"
            defaults = {
                "mail_provider": "domain_email",
                "mail_provider_configs": {"domain_email": {}},
                "domain_email_domain": "",
                "domain_email_qq": "",
                "domain_email_auth_code": "",
            }

            class FakeContext:
                _config_lock = threading.RLock()
                CONFIG_FILE = config_file
                json = json
                os = os
                DEFAULT_CONFIG = defaults
                CHATGPT_SUB2API_MODELS = ["gpt-test"]

                def _normalize_mail_provider_configs(self, value):
                    return dict(value or {})

                def apply_environment(self, cfg):
                    pass

                def _sync_solver_proxy_file(self, cfg):
                    return 0

            clean = app_core.save_config(
                FakeContext(),
                {
                    "mail_provider": "domain_email",
                    "domain_email_domain": "example.com",
                    "domain_email_qq": "123456789@qq.com",
                    "domain_email_auth_code": "0123456789abcdef",
                },
            )
            self.assertEqual("domain_email", clean["mail_provider"])
            profile = clean["mail_provider_configs"]["domain_email"]
            self.assertEqual("example.com", profile["mail_domain"])
            self.assertEqual("imaps://imap.qq.com/INBOX", profile["mail_base_url"])
            self.assertEqual(
                "123456789@qq.com:0123456789abcdef", profile["mail_api_key"]
            )


if __name__ == "__main__":
    unittest.main()
