from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from browser_registration_common import (  # noqa: E402
    EMAIL_INPUT_SELECTORS,
    action_pattern,
    action_text_matches,
    find_action,
)


class _FakeElement:
    def __init__(self, text: str, *, enabled: bool = True) -> None:
        self.text = text
        self.enabled = enabled

    def is_visible(self) -> bool:
        return True

    def is_enabled(self) -> bool:
        return self.enabled

    def text_content(self) -> str:
        return self.text

    def get_attribute(self, _name: str):
        return None


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


class BrowserRegistrationCommonTests(unittest.TestCase):
    def test_email_signup_covers_proxy_locales(self) -> None:
        labels = (
            "Sign up with email",
            "使用邮箱注册",
            "メールアドレスで登録",
            "이메일로 가입",
            "Mit E-Mail registrieren",
            "S’inscrire avec une adresse e-mail",
            "Registrarse con correo electrónico",
            "Cadastrar-se com e-mail",
            "Registrati con email",
            "Registreren met e-mail",
            "Зарегистрироваться по электронной почте",
        )
        for label in labels:
            with self.subTest(label=label):
                self.assertTrue(action_text_matches("email_signup", label))

    def test_email_signin_and_oauth_are_multilingual(self) -> None:
        self.assertTrue(action_text_matches("email_signin", "メールでログイン"))
        self.assertTrue(action_text_matches("email_signin", "Mit E-Mail anmelden"))
        self.assertTrue(action_text_matches("oauth_approve", "許可"))
        self.assertTrue(action_text_matches("oauth_approve", "Autorisieren"))

    def test_cookie_accept_all_covers_french_and_japanese(self) -> None:
        labels = (
            "Accept all",
            "Tout accepter",
            "すべて許可",
            "すべての Cookie を受け入れる",
            "全て同意",
        )
        for label in labels:
            with self.subTest(label=label):
                self.assertTrue(action_text_matches("cookie_accept_all", label))
        self.assertTrue(
            action_text_matches(
                "cookie_accept_all",
                "Tout accepter cookie-policy-manage-dialog-accept-button",
            )
        )

        self.assertFalse(
            action_text_matches(
                "cookie_accept_all", "Refuser les cookies non essentiels"
            )
        )
        self.assertTrue(action_text_matches("retry", "もう一度お試しください"))

    def test_find_action_uses_accessible_visible_text(self) -> None:
        disabled = _FakeElement("メールアドレスで登録", enabled=False)
        enabled = _FakeElement("メールアドレスで登録")
        found = find_action(
            _FakePage([disabled, enabled]), action_pattern("email_signup")
        )
        self.assertIs(found, enabled)

    def test_shared_email_selectors_include_structural_fallbacks(self) -> None:
        self.assertIn('input[type="email"]', EMAIL_INPUT_SELECTORS)
        self.assertIn('input[autocomplete="email"]', EMAIL_INPUT_SELECTORS)


if __name__ == "__main__":
    unittest.main()
