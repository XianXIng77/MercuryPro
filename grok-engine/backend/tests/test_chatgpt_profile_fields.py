from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_browser import (  # noqa: E402
    ChatGPTRegistrationError,
    _fill_profile_fields,
    _infer_birthdate_order,
    _replace_birthdate_input,
)


class _FakeBirthdateInput:
    def __init__(self, value: str) -> None:
        self.value = value
        self.actions: list[tuple[str, str]] = []

    def click(self) -> None:
        self.actions.append(("click", ""))

    def press(self, key: str) -> None:
        self.actions.append(("press", key))
        if key == "Backspace":
            self.value = ""

    def fill(self, value: str) -> None:
        self.actions.append(("fill", value))
        self.value = value

    def type(self, value: str, **_kwargs) -> None:
        self.actions.append(("type", value))
        self.value += value

    def input_value(self) -> str:
        return self.value

    def evaluate(self, _script: str):
        return {
            "segments": ["year", "month", "day"],
            "hints": ["YYYY/MM/DD"],
        }


class _FakeTextInput:
    def __init__(self) -> None:
        self.value = ""

    def fill(self, value: str) -> None:
        self.value = value


class _FakeDatePartInput(_FakeTextInput):
    def evaluate(self, _script: str) -> str:
        return "input"


class ChatGPTProfileFieldTests(unittest.TestCase):
    def test_prefilled_today_is_cleared_before_adult_birthdate(self) -> None:
        element = _FakeBirthdateInput("2026-08-11")

        _replace_birthdate_input(
            element,
            "1994-03-18",
            order=("year", "month", "day"),
        )

        self.assertEqual("19940318", element.value)
        self.assertLess(
            element.actions.index(("fill", "")),
            element.actions.index(("type", "1994")),
        )

    def test_invalid_birthdate_is_rejected(self) -> None:
        with self.assertRaises(ChatGPTRegistrationError):
            _replace_birthdate_input(_FakeBirthdateInput(""), "03/18/1994")

    def test_year_first_date_mask_enters_year_month_day(self) -> None:
        element = _FakeBirthdateInput("2026-08-11")

        _replace_birthdate_input(
            element,
            "1994-03-18",
            order=("year", "month", "day"),
        )

        typed = [value for action, value in element.actions if action == "type"]
        self.assertEqual(["1994", "03", "18"], typed)
        self.assertEqual("19940318", element.value)

    def test_actual_field_segments_override_page_language(self) -> None:
        order = _infer_birthdate_order(
            {
                "segments": ["year", "month", "day"],
                "hints": ["Birthday"],
                "intl_parts": ["month", "day", "year"],
            }
        )

        self.assertEqual(("year", "month", "day"), order)

    def test_placeholder_and_browser_format_are_used_as_fallbacks(self) -> None:
        self.assertEqual(
            ("day", "month", "year"),
            _infer_birthdate_order({"hints": ["DD/MM/YYYY"]}),
        )
        self.assertEqual(
            ("month", "day", "year"),
            _infer_birthdate_order(
                {"hints": ["Birthday"], "intl_parts": ["month", "day", "year"]}
            ),
        )

    def test_birthdate_variant_takes_priority_over_stale_age_input(self) -> None:
        name = _FakeTextInput()
        age = _FakeTextInput()
        birthday = _FakeBirthdateInput("")
        page = SimpleNamespace(url="https://auth.openai.com/about-you")

        def first_visible(_page, selectors):
            if 'input[name="name"]' in selectors:
                return name
            if 'input[name="birthday"]' in selectors:
                return birthday
            if 'input[name="age"]' in selectors:
                return age
            return None

        with (
            patch("chatgpt_browser._first_visible", side_effect=first_visible),
            patch("chatgpt_browser._visible_elements", return_value=[]),
        ):
            _fill_profile_fields(
                page,
                "Alex",
                "Morgan",
                {"year": "1994", "month": "3", "day": "18", "iso": "1994-03-18"},
            )

        self.assertEqual("Alex Morgan", name.value)
        self.assertEqual("19940318", birthday.value)
        self.assertEqual("", age.value)

    def test_age_only_variant_uses_numeric_age_without_touching_date(self) -> None:
        name = _FakeTextInput()
        age = _FakeTextInput()
        page = SimpleNamespace(url="https://auth.openai.com/about-you")

        def first_visible(_page, selectors):
            if 'input[name="name"]' in selectors:
                return name
            if 'input[name="age"]' in selectors:
                return age
            return None

        with (
            patch("chatgpt_browser._first_visible", side_effect=first_visible),
            patch("chatgpt_browser._visible_elements", return_value=[]),
        ):
            _fill_profile_fields(
                page,
                "Alex",
                "Morgan",
                {"year": "1994", "month": "3", "day": "18", "iso": "1994-03-18"},
            )

        self.assertEqual("Alex Morgan", name.value)
        self.assertEqual("24", age.value)

    def test_segmented_birthdate_variant_fills_year_month_day(self) -> None:
        name = _FakeTextInput()
        age = _FakeTextInput()
        parts = {key: _FakeDatePartInput() for key in ("year", "month", "day")}
        page = SimpleNamespace(
            url="https://auth.openai.com/about-you",
            query_selector=lambda _selector: None,
        )

        def first_visible(_page, selectors):
            if 'input[name="name"]' in selectors:
                return name
            for key, element in parts.items():
                if f'[role="spinbutton"][data-type="{key}"]' in selectors:
                    return element
            if 'input[name="age"]' in selectors:
                return age
            return None

        with (
            patch("chatgpt_browser._first_visible", side_effect=first_visible),
            patch("chatgpt_browser._visible_elements", return_value=[]),
        ):
            _fill_profile_fields(
                page,
                "Alex",
                "Morgan",
                {"year": "1994", "month": "3", "day": "18", "iso": "1994-03-18"},
            )

        self.assertEqual("1994", parts["year"].value)
        self.assertEqual("03", parts["month"].value)
        self.assertEqual("18", parts["day"].value)
        self.assertEqual("", age.value)


if __name__ == "__main__":
    unittest.main()
