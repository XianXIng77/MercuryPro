from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import mercury_auth  # noqa: E402


class MercuryAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.users_file = Path(self.temp_dir.name) / "users.json"
        self.secret_file = Path(self.temp_dir.name) / "jwt-secret.txt"
        self.users_patch = patch.object(mercury_auth, "USERS_FILE", self.users_file)
        self.data_patch = patch.object(mercury_auth, "DATA_DIRECTORY", Path(self.temp_dir.name))
        self.users_patch.start()
        self.data_patch.start()
        mercury_auth.reset_runtime_state(secret="unit-test-secret-0123456789abcdef0123456789")

    def tearDown(self) -> None:
        self.users_patch.stop()
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def save_users(self, users: list[dict]) -> None:
        self.users_file.write_text(
            __import__("json").dumps(users, ensure_ascii=False), encoding="utf-8"
        )

    def load_users(self) -> list[dict]:
        return __import__("json").loads(self.users_file.read_text(encoding="utf-8"))

    def test_default_admin_is_created_when_missing(self) -> None:
        mercury_auth.ensure_default_admin()

        users = self.load_users()
        self.assertEqual(len(users), 1)
        self.assertEqual(users[0]["email"], mercury_auth.DEFAULT_ADMIN_EMAIL)
        self.assertEqual(users[0]["role"], "admin")
        # 密码明文不落盘
        self.assertNotIn(mercury_auth.DEFAULT_ADMIN_PASSWORD, self.users_file.read_text(encoding="utf-8"))
        self.assertTrue(
            mercury_auth.verify_password(mercury_auth.DEFAULT_ADMIN_PASSWORD, users[0]["passwordHash"])
        )

    def test_default_admin_is_idempotent(self) -> None:
        mercury_auth.ensure_default_admin()
        first = self.load_users()
        mercury_auth.ensure_default_admin()

        self.assertEqual(len(self.load_users()), 1)
        self.assertEqual(self.load_users()[0]["passwordHash"], first[0]["passwordHash"])

    def test_find_user_is_case_insensitive(self) -> None:
        self.save_users([{"email": "M@XianXing.art", "username": "管理员", "role": "admin", "passwordHash": "x"}])

        self.assertIsNotNone(mercury_auth._find_user("m@xianxing.art"))
        self.assertIsNone(mercury_auth._find_user("other@xianxing.art"))

    def test_issue_and_verify_session_roundtrip(self) -> None:
        self.save_users([{
            "email": "m@xianxing.art",
            "username": "管理员",
            "role": "admin",
            "passwordHash": mercury_auth.hash_password("xianxing1"),
        }])
        response = _FakeResponse()
        user = mercury_auth._find_user("m@xianxing.art")

        mercury_auth.issue_session(response, user, remember=True)

        self.assertEqual(len(response.cookies), 1)
        cookie_name, cookie_value = response.cookies[0]
        self.assertEqual(cookie_name, mercury_auth.SESSION_COOKIE_NAME)
        token = cookie_value
        request = _FakeRequest({mercury_auth.SESSION_COOKIE_NAME: token})
        resolved = mercury_auth.get_current_user(request)
        self.assertEqual(resolved["email"], "m@xianxing.art")
        self.assertEqual(resolved["role"], "admin")

    def test_get_current_user_rejects_missing_cookie(self) -> None:
        with self.assertRaises(Exception):
            mercury_auth.get_current_user(_FakeRequest({}))

    def test_get_current_user_rejects_garbage_token(self) -> None:
        request = _FakeRequest({mercury_auth.SESSION_COOKIE_NAME: "not-a-jwt"})
        with self.assertRaises(Exception):
            mercury_auth.get_current_user(request)

    def test_register_route_creates_user_and_issues_session(self) -> None:
        import asyncio

        response = _FakeResponse()
        payload = mercury_auth.AuthCredentials(
            email="newbie@example.com", password="password123", username="新人"
        )

        result = asyncio.run(mercury_auth.register(payload, response))

        self.assertEqual(result["user"]["email"], "newbie@example.com")
        self.assertEqual(result["user"]["username"], "新人")
        self.assertEqual(result["user"]["role"], "user")
        users = self.load_users()
        self.assertEqual(len(users), 1)
        self.assertTrue(mercury_auth.verify_password("password123", users[0]["passwordHash"]))
        self.assertEqual(len(response.cookies), 1)

    def test_register_route_rejects_duplicate_email(self) -> None:
        import asyncio

        self.save_users([{"email": "dup@example.com", "username": "dup", "role": "user", "passwordHash": "x"}])
        payload = mercury_auth.AuthCredentials(
            email="dup@example.com", password="password123", username="dup2"
        )

        with self.assertRaises(mercury_auth.AuthError) as ctx:
            asyncio.run(mercury_auth.register(payload, _FakeResponse()))

        self.assertEqual(ctx.exception.status_code, 409)

    def test_login_route_rejects_wrong_password(self) -> None:
        import asyncio

        self.save_users([{
            "email": "m@xianxing.art",
            "username": "管理员",
            "role": "admin",
            "passwordHash": mercury_auth.hash_password("xianxing1"),
        }])
        payload = mercury_auth.AuthCredentials(
            email="m@xianxing.art", password="wrongpass1"
        )

        with self.assertRaises(mercury_auth.AuthError) as ctx:
            asyncio.run(mercury_auth.login(payload, _FakeResponse()))

        self.assertEqual(ctx.exception.status_code, 401)


class _FakeResponse:
    def __init__(self) -> None:
        self.cookies: list[tuple[str, str]] = []

    def set_cookie(self, name: str, value: str, **kwargs) -> None:
        self.cookies.append((name, value))

    def delete_cookie(self, name: str, path: str = "/") -> None:
        self.cookies = [(n, v) for n, v in self.cookies if n != name]


class _FakeRequest:
    def __init__(self, cookies: dict[str, str]) -> None:
        self.cookies = cookies
