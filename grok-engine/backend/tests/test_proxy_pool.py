from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from proxy_pool import canonicalize_proxy_line  # noqa: E402


class ProxyPoolTests(unittest.TestCase):
    def test_residential_host_port_username_password_format(self) -> None:
        proxy = canonicalize_proxy_line(
            "us.1024proxy.io:3000:demo-region-US-sid-AbCd1234-t-5:secret"
        )

        self.assertEqual(
            proxy,
            "http://demo-region-US-sid-AbCd1234-t-5:secret@us.1024proxy.io:3000",
        )


if __name__ == "__main__":
    unittest.main()
