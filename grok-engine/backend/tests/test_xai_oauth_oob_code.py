from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from xai_browser import XaiBrowserError, XaiVisibleRegistration  # noqa: E402


class _FakeElement:
    def __init__(self, text: str = "", *, data_value: str = "") -> None:
        self.text = text
        self.data_value = data_value

    def is_visible(self) -> bool:
        return True

    def input_value(self, *, timeout: int) -> str:
        del timeout
        return ""

    def get_attribute(self, name: str):
        if name == "data-value":
            return self.data_value
        return None

    def inner_text(self, *, timeout: int) -> str:
        del timeout
        return self.text

    def text_content(self, *, timeout: int) -> str:
        del timeout
        return self.text


class _FakeLocator:
    def __init__(self, elements: list[_FakeElement]) -> None:
        self.elements = elements

    def count(self) -> int:
        return len(self.elements)

    def nth(self, index: int) -> _FakeElement:
        return self.elements[index]


class _FakePage:
    def __init__(self, elements: list[_FakeElement]) -> None:
        self.elements = elements

    def locator(self, _selector: str) -> _FakeLocator:
        return _FakeLocator(self.elements)


class XaiOauthOobCodeTests(unittest.TestCase):
    def _registration(self, elements: list[_FakeElement]) -> XaiVisibleRegistration:
        registration = XaiVisibleRegistration()
        registration.page = _FakePage(elements)
        return registration

    def test_extracts_code_from_localized_consent_page_element(self) -> None:
        code = "TVijXWP-ctVUAGLKgSkKNqfBN8nIjS8jDxfGxE8AFwy4fYu9"
        registration = self._registration([_FakeElement(data_value=code)])

        actual = registration._pkce_oob_code_from_page(
            "https://accounts.x.ai/oauth2/consent?state=expected",
            "このコードを入力してログインを完了してください。",
            "expected",
        )

        self.assertEqual(code, actual)

    def test_extracts_code_from_localized_page_text_fallback(self) -> None:
        code = "wpqmdQ87eU5k0UW4ljUzA76oR1gd4uG4FBPqAaNRTVA6"
        registration = self._registration([])

        actual = registration._pkce_oob_code_from_page(
            "https://accounts.x.ai/oauth2/consent?state=expected",
            f"Grok Build に以下のコードをコピーしてください。 {code}",
            "expected",
        )

        self.assertEqual(code, actual)

    def test_ignores_code_outside_exact_consent_route(self) -> None:
        code = "wpqmdQ87eU5k0UW4ljUzA76oR1gd4uG4FBPqAaNRTVA6"
        registration = self._registration([_FakeElement(text=code)])

        actual = registration._pkce_oob_code_from_page(
            "https://accounts.x.ai/account?state=expected", code, "expected"
        )

        self.assertIsNone(actual)

    def test_rejects_state_mismatch_before_returning_code(self) -> None:
        code = "wpqmdQ87eU5k0UW4ljUzA76oR1gd4uG4FBPqAaNRTVA6"
        registration = self._registration([_FakeElement(text=code)])

        with self.assertRaises(XaiBrowserError):
            registration._pkce_oob_code_from_page(
                "https://accounts.x.ai/oauth2/consent?state=wrong",
                code,
                "expected",
            )


if __name__ == "__main__":
    unittest.main()
