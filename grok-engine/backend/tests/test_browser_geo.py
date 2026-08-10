from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from browser_geo import (  # noqa: E402
    DEFAULT_LOCALE,
    DEFAULT_TIMEZONE,
    _profile_from_payload,
    _proxy_request_url,
    camoufox_region_options,
)


class BrowserGeoTests(unittest.TestCase):
    def test_proxy_request_url_encodes_authentication(self) -> None:
        value = _proxy_request_url(
            {
                "server": "http://proxy.example:8080",
                "username": "user@example.com",
                "password": "p:a ss",
            }
        )
        self.assertEqual(
            value,
            "http://user%40example.com:p%3Aa%20ss@proxy.example:8080",
        )

    def test_profile_uses_country_locale_and_timezone(self) -> None:
        profile = _profile_from_payload(
            {
                "success": True,
                "ip": "203.0.113.10",
                "country_code": "DE",
                "country": "Germany",
                "region": "Berlin",
                "city": "Berlin",
                "latitude": 52.52,
                "longitude": 13.405,
                "timezone": {"id": "Europe/Berlin"},
            }
        )
        self.assertTrue(profile["resolved"])
        self.assertEqual(profile["locale"], "de-DE")
        self.assertEqual(profile["timezone"], "Europe/Berlin")

        options = camoufox_region_options(profile)
        self.assertEqual(options["locale"], "de-DE")
        self.assertEqual(options["config"]["timezone"], "Europe/Berlin")
        self.assertEqual(options["config"]["geolocation:latitude"], 52.52)

    def test_camoufox_options_keep_defaults_for_fallback(self) -> None:
        options = camoufox_region_options({"resolved": False})
        self.assertEqual(options["locale"], DEFAULT_LOCALE)
        self.assertEqual(options["config"]["timezone"], DEFAULT_TIMEZONE)

    def test_incomplete_payload_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            _profile_from_payload(
                {
                    "success": True,
                    "ip": "203.0.113.10",
                    "country_code": "US",
                    "timezone": {},
                }
            )


if __name__ == "__main__":
    unittest.main()
