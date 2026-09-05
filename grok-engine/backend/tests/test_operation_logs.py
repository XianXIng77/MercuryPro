from __future__ import annotations

import ast
import json
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import mercury_auth
import operation_logs


class OperationAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password_hash = mercury_auth.hash_password("password123")

    def setUp(self):
        self.contexts = ExitStack()
        self.addCleanup(self.contexts.close)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.data = Path(directory.name)
        for module, name, value in (
            (mercury_auth, "DATA_DIRECTORY", self.data),
            (mercury_auth, "USERS_FILE", self.data / "users.json"),
            (mercury_auth, "_secret_key", "audit-test-secret-0123456789abcdef0123456789"),
            (operation_logs, "DATA_DIRECTORY", self.data),
            (operation_logs, "AUDIT_LOG_FILE", self.data / "audit.jsonl"),
        ):
            self.contexts.enter_context(patch.object(module, name, value))
        self.admin = {"email": "admin@example.com", "username": "管理员", "role": "admin", "passwordHash": self.password_hash}
        self.member = {"email": "member@example.com", "username": "成员", "role": "user", "passwordHash": self.password_hash}
        mercury_auth._save_users([self.admin, self.member])
        app = FastAPI()
        app.include_router(mercury_auth.router)
        app.include_router(operation_logs.router)

        @app.get("/api/download")
        async def download():
            return {"ok": True}

        @app.get("/api/solver/detect")
        @app.get("/api/proxy/detect")
        async def detect():
            return {"ok": True}

        @app.put("/api/config")
        async def config():
            return {"ok": True}

        @app.post("/api/register")
        async def start_registration():
            return {"ok": True}

        @app.post("/api/boom")
        async def boom():
            raise RuntimeError("private backend error")

        # Execute the production middleware definitions without importing app.py,
        # which initializes real accounts and registration services on import.
        tree = ast.parse((BACKEND_DIR / "app.py").read_text(encoding="utf-8"))
        nodes = [node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name in {
            "prepare_embedded_services", "enforce_auth_guard", "record_operation_middleware",
        }]
        self.assertEqual(len(nodes), 3)
        namespace = {
            "app": app, "Request": Request, "HTTPException": HTTPException,
            "JSONResponse": JSONResponse, "json": json,
            "get_current_user": mercury_auth.get_current_user,
            "required_permission_for_request": mercury_auth.required_permission_for_request,
            "user_has_permission": mercury_auth.user_has_permission,
            "audit_request": operation_logs.audit_request,
            "ensure_for_path": AsyncMock(), "RuntimeServiceError": RuntimeError,
            "setup_hint": lambda exc: "test service unavailable",
        }
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "app.py", "exec"), namespace)
        self.runtime = namespace["ensure_for_path"]
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)
        self.authenticate(self.admin)

    def authenticate(self, user):
        response = JSONResponse({})
        mercury_auth.issue_session(response, user, remember=False)
        cookie = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
        self.client.cookies.set(mercury_auth.SESSION_COOKIE_NAME, cookie)

    def assert_record(self, response, status, action, module):
        self.assertEqual(response.status_code, status, response.text)
        records = operation_logs._read_records()
        self.assertEqual(len(records), 1, records)
        record = records[0]
        self.assertEqual((record["action"], record["module"], record["statusCode"]), (action, module, status))
        self.assertEqual(record["status"], "成功" if status < 400 else "失败")
        raw = json.dumps(record, ensure_ascii=False)
        for secret in ("password123", "next-password", self.password_hash, "private backend error"):
            self.assertNotIn(secret, raw)
        return record

    def clear_records(self):
        operation_logs.AUDIT_LOG_FILE.unlink(missing_ok=True)

    def test_profile_success_is_not_duplicated(self):
        response = self.client.put("/api/auth/profile", json={"username": "新名字"})
        record = self.assert_record(response, 200, "修改个人资料", "个人中心")
        self.assertEqual(record["user"], "新名字")
        self.assertEqual(record["email"], self.admin["email"])

    def test_profile_validation_and_avatar_failure(self):
        for payload, status in (({"username": ""}, 422), ({"username": "测试", "avatar": "not-an-image"}, 400)):
            with self.subTest(payload=payload):
                self.clear_records()
                self.assert_record(self.client.put("/api/auth/profile", json=payload), status, "修改个人资料", "个人中心")

    def test_password_success_and_all_failure_branches(self):
        cases = [("wrong", "next-password", 400), ("password123", "password123", 400), ("password123", "short", 422), ("password123", "next-password", 200)]
        for current, new, status in cases:
            with self.subTest(status=status, new_length=len(new)):
                self.clear_records()
                response = self.client.put("/api/auth/password", json={"currentPassword": current, "newPassword": new})
                self.assert_record(response, status, "修改密码", "个人中心")

    def test_user_access_records_actor_target_and_changes(self):
        response = self.client.put("/api/auth/access/users/member@example.com", json={"role": "user", "extraMenus": ["register"]})
        record = self.assert_record(response, 200, "权限变更", "权限中心")
        self.assertEqual(record["email"], "admin@example.com")
        self.assertEqual(record["risk"], "高风险")
        self.assertIn("member@example.com", record["detail"])
        self.assertIn('"before"', record["detail"])
        self.assertIn('"after"', record["detail"])
        self.assertIn("register:view", record["detail"])

    def test_role_access_records_effective_permissions(self):
        response = self.client.put("/api/auth/access/roles/user", json={"key": "user", "label": "成员", "menuKeys": ["email"]})
        record = self.assert_record(response, 200, "权限变更", "权限中心")
        self.assertIn("修改角色授权：user", record["detail"])
        self.assertIn("email:view", record["detail"])

    def test_access_failure_cases(self):
        cases = [("users/admin@example.com", {"role": "user"}, 400), ("users/missing@example.com", {"role": "user"}, 404), ("users/member@example.com", {}, 422), ("roles/user", {"key": "admin", "label": "x"}, 400), ("roles/missing", {"key": "missing", "label": "x"}, 404)]
        for path, payload, status in cases:
            with self.subTest(path=path, status=status):
                self.clear_records()
                self.assert_record(self.client.put("/api/auth/access/" + path, json=payload), status, "权限变更", "权限中心")

    def test_access_forbidden_and_unauthenticated(self):
        self.authenticate(self.member)
        response = self.client.put("/api/auth/access/roles/user", json={"key": "user", "label": "x"})
        record = self.assert_record(response, 403, "权限变更", "权限中心")
        self.assertEqual(record["email"], "member@example.com")
        self.clear_records()
        self.client.cookies.clear()
        self.assert_record(self.client.put("/api/auth/profile", json={"username": "x"}), 401, "修改个人资料", "个人中心")

    def test_login_register_logout_manual_logs_are_not_duplicated(self):
        self.client.cookies.clear()
        with patch.object(mercury_auth, "use_invite_code", return_value=None):
            response = self.client.post("/api/auth/register", json={"email": "new@example.com", "password": "password123"})
        record = self.assert_record(response, 200, "注册", "账户安全")
        self.assertEqual(record["email"], "new@example.com")
        self.clear_records()
        self.assert_record(self.client.post("/api/auth/logout"), 200, "退出登录", "账户安全")
        self.clear_records()
        response = self.client.post("/api/auth/login", json={"email": "admin@example.com", "password": "password123"})
        self.assert_record(response, 200, "登录", "账户安全")

    def test_auth_validation_and_login_failure(self):
        for payload, status in (({}, 422), ({"email": "admin@example.com", "password": "incorrect-password"}, 401)):
            self.clear_records()
            self.assert_record(self.client.post("/api/auth/login", json=payload), status, "登录", "账户安全")

    def test_download_and_legacy_alias(self):
        for path in ("/api/download", "/api/grok/download"):
            self.clear_records()
            self.assert_record(self.client.get(path + "?token=secret-query"), 200, "导出", "注册任务")
            self.assertNotIn("secret-query", operation_logs.AUDIT_LOG_FILE.read_text(encoding="utf-8"))

    def test_explicit_detection_actions(self):
        for path, module in (("/api/solver/detect", "验证服务"), ("/api/grok/proxy/detect", "代理设置")):
            self.clear_records()
            self.assert_record(self.client.get(path), 200, "执行", module)

    def test_guard_failure_is_recorded_before_embedded_services(self):
        self.authenticate(self.member)
        self.assert_record(self.client.put("/api/config", json={}), 403, "修改", "系统配置")
        self.runtime.assert_not_called()

    def test_unhandled_error_records_500(self):
        self.assert_record(self.client.post("/api/boom"), 500, "执行", "工作台")

    def test_embedded_service_failure_is_recorded(self):
        self.runtime.side_effect = RuntimeError("service not available")
        self.assert_record(self.client.post("/api/grok/register", json={}), 503, "执行", "注册任务")

    def test_reads_do_not_create_recursive_or_polling_audits(self):
        for path in ("/api/audit-logs", "/api/auth/me", "/api/auth/access/roles"):
            self.assertEqual(self.client.get(path).status_code, 200)
        self.assertEqual(operation_logs._read_records(), [])

    def test_log_write_failure_does_not_fail_business_operation(self):
        with patch.object(Path, "open", side_effect=OSError("read-only storage")), self.assertLogs(operation_logs.logger, level="ERROR"):
            record = operation_logs.record_operation(request=None, action="执行", status_code=200)
        self.assertEqual(record["status"], "成功")

    def test_credentials_in_paths_are_redacted(self):
        for path in ("/api/microsoft/public/mailboxes/secret-access/refresh-token", "/api/grok/invite-codes/secret-code"):
            request = Request({"type": "http", "method": "POST", "path": path, "headers": [], "query_string": b"secret=query"})
            record = operation_logs.record_operation(request=request, action="执行", status_code=200)
            self.assertNotIn("secret", json.dumps(record))
            self.assertIn("[已隐藏]", record["detail"])

    def test_all_state_changing_routes_have_audit_coverage(self):
        prefixes = {"app.py": "", "mercury_auth.py": "/api/auth", "mercury_mail.py": "/api/microsoft", "mercury_ai.py": "/api/ai", "mercury_logs.py": "/api/logs", "operation_logs.py": "/api/audit-logs", "browser_debug.py": ""}
        count = 0
        for filename, prefix in prefixes.items():
            tree = ast.parse((BACKEND_DIR / filename).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for decorator in node.decorator_list:
                    if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                        continue
                    if decorator.func.attr not in {"post", "put", "patch", "delete"}:
                        continue
                    path = prefix + ast.literal_eval(decorator.args[0])
                    self.assertTrue(operation_logs.should_record_request(decorator.func.attr, path), path)
                    self.assertNotEqual(operation_logs.module_for_path(path), "工作台", path)
                    count += 1
        self.assertGreater(count, 40)


if __name__ == "__main__":
    unittest.main()
