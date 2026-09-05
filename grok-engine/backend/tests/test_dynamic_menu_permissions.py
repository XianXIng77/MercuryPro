from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import mercury_auth  # noqa: E402


class DynamicMenuPermissionTests(unittest.TestCase):
    def test_menu_permission_metadata_becomes_catalog_permissions(self) -> None:
        definitions = mercury_auth._menu_permission_definitions([
            {
                "key": "reports",
                "label": "报表中心",
                "group": "分析",
                "permissions": [
                    {"code": "reports:export", "label": "导出报表"},
                    "reports:share",
                ],
            },
        ])
        self.assertEqual(definitions, [
            {"code": "reports:export", "label": "导出报表", "group": "分析"},
            {"code": "reports:share", "label": "操作报表中心", "group": "分析"},
        ])

    def test_default_admin_follows_registered_menus_and_permissions(self) -> None:
        defaults = mercury_auth._default_roles()
        self.assertEqual(defaults["admin"]["menuKeys"], mercury_auth._all_menu_keys())
        self.assertEqual(defaults["admin"]["permissions"], mercury_auth._all_permission_codes())


if __name__ == "__main__":
    unittest.main()
