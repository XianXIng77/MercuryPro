from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_browser import (  # noqa: E402
    ChatGPTRegistrationError,
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


if __name__ == "__main__":
    unittest.main()
