from __future__ import annotations

import sys
import tempfile
import unittest
from contextlib import ExitStack
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import mercury_auth  # noqa: E402
import operation_logs  # noqa: E402


class MercuryAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contexts = ExitStack()
        self.addCleanup(self.contexts.close)
        self.temp_dir = tempfile.TemporaryDirectory()
        self.contexts.enter_context(patch.object(operation_logs, "DATA_DIRECTORY", Path(self.temp_dir.name)))
        self.contexts.enter_context(patch.object(operation_logs, "AUDIT_LOG_FILE", Path(self.temp_dir.name) / "audit.jsonl"))
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

        with patch.object(mercury_auth, "use_invite_code", return_value=None):
            result = asyncio.run(mercury_auth.register(payload, response))

        self.assertEqual(result["user"]["email"], "newbie@example.com")
        self.assertEqual(result["user"]["username"], "新人")
        self.assertEqual(result["user"]["role"], "user")
        self.assertEqual([item["key"] for item in result["menus"]], ["dashboard", "email"])
        self.assertEqual(result["permissions"], ["dashboard:view", "email:view"])
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

    def test_access_profile_merges_role_and_user_grants(self) -> None:
        admin_profile = mercury_auth.access_profile({"email": "admin@example.com", "role": "admin"})
        user_profile = mercury_auth.access_profile({
            "email": "user@example.com",
            "role": "user",
            "extraMenus": ["logs"],
            "extraPermissions": ["logs:view"],
        })

        self.assertIn("access", [item["key"] for item in admin_profile["menus"]])
        self.assertNotIn("access", [item["key"] for item in user_profile["menus"]])
        self.assertIn("logs", [item["key"] for item in user_profile["menus"]])
        self.assertIn("logs:view", user_profile["permissions"])
        self.assertEqual(user_profile["roleMenus"], ["dashboard", "email"])

    def test_access_profile_loads_persisted_user_extras_from_public_user(self) -> None:
        self.save_users([{
            "email": "reader@example.com",
            "username": "reader",
            "role": "user",
            "extraMenus": ["logs"],
            "extraPermissions": [],
        }])

        profile = mercury_auth.access_profile({
            "email": "reader@example.com",
            "username": "reader",
            "role": "user",
        })

        self.assertIn("logs", [item["key"] for item in profile["menus"]])
        self.assertIn("logs:view", profile["permissions"])
        self.assertTrue(
            mercury_auth.user_has_permission(
                {"email": "reader@example.com", "role": "user"},
                "logs:view",
            )
        )

    def test_required_permission_for_business_routes(self) -> None:
        required = mercury_auth.required_permission_for_request

        self.assertEqual(required("/api/microsoft/accounts", "GET"), "email:view")
        self.assertEqual(required("/api/microsoft/accounts/import", "POST"), "email:create")
        self.assertEqual(required("/api/microsoft/accounts/140/refresh-token", "POST"), "email:refresh")
        self.assertEqual(required("/api/microsoft/accounts/140", "DELETE"), "email:delete")
        self.assertEqual(required("/api/microsoft/accounts", "DELETE"), "email:delete")
        self.assertEqual(required("/api/microsoft/accounts/140/messages", "GET"), "email:messages")
        self.assertEqual(required("/api/microsoft/accounts/140/messages/msg-1", "GET"), "email:detail")
        self.assertEqual(required("/api/microsoft/public/mailboxes/signed/messages", "GET"), "email:messages")
        self.assertEqual(required("/api/microsoft/public/mailboxes/signed/messages/msg-1", "GET"), "email:detail")
        self.assertEqual(required("/api/grok/register", "POST"), "register:run")
        self.assertEqual(required("/api/grok/config", "PUT"), "register:config")
        self.assertEqual(required("/api/grok/chatgpt/accounts/access-tokens", "POST"), "register:token:read")
        self.assertEqual(required("/api/grok/chatgpt/accounts", "GET"), "register:resource")
        self.assertEqual(required("/api/grok/mail/hotmail/accounts", "GET"), "register:resource")
        self.assertEqual(required("/api/grok/performance", "GET"), "register:view")

        self.assertEqual(required("/api/grok/sessions", "GET"), "register:view")
        self.assertEqual(required("/api/invite-codes", "GET"), "invite:view")
        self.assertEqual(required("/api/invite-codes", "POST"), "invite:create")
        self.assertEqual(required("/api/invite-codes/ABC", "PUT"), "invite:update")
        self.assertEqual(required("/api/invite-codes/ABC", "DELETE"), "invite:delete")
        self.assertEqual(required("/api/logs", "GET"), "logs:view")
        self.assertEqual(required("/api/audit-logs", "GET"), "audit:view")
        self.assertEqual(required("/api/auth/profile", "PUT"), "profile:update")
        self.assertEqual(required("/api/unknown", "GET"), "access:manage")
        self.assertIsNone(required("/api/health/live", "GET"))
    def test_mail_permission_catalog_contains_independent_operations(self) -> None:
        codes = {str(item.get("code")) for item in mercury_auth.PERMISSION_DEFINITIONS}
        self.assertTrue(
            {
                "email:view",
                "email:messages",
                "email:detail",
                "email:refresh",
                "email:create",
                "email:delete",
            }.issubset(codes)
        )
        labels = {
            str(item.get("code")): str(item.get("label"))
            for item in mercury_auth.PERMISSION_DEFINITIONS
        }
        self.assertEqual(labels["email:view"], "查询邮箱")
        self.assertEqual(labels["email:refresh"], "刷新 Token")
        self.assertEqual(labels["email:create"], "新增邮箱")
        self.assertEqual(labels["email:delete"], "删除邮箱")

    def test_menu_grant_does_not_imply_its_view_permission(self) -> None:
        roles = mercury_auth._default_roles()
        roles['user']['menuKeys'] = []
        roles['user']['permissions'] = []
        mercury_auth._save_roles(roles)
        profile = mercury_auth.access_profile({
            "email": "",
            "role": "user",
            "extraMenus": ["logs"],
            "extraPermissions": [],
        })

        self.assertIn("logs", [menu["key"] for menu in profile["menus"]])
        self.assertNotIn("logs:view", profile["permissions"])

    def test_admin_template_permissions_are_enforced_without_locking_access_center(self) -> None:
        roles = mercury_auth._default_roles()
        roles["admin"]["menuKeys"] = []
        roles["admin"]["permissions"] = []
        mercury_auth._save_roles(roles)

        admin = {"email": "admin@example.com", "role": "admin"}
        profile = mercury_auth.access_profile(admin)

        self.assertEqual([item["key"] for item in profile["menus"]], ["access"])
        self.assertEqual(profile["permissions"], ["access:manage"])
        self.assertTrue(mercury_auth.user_has_permission(admin, "access:manage"))
        self.assertFalse(mercury_auth.user_has_permission(admin, "invite:manage"))

    def test_last_admin_cannot_be_demoted(self) -> None:
        import asyncio

        self.save_users([{
            "email": "admin@example.com",
            "username": "admin",
            "role": "admin",
            "passwordHash": "x",
        }])
        payload = mercury_auth.UserAccessPayload(
            role="user",
            extraMenus=[],
            extraPermissions=[],
        )

        with self.assertRaises(mercury_auth.AuthError) as ctx:
            asyncio.run(mercury_auth.update_user_access("admin@example.com", payload))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(self.load_users()[0]["role"], "admin")
    def test_build_user_stats_groups_users_without_exposing_details(self) -> None:
        def timestamp(year: int, month: int, day: int) -> int:
            return int(datetime(year, month, day, 12).timestamp())

        self.save_users([
            {"email": "admin@example.com", "role": "admin", "createdAt": timestamp(2026, 8, 31)},
            {"email": "new@example.com", "role": "user", "createdAt": timestamp(2026, 9, 2)},
            {"email": "previous@example.com", "role": "user", "createdAt": timestamp(2026, 7, 20)},
        ])

        stats = mercury_auth.build_user_stats(today=date(2026, 9, 2))

        self.assertEqual(stats["summary"]["totalUsers"], 3)
        self.assertEqual(stats["summary"]["newUsersLast30Days"], 2)
        self.assertEqual(stats["summary"]["newUsersToday"], 1)
        self.assertEqual(stats["summary"]["growthRate"], 100.0)
        self.assertEqual(len(stats["dailyRegistrations"]), 30)
        self.assertEqual(len(stats["weeklyRegistrations"]), 8)
        self.assertEqual(stats["roleDistribution"][0], {"label": "管理员", "count": 1})
        self.assertNotIn("email", str(stats))


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
