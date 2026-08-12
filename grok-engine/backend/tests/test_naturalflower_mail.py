from __future__ import annotations

import unittest

from naturalflower_mail import (
    NaturalflowerMailbox,
    NaturalflowerReceiver,
    naturalflower_mailbox_for_index,
    parse_naturalflower_mailboxes,
)


class _FakeResponse:
    def __init__(self, data, status_code=200):
        self._data = data
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._data


class _FakeClient:
    def __init__(self, routes, **_kwargs):
        self.routes = routes

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def get(self, url, **_kwargs):
        values = self.routes[url]
        value = values.pop(0) if isinstance(values, list) and len(values) > 1 else values[0]
        return _FakeResponse(value)


class NaturalflowerMailboxTests(unittest.TestCase):
    def test_parse_and_select_mailbox_lines(self):
        text = "\n".join(
            (
                "first.user@icloud.com https://pickup.naturalflower.cn/?token=abc.def",
                "second-user@icloud.com https://pickup.naturalflower.cn/p/ghi.jkl",
            )
        )
        entries = parse_naturalflower_mailboxes(text)
        self.assertEqual(2, len(entries))
        self.assertEqual("abc.def", entries[0].token)
        self.assertEqual("second-user@icloud.com", naturalflower_mailbox_for_index(text, 2).email)

    def test_rejects_wrong_host_and_duplicates(self):
        with self.assertRaisesRegex(ValueError, "pickup.naturalflower.cn"):
            parse_naturalflower_mailboxes(
                "first@icloud.com https://example.com/?token=abc"
            )
        with self.assertRaisesRegex(ValueError, "邮箱重复"):
            parse_naturalflower_mailboxes(
                "first@icloud.com https://pickup.naturalflower.cn/?token=abc\n"
                "first@icloud.com https://pickup.naturalflower.cn/?token=def"
            )

    def test_receiver_ignores_existing_mail_and_extracts_new_code(self):
        mailbox = NaturalflowerMailbox(
            "first@icloud.com",
            "https://pickup.naturalflower.cn/?token=abc.def",
            "abc.def",
        )
        api_base = "https://pickup.naturalflower.cn/api/public/mailbox/abc.def"
        routes = {
            api_base: [
                {
                    "email": mailbox.email,
                    "messages": [{"id": 1, "subject": "old"}],
                },
                {
                    "email": mailbox.email,
                    "messages": [
                        {"id": 2, "subject": "OpenAI verification code"},
                        {"id": 1, "subject": "old"},
                    ],
                },
            ],
            f"{api_base}/messages/2": [
                {
                    "subject": "OpenAI verification code",
                    "text_body": "Your verification code is 482913",
                    "sender_address": "noreply@openai.com",
                }
            ],
        }
        receiver = NaturalflowerReceiver(
            mailbox, client_factory=lambda **kwargs: _FakeClient(routes, **kwargs)
        )
        receiver.validate()
        receiver.mark_code_request_started()
        self.assertEqual("482913", receiver.wait_for_code(timeout=1))

    def test_receiver_rejects_mismatched_email(self):
        mailbox = NaturalflowerMailbox(
            "expected@icloud.com",
            "https://pickup.naturalflower.cn/?token=abc",
            "abc",
        )
        api_base = "https://pickup.naturalflower.cn/api/public/mailbox/abc"
        routes = {api_base: [{"email": "other@icloud.com", "messages": []}]}
        receiver = NaturalflowerReceiver(
            mailbox, client_factory=lambda **kwargs: _FakeClient(routes, **kwargs)
        )
        with self.assertRaisesRegex(RuntimeError, "绑定邮箱不一致"):
            receiver.validate()


if __name__ == "__main__":
    unittest.main()
