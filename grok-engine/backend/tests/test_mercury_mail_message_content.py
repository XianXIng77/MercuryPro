from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import mercury_mail  # noqa: E402


class MercuryMailMessageContentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.account_snapshot = AsyncMock(return_value={"accessToken": "test-token"})
        self.upstream = AsyncMock()
        for target, replacement in (
            ("_account_snapshot", self.account_snapshot),
            ("_fetch_microsoft_json", self.upstream),
            ("_public_mail_secret", lambda: b"test-public-mail-secret"),
        ):
            patcher = patch.object(mercury_mail, target, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(mercury_mail.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        signed_token = mercury_mail.public_mailbox_link("test-account").removeprefix("/mailbox/")
        self.mailbox_paths = (
            "/api/microsoft/accounts/test-account",
            f"/api/microsoft/public/mailboxes/{signed_token}",
        )

    def test_lists_omit_full_content_and_preserve_preview_and_pagination(self) -> None:
        for capitalized in (False, True):
            def field(name: str) -> str:
                return name[0].upper() + name[1:] if capitalized else name

            message = {
                field("id"): "message-1",
                field("subject"): "Test subject",
                field("bodyPreview"): "Allowed list preview",
                field("body"): {"contentType": "html", "content": "<p>PRIVATE BODY</p>"},
                field("uniqueBody"): {"content": "PRIVATE UNIQUE BODY"},
                field("attachments"): [{"contentBytes": "PRIVATE ATTACHMENT"}],
                field("hasAttachments"): True,
                field("isRead"): False,
            }
            original = {
                field("value"): [message],
                "@odata.nextLink": "https://mail.example.test/messages?skip=20",
                "@odata.count": 21,
            }
            self.upstream.return_value = copy.deepcopy(original)
            expected_message = {
                key: value
                for key, value in message.items()
                if key not in {field("body"), field("uniqueBody"), field("attachments")}
            }
            expected = {**original, field("value"): [expected_message]}

            for mailbox_path in self.mailbox_paths:
                with self.subTest(capitalized=capitalized, mailbox_path=mailbox_path):
                    response = self.client.get(f"{mailbox_path}/messages?top=20")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), {"code": 200, "data": expected})
                    self.assertNotIn("PRIVATE", response.text)
                    self.assertEqual(self.upstream.return_value, original)

    def test_detail_routes_still_return_full_content(self) -> None:
        for body_field in ("body", "Body"):
            message = {
                "id": "message-1",
                body_field: {"contentType": "html", "content": "<p>FULL BODY</p>"},
                "attachments": [{"contentBytes": "FULL ATTACHMENT"}],
            }
            self.upstream.return_value = message
            for mailbox_path in self.mailbox_paths:
                with self.subTest(body_field=body_field, mailbox_path=mailbox_path):
                    response = self.client.get(f"{mailbox_path}/messages/message-1")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), {"code": 200, "data": message})

    def test_empty_lists_keep_response_shape(self) -> None:
        for data in ({"value": []}, {"Value": []}, {}):
            self.upstream.return_value = data
            for mailbox_path in self.mailbox_paths:
                with self.subTest(data=data, mailbox_path=mailbox_path):
                    response = self.client.get(f"{mailbox_path}/messages")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), {"code": 200, "data": data})


if __name__ == "__main__":
    unittest.main()
