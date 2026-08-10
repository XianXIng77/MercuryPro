from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from xai_browser import XaiVisibleRegistration  # noqa: E402


class _FakeContext:
    def new_page(self) -> object:
        return object()


class _FakeBrowser:
    def __init__(self) -> None:
        self.context_options: dict[str, Any] | None = None

    def new_context(self, **kwargs: Any) -> _FakeContext:
        self.context_options = dict(kwargs)
        return _FakeContext()


class _FakeRuntime:
    def __init__(self, *, using_camoufox: bool) -> None:
        self.browser = _FakeBrowser()
        self.using_camoufox = using_camoufox
        self.geo_profile = {
            "resolved": True,
            "ip": "203.0.113.10",
            "country_code": "JP",
            "locale": "ja-JP",
            "timezone": "Asia/Tokyo",
        }

    def ensure(self, **_kwargs: Any) -> tuple[_FakeBrowser, bool, bool]:
        return self.browser, self.using_camoufox, False


class XaiCamoufoxContextTests(unittest.TestCase):
    def test_camoufox_keeps_native_locale_and_timezone_fingerprint(self) -> None:
        runtime = _FakeRuntime(using_camoufox=True)
        progress: list[str] = []
        registration = XaiVisibleRegistration(
            runtime=runtime,  # type: ignore[arg-type]
            headless=True,
            on_progress=progress.append,
        )

        registration._open_private_context()

        self.assertEqual(runtime.browser.context_options, {"no_viewport": True})
        self.assertTrue(
            any("regional_profile_detected" in message for message in progress)
        )

    def test_non_camoufox_context_still_matches_proxy_region(self) -> None:
        runtime = _FakeRuntime(using_camoufox=False)
        registration = XaiVisibleRegistration(
            runtime=runtime,  # type: ignore[arg-type]
            headless=True,
        )

        registration._open_private_context()

        self.assertEqual(
            runtime.browser.context_options,
            {
                "viewport": {"width": 1280, "height": 800},
                "locale": "ja-JP",
                "timezone_id": "Asia/Tokyo",
            },
        )


if __name__ == "__main__":
    unittest.main()
