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
        self.owner = {'email': 'owner@example.com', 'username': 'Owner', 'role': 'owner'}
        auth._save_users([self.admin, self.member, self.owner])
        app = FastAPI()
        app.include_router(auth.router)
        app.middleware('http')(operation_logs.audit_request)

        @app.get('/api/test-fixture')
        def protected(user=Depends(auth.require_permission('logs:view'))):
            return {'ok': True}

        @app.get('/api/test-permission/{permission}')
        def protected_permission(permission: str, user=Depends(auth.get_current_user)):
            auth.require_permission(permission)(user)
            return {'ok': True}

        self.client = self.stack.enter_context(TestClient(app))
        self.member_client = self.stack.enter_context(TestClient(app))
        self.owner_client = self.stack.enter_context(TestClient(app))
        for client, actor in ((self.client, self.admin), (self.member_client, self.member), (self.owner_client, self.owner)):
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

    def test_explicit_grants_win_over_conflicting_revoked_inheritance(self):
        result = self.save({'role': 'user', 'extraMenus': ['logs'], 'extraPermissions': ['logs:view'], 'removedMenus': ['logs'], 'removedPermissions': ['logs:view']})
        self.assertIn('logs', [menu['key'] for menu in result['menus']])
        self.assertIn('logs:view', result['permissions'])

    def test_raw_role_permissions_are_not_overwritten_by_user_revocations(self):
        result = self.save({'role': 'user', 'removedPermissions': ['email:view']})
        self.assertIn('email:view', result['rolePermissions'])
        self.assertNotIn('email:view', result['permissions'])
        self.assertIn('email', result['roleMenus'])
        self.assertIn('email', [menu['key'] for menu in result['menus']])

    def test_removed_menu_preserves_view_permission(self):
        result = self.save({'role': 'user', 'removedMenus': ['email']})
        self.assertNotIn('email', [menu['key'] for menu in result['menus']])
        self.assertIn('email:view', result['permissions'])

    def test_admin_access_center_remains_available(self):
        response = self.owner_client.put('/api/auth/access/users/admin@example.com', json={'role': 'admin', 'removedMenus': ['access'], 'removedPermissions': ['access:manage']})
        self.assertEqual(response.status_code, 200)
        self.assertIn('access', [menu['key'] for menu in response.json()['menus']])
        self.assertIn('access:manage', response.json()['permissions'])

    def test_non_admin_cannot_receive_access_center_as_extra_grant(self):
        result = self.save({'role': 'user', 'extraMenus': ['access'], 'extraPermissions': ['access:manage']})
        self.assertNotIn('access', [menu['key'] for menu in result['menus']])
        self.assertNotIn('access:manage', result['permissions'])

    def save_role(self, menus, permissions):
        response = self.client.put('/api/auth/access/roles/user', json={
            'key': 'user', 'label': 'Member', 'menuKeys': menus, 'permissions': permissions,
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_profile(self, profile, menus, permissions):
        self.assertEqual({menu['key'] for menu in profile['menus']}, set(menus))
        self.assertEqual(set(profile['permissions']), set(permissions))

    def test_role_grants_are_independent_for_every_business_menu(self):
        for menu in auth.MENU_DEFINITIONS:
            if menu['key'] == 'access':
                continue
            codes = [menu['permission'], *[item['code'] for item in menu.get('permissions', [])]]
            for menu_on, permission_on in ((False, False), (True, False), (False, True), (True, True)):
                with self.subTest(menu=menu['key'], menu_on=menu_on, permission_on=permission_on):
                    menus = [menu['key']] if menu_on else []
                    permissions = list(dict.fromkeys(codes)) if permission_on else []
                    saved_role = self.save_role(menus, permissions)
                    self.assertEqual(saved_role['menuKeys'], menus)
                    self.assertEqual(saved_role['permissions'], permissions)
                    loaded_role = auth._load_roles()['user']
                    self.assertEqual(loaded_role['menuKeys'], menus)
                    self.assertEqual(loaded_role['permissions'], permissions)
                    self.assert_profile(self.member_client.get('/api/auth/menus').json(), menus, permissions)
                    for code in codes:
                        self.assertEqual(self.member_client.get(f'/api/test-permission/{code}').status_code, 200 if permission_on else 403)

    def test_personal_grants_are_independent_for_every_business_menu(self):
        self.save_role([], [])
        for menu in auth.MENU_DEFINITIONS:
            if menu['key'] == 'access':
                continue
            for menu_on, permission_on in ((False, False), (True, False), (False, True), (True, True)):
                with self.subTest(menu=menu['key'], menu_on=menu_on, permission_on=permission_on):
                    menus = [menu['key']] if menu_on else []
                    permissions = [menu['permission']] if permission_on else []
                    saved = self.save({'role': 'user', 'extraMenus': menus, 'extraPermissions': permissions})
                    self.assert_profile(saved, menus, permissions)
                    self.assert_profile(self.member_client.get('/api/auth/me').json(), menus, permissions)
                    reloaded = self.client.get('/api/auth/access/users/member@example.com').json()
                    self.assertEqual(reloaded['extraMenus'], menus)
                    self.assertEqual(reloaded['extraPermissions'], permissions)
                    self.assertEqual(reloaded['removedMenus'], [])
                    self.assertEqual(reloaded['removedPermissions'], [])
                    self.assertEqual(self.member_client.get(f"/api/test-permission/{menu['permission']}").status_code, 200 if permission_on else 403)

    def test_revoking_one_dimension_preserves_the_other_for_every_menu(self):
        for menu in auth.MENU_DEFINITIONS:
            if menu['key'] == 'access':
                continue
            codes = list(dict.fromkeys([menu['permission'], *[item['code'] for item in menu.get('permissions', [])]]))
            with self.subTest(menu=menu['key']):
                self.save_role([menu['key']], codes)
                saved = self.save({'role': 'user', 'removedMenus': [menu['key']]})
                self.assert_profile(saved, [], codes)
                saved = self.save({'role': 'user', 'removedPermissions': codes})
                self.assert_profile(saved, [menu['key']], [])

    def test_explicit_minimal_role_is_not_overwritten_by_legacy_migration(self):
        for permissions in ([], ['dashboard:view'], ['dashboard:view', 'email:view']):
            with self.subTest(permissions=permissions):
                self.save_role(['dashboard', 'email'], permissions)
                self.assertEqual(auth._load_roles()['user']['permissions'], permissions)
                self.assertEqual(auth._load_roles()['user']['menuKeys'], ['dashboard', 'email'])

    def test_legacy_user_defaults_still_migrate(self):
        auth._roles_file().write_text(json.dumps({'user': {
            'key': 'user', 'menuKeys': ['dashboard', 'email'],
            'permissions': ['dashboard:view', 'email:view'],
        }}), encoding='utf-8')
        expected_menus = {menu['key'] for menu in auth.MENU_DEFINITIONS} - {'access', 'invite'}
        expected_permissions = {item['code'] for item in auth.PERMISSION_DEFINITIONS if not item['code'].startswith(('access:', 'invite:'))}
        role = auth._load_roles()['user']
        self.assertEqual(set(role['menuKeys']), expected_menus)
        self.assertEqual(set(role['permissions']), expected_permissions)

    def test_owner_and_admin_protections_remain_enforced(self):
        original_users = auth._load_users()
        for payload in ({'role': 'user'}, {'role': 'owner'}, {'role': 'admin', 'removedPermissions': ['dashboard:view']}):
            with self.subTest(payload=payload):
                response = self.client.put('/api/auth/access/users/owner@example.com', json=payload)
                self.assertEqual(response.status_code, 403)
        self.assertEqual(auth._load_users(), original_users)
        response = self.client.put('/api/auth/access/roles/owner', json={'key': 'owner', 'label': 'Owner', 'menuKeys': [], 'permissions': []})
        self.assertEqual(response.status_code, 403)
        response = self.client.put('/api/auth/access/users/member@example.com', json={'role': 'admin'})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.client.get('/api/auth/access/users/owner@example.com').json()['canEdit'])
        profile = auth.access_profile(self.owner)
        self.assert_profile(profile, auth._all_menu_keys(), auth._all_permission_codes())

    def test_role_grants_cannot_give_ordinary_users_access_center(self):
        role = self.save_role(['access'], ['access:manage'])
        self.assertEqual(role['menuKeys'], [])
        self.assertEqual(role['permissions'], [])
        self.assertEqual(self.member_client.get('/api/test-permission/access:manage').status_code, 403)

    def test_audit_contains_added_and_removed_overrides(self):
        self.save({'role': 'user', 'removedMenus': ['email'], 'removedPermissions': ['email:view'], 'extraPermissions': ['register:run']})
        record = operation_logs._read_records()[-1]
        self.assertIn('removedMenus', record['detail'])
        self.assertIn('removedPermissions', record['detail'])
        self.assertIn('register:run', record['detail'])


if __name__ == '__main__':
    unittest.main()
