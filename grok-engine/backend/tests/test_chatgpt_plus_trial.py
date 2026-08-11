from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_browser import (  # noqa: E402
    _PLUS_TRIAL_AMOUNT_PROBE_JS,
    _check_checkout_kind,
    _classify_checkout_session_id,
    _classify_plus_trial_probe,
)
from proxy_pool import parse_proxy_pool  # noqa: E402


class ChatGPTPlusTrialEligibilityTests(unittest.TestCase):
    def test_zero_due_today_is_eligible(self) -> None:
        result = _classify_plus_trial_probe(
            {
                "has_today_due": True,
                "amount": 0.0,
                "is_zero": True,
                "raw_amount": "$0.00",
            }
        )
        self.assertEqual("eligible", result["status"])
        self.assertTrue(result["eligible"])

    def test_nonzero_due_today_is_ineligible(self) -> None:
        result = _classify_plus_trial_probe(
            {
                "has_today_due": True,
                "amount": 20.0,
                "is_zero": False,
                "raw_amount": "$20.00",
            }
        )
        self.assertEqual("ineligible", result["status"])
        self.assertFalse(result["eligible"])

    def test_japanese_thousands_amount_is_ineligible(self) -> None:
        result = _classify_plus_trial_probe(
            {
                "has_today_due": True,
                "amount": 2727.0,
                "is_zero": False,
                "raw_amount": "¥2,727",
            }
        )
        self.assertEqual("ineligible", result["status"])
        self.assertFalse(result["eligible"])

    def test_japanese_today_payment_label_and_thousands_are_supported(self) -> None:
        self.assertIn("支払(?:い)?(?:金)?額", _PLUS_TRIAL_AMOUNT_PROBE_JS)
        self.assertIn(
            "groups[groups.length - 1].length === 3",
            _PLUS_TRIAL_AMOUNT_PROBE_JS,
        )

    def test_japanese_trial_offer_text_is_eligible(self) -> None:
        result = _classify_plus_trial_probe({}, "Plus を1か月無料でお試しいただけます")
        self.assertEqual("eligible", result["status"])

    def test_missing_evidence_stays_unknown(self) -> None:
        result = _classify_plus_trial_probe({}, "ChatGPT Plus")
        self.assertEqual("unknown", result["status"])
        self.assertIsNone(result["eligible"])


class ChatGPTCheckoutKindTests(unittest.TestCase):
    def test_german_residential_proxy_shorthand_is_supported(self) -> None:
        proxies = parse_proxy_pool(
            "us.1024proxy.io:3000:user-region-DE-sid-Test123-t-5:password",
            fallback_env=False,
        )

        self.assertEqual(
            [
                "http://user-region-DE-sid-Test123-t-5:password@us.1024proxy.io:3000"
            ],
            proxies,
        )

    def test_oaics_session_is_classified(self) -> None:
        self.assertEqual("oaics", _classify_checkout_session_id("oaics_example"))

    def test_live_stripe_session_is_classified(self) -> None:
        self.assertEqual("cs_live", _classify_checkout_session_id("cs_live_example"))

    def test_test_session_is_not_misclassified_as_live(self) -> None:
        self.assertEqual("cs_test", _classify_checkout_session_id("cs_test_example"))

    def test_unrecognized_session_stays_unknown(self) -> None:
        self.assertEqual("unknown", _classify_checkout_session_id("checkout_example"))

    def test_custom_checkout_probe_uses_expected_payload(self) -> None:
        calls = []

        class Response:
            status = 200

            @staticmethod
            def json():
                return {"checkout_session_id": "oaics_example"}

        class Request:
            @staticmethod
            def post(url, **kwargs):
                calls.append((url, kwargs))
                return Response()

        class Context:
            request = Request()

        result = _check_checkout_kind(
            Context(),
            "access-token",
            country="DE",
            currency="EUR",
            locale="de-DE",
        )

        self.assertEqual("detected", result["status"])
        self.assertEqual("oaics", result["kind"])
        self.assertEqual("custom", json.loads(calls[0][1]["data"])["checkout_ui_mode"])
        self.assertEqual("DE", json.loads(calls[0][1]["data"])["billing_details"]["country"])


if __name__ == "__main__":
    unittest.main()
