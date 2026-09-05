from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from fastapi import Depends, FastAPI
from fastapi.responses import Response
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]
sys.path.insert(0, str(BACKEND))
import mercury_auth as auth
import operation_logs


class UserAccessOverrideTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        for module, key, value in (
            (auth, 'DATA_DIRECTORY', directory), (auth, 'USERS_FILE', directory / 'users.json'),
            (auth, '_secret_key', 'isolated-access-test-secret-0123456789abcdef'),
            (operation_logs, 'DATA_DIRECTORY', directory), (operation_logs, 'AUDIT_LOG_FILE', directory / 'audit.jsonl'),
        ):
            self.stack.enter_context(patch.object(module, key, value))
        self.admin = {'email': 'admin@example.com', 'username': 'Admin', 'role': 'admin'}
        self.member = {'email': 'member@example.com', 'username': 'Member', 'role': 'user'}
        auth._save_users([self.admin, self.member])
        app = FastAPI()
        app.include_router(auth.router)
        app.middleware('http')(operation_logs.audit_request)

        @app.get('/api/test-fixture')
        def protected(user=Depends(auth.require_permission('logs:view'))):
            return {'ok': True}

        self.client = self.stack.enter_context(TestClient(app))
        self.member_client = self.stack.enter_context(TestClient(app))
        for client, actor in ((self.client, self.admin), (self.member_client, self.member)):
            response = Response()
            auth.issue_session(response, actor, remember=False)
            cookie = response.headers['set-cookie'].split(';', 1)[0].split('=', 1)[1]
            client.cookies.set(auth.SESSION_COOKIE_NAME, cookie)

    def save(self, data):
        response = self.client.put('/api/auth/access/users/member@example.com', json=data)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_real_frontend_click_payloads_survive_save_and_session_reload(self):
        process = subprocess.run(['node', str(ROOT / 'scripts/test-user-access.cjs'), '--fixtures'], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
        fixtures = json.loads(process.stdout)
        for fixture in fixtures:
            with self.subTest(scenario=fixture['label']):
                roles = auth._load_roles()
                roles['user'] = fixture['role']
                auth._save_roles(roles)
                data = fixture['user']
                saved = self.save(data)
                endpoints = [saved, self.member_client.get('/api/auth/me').json(), self.member_client.get('/api/auth/menus').json()]
                for profile in endpoints:
                    self.assertEqual('logs' in [menu['key'] for menu in profile['menus']], fixture['menuOn'])
                    self.assertEqual('logs:view' in profile['permissions'], fixture['permissionOn'])
                    self.assertEqual('register:run' in profile['permissions'], fixture['actionOn'])
                self.assertEqual(self.member_client.get('/api/test-fixture').status_code, 200 if fixture['permissionOn'] else 403)
                # Reload editing form: raw overrides must not turn into final grants.
                reloaded = self.client.get('/api/auth/access/users/member@example.com').json()
                for key in ('extraMenus', 'extraPermissions', 'removedMenus', 'removedPermissions'):
                    self.assertEqual(sorted(reloaded[key]), sorted(data[key]), key)
                saved_again = self.save(reloaded)
                self.assertEqual(saved['menus'], saved_again['menus'])
                self.assertEqual(saved['permissions'], saved_again['permissions'])

    def test_revocation_wins_over_conflicting_legacy_additions(self):
        result = self.save({'role': 'user', 'extraMenus': ['logs'], 'extraPermissions': ['logs:view'], 'removedMenus': ['logs'], 'removedPermissions': ['logs:view']})
        self.assertNotIn('logs', [menu['key'] for menu in result['menus']])
        self.assertNotIn('logs:view', result['permissions'])

    def test_raw_role_permissions_are_not_overwritten_by_user_revocations(self):
        result = self.save({'role': 'user', 'removedPermissions': ['email:view']})
        self.assertIn('email:view', result['rolePermissions'])
        self.assertNotIn('email:view', result['permissions'])
        self.assertIn('email', result['roleMenus'])
        self.assertNotIn('email', [menu['key'] for menu in result['menus']])

    def test_removed_menu_revokes_auto_view_permission(self):
        result = self.save({'role': 'user', 'removedMenus': ['email']})
        self.assertNotIn('email:view', result['permissions'])

    def test_admin_access_center_remains_available(self):
        response = self.client.put('/api/auth/access/users/admin@example.com', json={'role': 'admin', 'removedMenus': ['access'], 'removedPermissions': ['access:manage']})
        self.assertEqual(response.status_code, 200)
        self.assertIn('access', [menu['key'] for menu in response.json()['menus']])
        self.assertIn('access:manage', response.json()['permissions'])

    def test_non_admin_cannot_receive_access_center_as_extra_grant(self):
        result = self.save({'role': 'user', 'extraMenus': ['access'], 'extraPermissions': ['access:manage']})
        self.assertNotIn('access', [menu['key'] for menu in result['menus']])
        self.assertNotIn('access:manage', result['permissions'])

    def test_audit_contains_added_and_removed_overrides(self):
        self.save({'role': 'user', 'removedMenus': ['email'], 'removedPermissions': ['email:view'], 'extraPermissions': ['register:run']})
        record = operation_logs._read_records()[-1]
        self.assertIn('removedMenus', record['detail'])
        self.assertIn('removedPermissions', record['detail'])
        self.assertIn('register:run', record['detail'])


if __name__ == '__main__':
    unittest.main()
