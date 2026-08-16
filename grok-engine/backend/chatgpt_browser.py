"""ChatGPT browser automation core for account registration.

Uses Camoufox to:
1. Open chatgpt.com and start signup with email
2. Wait for email verification code (via external receiver callback)
3. Fill in name and birthdate
4. Complete registration
5. Extract session from https://chatgpt.com/api/auth/session

Supports proxy, cancellation, and error handling.
"""

from __future__ import annotations

import json
import random
import re
import time
import traceback
from datetime import datetime
from typing import Any, Callable
from urllib.parse import urlparse

from browser_registration_common import (
    EMAIL_INPUT_SELECTORS,
    NEW_PASSWORD_INPUT_SELECTORS,
    ONE_TIME_CODE_INPUT_SELECTORS,
    action_pattern,
    find_action,
    first_visible,
    visible_browser_viewport_size,
    visible_browser_window_size,
)
from chatgpt_browser_context import BrowserContext
import chatgpt_browser_registration as _registration

def _ensure_camoufox() -> None:
    """Lazy-import Camoufox so the module can report a clear startup error."""
    try:
        from camoufox.sync_api import Camoufox

        del Camoufox
    except ImportError as exc:
        raise RuntimeError("Camoufox 未安装，请安装项目浏览器依赖后重试") from exc


# --------------------------------------------------------------------------- #
# Generation helpers
# --------------------------------------------------------------------------- #
_first_names = [
    "James",
    "Mary",
    "John",
    "Patricia",
    "Robert",
    "Jennifer",
    "Michael",
    "Linda",
    "David",
    "Elizabeth",
    "William",
    "Barbara",
    "Richard",
    "Susan",
    "Joseph",
    "Jessica",
    "Thomas",
    "Sarah",
    "Christopher",
    "Karen",
]
_last_names = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
    "Hernandez",
    "Lopez",
    "Gonzalez",
    "Wilson",
    "Anderson",
    "Thomas",
    "Taylor",
    "Moore",
    "Jackson",
    "Martin",
]


def _random_name() -> tuple[str, str]:
    return random.choice(_first_names), random.choice(_last_names)


def _random_birthdate(min_age: int = 20, max_age: int = 55) -> dict[str, str]:
    """Return a random adult birthdate as {month, day, year} dict."""
    today = datetime.now()
    age = random.randint(min_age, max_age)
    year = today.year - age
    month = random.randint(1, 12)
    # Simple day-of-month (ignore leap year edge cases)
    max_day = 28 if month == 2 else 30 if month in (4, 6, 9, 11) else 31
    day = random.randint(1, max_day)
    return {
        "month": str(month),
        "day": str(day),
        "year": str(year),
        "iso": f"{year:04d}-{month:02d}-{day:02d}",
    }


# --------------------------------------------------------------------------- #
# Browser automation
# --------------------------------------------------------------------------- #
class ChatGPTRegistrationError(RuntimeError):
    """ChatGPT registration flow failure."""


class ChatGPTRegistrationCancelled(ChatGPTRegistrationError):
    """User cancelled registration."""


_PLUS_TRIAL_CHECKOUT_URL = "https://chatgpt.com/backend-api/payments/checkout"
_PLUS_TRIAL_AMOUNT_PROBE_JS = r"""
() => {
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && rect.width > 0 && rect.height > 0;
  };
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const parseNumber = (value) => {
    let numeric = String(value || '').replace(/[^\d,.'’+-]/g, '').replace(/['’]/g, '');
    if (!/\d/.test(numeric)) return null;
    const comma = numeric.lastIndexOf(',');
    const dot = numeric.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      numeric = comma > dot
        ? numeric.replace(/\./g, '').replace(',', '.')
        : numeric.replace(/,/g, '');
    } else if (comma >= 0) {
      const groups = numeric.split(',');
      numeric = groups.length > 2 || groups[groups.length - 1].length === 3
        ? groups.join('')
        : numeric.replace(',', '.');
    } else if (dot >= 0) {
      const groups = numeric.split('.');
      if (groups.length > 2 || groups[groups.length - 1].length === 3) numeric = groups.join('');
    }
    const amount = Number(numeric);
    return Number.isFinite(amount) ? amount : null;
  };
  const parseAmount = (value) => {
    const raw = norm(value);
    const match = raw.match(/(?:US\$|S\$|HK\$|CN¥|[$€£¥￥])\s*([+-]?\d[\d\s,.'’]*)/i)
      || raw.match(/([+-]?\d[\d\s,.'’]*)\s*(?:USD|EUR|GBP|JPY|[$€£¥￥])/i);
    if (!match) return null;
    const amount = parseNumber(match[1]);
    return Number.isFinite(amount) ? { amount, raw } : null;
  };
  const hostedSelectors = [
    '#OrderDetails-TotalAmount .CurrencyAmount',
    '#OrderDetails-TotalAmount',
    '#ProductSummary-totalAmount .CurrencyAmount',
    '#ProductSummary-totalAmount',
  ];
  for (const selector of hostedSelectors) {
    const element = document.querySelector(selector);
    if (!visible(element)) continue;
    const parsed = parseAmount(element.innerText || element.textContent || '');
    if (parsed) return {
      has_today_due: true,
      amount: parsed.amount,
      is_zero: Math.abs(parsed.amount) < 0.005,
      raw_amount: parsed.raw,
      source: 'hosted',
    };
  }
  const labelPattern = /amount\s*due\s*today|due\s*today|today'?s\s*total|total\s*due\s*today|今日应付金额|今日應付金額|本日(?:の)?(?:お)?支払(?:い)?(?:金)?額|本日(?:の)?請求額|montant\s+d[uû]\s+aujourd['’]hui|total\s+d[uû]\s+aujourd['’]hui/i;
  const elements = Array.from(document.querySelectorAll('div, span, p, strong, b'))
    .filter((element) => visible(element) && labelPattern.test(norm(element.innerText || element.textContent || '')))
    .sort((left, right) => norm(left.innerText || left.textContent || '').length - norm(right.innerText || right.textContent || '').length);
  let sawTodayDue = false;
  for (const element of elements) {
    sawTodayDue = true;
    const text = norm(element.innerText || element.textContent || '');
    const candidates = [text.replace(labelPattern, '').trim()];
    let container = element.parentElement;
    for (let depth = 0; container && depth < 3; depth += 1) {
      for (const sibling of Array.from(container.children || [])) {
        if (visible(sibling)) {
          candidates.push(norm(sibling.innerText || sibling.textContent || ''));
        }
      }
      container = container.parentElement;
    }
    for (const candidate of candidates) {
      const parsed = parseAmount(candidate);
      if (parsed) return {
        has_today_due: true,
        amount: parsed.amount,
        is_zero: Math.abs(parsed.amount) < 0.005,
        raw_amount: parsed.raw,
        source: 'inline-label',
      };
    }
  }
  if (sawTodayDue) return { has_today_due: true, amount: null, is_zero: false, raw_amount: '', source: 'inline-label' };
  return { has_today_due: false, amount: null, is_zero: false, raw_amount: '', source: 'none' };
}
"""


def _classify_plus_trial_probe(
    probe: dict[str, Any] | None, body_text: str = ""
) -> dict[str, Any]:
    """Classify checkout evidence without treating missing evidence as ineligible."""
    checked_at = time.time()
    data = probe if isinstance(probe, dict) else {}
    amount = data.get("amount")
    if data.get("has_today_due") and isinstance(amount, (int, float)):
        eligible = bool(data.get("is_zero"))
        return {
            "status": "eligible" if eligible else "ineligible",
            "eligible": eligible,
            "checked_at": checked_at,
            "source": "checkout_amount",
            "amount": float(amount),
            "amount_text": str(data.get("raw_amount") or ""),
            "reason": "今日应付金额为 0" if eligible else "今日应付金额不为 0",
        }
    text = str(body_text or "")
    if re.search(
        r"(?:1|one)\s*month\s*free|free\s*trial|essai\s+gratuit|"
        r"1\s*か月無料|無料(?:体験|トライアル)|一个月免费|一個月免費",
        text,
        re.I,
    ):
        return {
            "status": "eligible",
            "eligible": True,
            "checked_at": checked_at,
            "source": "checkout_offer_text",
            "reason": "结账页显示 Plus 免费试用活动",
        }
    return {
        "status": "unknown",
        "eligible": None,
        "checked_at": checked_at,
        "source": str(data.get("source") or "checkout"),
        "reason": "结账页未返回可确认的今日应付金额",
    }


def _check_plus_trial_eligibility(
    page: Any, context: Any, access_token: str, *, timeout_sec: float = 20.0
) -> dict[str, Any]:
    """Create a non-paying Plus promo checkout and inspect today's amount due."""
    try:
        locale = str(page.evaluate("() => navigator.language || 'en-US'") or "en-US")
    except Exception:
        locale = "en-US"
    locale_key = locale.lower()
    if locale_key.startswith("ja"):
        country, currency = "JP", "JPY"
    elif locale_key.startswith("fr"):
        country, currency = "FR", "EUR"
    elif locale_key.startswith("en-gb"):
        country, currency = "GB", "GBP"
    else:
        country, currency = "US", "USD"
    payload = {
        "plan_name": "chatgptplusplan",
        "billing_details": {"country": country, "currency": currency},
        "cancel_url": "https://chatgpt.com/#pricing",
        "promo_campaign": {
            "promo_campaign_id": "plus-1-month-free",
            "is_coupon_from_query_param": False,
        },
        "checkout_ui_mode": "hosted",
    }
    try:
        response = context.request.post(
            _PLUS_TRIAL_CHECKOUT_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "oai-language": locale,
            },
            data=json.dumps(payload),
            timeout=min(max(timeout_sec, 5.0), 30.0) * 1000,
        )
        response_text = str(response.text() or "")[:2000]
        try:
            response_data = response.json()
        except Exception:
            response_data = {}
        if response.status < 200 or response.status >= 300:
            if re.search(r"not.?eligible|ineligible|promo.*(?:invalid|unavailable)", response_text, re.I):
                return {
                    "status": "ineligible",
                    "eligible": False,
                    "checked_at": time.time(),
                    "source": "checkout_api",
                    "reason": "Plus 免费试用活动不适用于该账号",
                    "http_status": response.status,
                }
            return {
                "status": "unknown",
                "eligible": None,
                "checked_at": time.time(),
                "source": "checkout_api",
                "reason": f"资格接口返回 HTTP {response.status}",
                "http_status": response.status,
            }
        data = response_data if isinstance(response_data, dict) else {}
        checkout_url = str(
            data.get("url") or data.get("stripe_hosted_url") or data.get("checkout_url") or ""
        ).strip()
        if not checkout_url:
            checkout_id = str(data.get("checkout_session_id") or data.get("cs_id") or "").strip()
            if checkout_id:
                checkout_url = f"https://chatgpt.com/checkout/openai_llc/{checkout_id}"
        if not checkout_url:
            return {
                "status": "unknown",
                "eligible": None,
                "checked_at": time.time(),
                "source": "checkout_api",
                "reason": "资格接口未返回结账页面",
            }
        page.goto(checkout_url, wait_until="domcontentloaded", timeout=30000)
        check_deadline = time.time() + max(5.0, min(timeout_sec, 25.0))
        last_probe: dict[str, Any] = {}
        body_text = ""
        while time.time() < check_deadline:
            try:
                last_probe = page.evaluate(_PLUS_TRIAL_AMOUNT_PROBE_JS) or {}
            except Exception:
                last_probe = {}
            body_text = _safe_page_text(page)
            if isinstance(last_probe, dict) and last_probe.get("has_today_due"):
                break
            page.wait_for_timeout(250)
        result = _classify_plus_trial_probe(last_probe, body_text)
        result.update({"locale": locale, "country": country, "currency": currency})
        return result
    except Exception as exc:
        return {
            "status": "unknown",
            "eligible": None,
            "checked_at": time.time(),
            "source": "checkout_exception",
            "reason": str(exc)[:240],
        }


def _classify_checkout_session_id(checkout_session_id: Any) -> str:
    """Classify a checkout session without treating every ``cs_`` ID as live."""
    value = str(checkout_session_id or "").strip().lower()
    if value.startswith("oaics_"):
        return "oaics"
    if value.startswith("cs_live_"):
        return "cs_live"
    if value.startswith("cs_test_"):
        return "cs_test"
    return "unknown"


def _check_checkout_kind(
    context: Any,
    access_token: str,
    *,
    country: str = "US",
    currency: str = "USD",
    locale: str = "en-US",
    proxy: str = "",
    timeout_sec: float = 20.0,
) -> dict[str, Any]:
    """Create a non-paying custom checkout and classify its session ID prefix."""
    checked_at = time.time()
    billing_country = str(country or "US").strip().upper() or "US"
    billing_currency = str(currency or "USD").strip().upper() or "USD"
    token = str(access_token or "").strip()
    base_result: dict[str, Any] = {
        "status": "unknown",
        "kind": "unknown",
        "checked_at": checked_at,
        "country": billing_country,
        "currency": billing_currency,
        "source": "dedicated_proxy" if str(proxy or "").strip() else "browser_context",
    }
    if not token:
        return {**base_result, "reason": "缺少 Access Token"}

    payload = {
        "entry_point": "all_plans_pricing_modal",
        "plan_name": "chatgptplusplan",
        "billing_details": {
            "country": billing_country,
            "currency": billing_currency,
        },
        "checkout_ui_mode": "custom",
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Referer": "https://chatgpt.com/",
        "oai-language": str(locale or "en-US"),
        "x-openai-target-path": "/backend-api/payments/checkout",
        "x-openai-target-route": "/backend-api/payments/checkout",
    }
    dedicated_session = None
    try:
        proxy_value = str(proxy or "").strip()
        if proxy_value:
            from curl_cffi import requests as curl_requests
            from proxy_pool import parse_proxy_pool

            proxy_pool = parse_proxy_pool(
                proxy_value,
                username="",
                password="",
                fallback_env=False,
            )
            if len(proxy_pool) != 1:
                return {**base_result, "reason": "专用德国代理格式无效"}
            dedicated_session = curl_requests.Session(impersonate="chrome136")
            dedicated_session.proxies = {
                "http": proxy_pool[0],
                "https": proxy_pool[0],
            }
            response = dedicated_session.post(
                _PLUS_TRIAL_CHECKOUT_URL,
                json=payload,
                headers=headers,
                timeout=min(max(timeout_sec, 5.0), 30.0),
            )
            http_status = int(response.status_code)
        else:
            response = context.request.post(
                _PLUS_TRIAL_CHECKOUT_URL,
                headers=headers,
                data=json.dumps(payload),
                timeout=min(max(timeout_sec, 5.0), 30.0) * 1000,
            )
            http_status = int(response.status)
        try:
            response_data = response.json()
        except Exception:
            response_data = {}
        data = response_data if isinstance(response_data, dict) else {}
        checkout_session_id = str(
            data.get("checkout_session_id")
            or data.get("session_id")
            or data.get("cs_id")
            or data.get("id")
            or ""
        ).strip()
        kind = _classify_checkout_session_id(checkout_session_id)
        result = {
            **base_result,
            "http_status": http_status,
            "kind": kind,
        }
        if http_status < 200 or http_status >= 300:
            result["reason"] = f"结账类型接口返回 HTTP {http_status}"
            return result
        if kind == "unknown":
            result["reason"] = "结账接口未返回可识别的 session ID"
            return result
        result.update({"status": "detected", "reason": f"检测到 {kind} checkout"})
        return result
    except Exception as exc:
        return {
            **base_result,
            "reason": f"专用德国代理查询失败：{type(exc).__name__}" if str(proxy or "").strip() else str(exc)[:240],
        }
    finally:
        if dedicated_session is not None:
            try:
                dedicated_session.close()
            except Exception:
                pass


def _find_and_fill_input(
    page: Any, selectors: list[str], value: str, *, timeout: float = 10.0
) -> bool:
    """Try multiple selectors to find an input and fill it."""
    for sel in selectors:
        try:
            el = page.wait_for_selector(
                sel, timeout=timeout * 1000 / len(selectors), state="visible"
            )
            if el:
                el.click()
                el.fill("")
                el.fill(value)
                return True
        except Exception:
            continue
    return False


def _find_and_click(page: Any, selectors: list[str], *, timeout: float = 10.0) -> bool:
    """Try multiple selectors to find and click a button/link."""
    for sel in selectors:
        try:
            el = page.wait_for_selector(
                sel, timeout=timeout * 1000 / len(selectors), state="visible"
            )
            if el:
                el.click()
                return True
        except Exception:
            continue
    return False


def _safe_page_text(page: Any) -> str:
    try:
        return (page.locator("body").inner_text() or "")[:1000]
    except Exception:
        return ""


def _account_deactivated_visible(page: Any) -> bool:
    """Detect the OpenAI terminal account-deactivated page robustly."""
    needles = (
        "account_deactivated",
        "you do not have an account because it has been deleted or deactivated",
        "account has been deleted or deactivated",
    )
    text = _safe_page_text(page).lower()
    if any(needle in text for needle in needles):
        return True
    try:
        content = str(page.content() or "").lower()
        if any(needle in content for needle in needles):
            return True
    except Exception:
        pass
    try:
        marker = page.get_by_text(
            re.compile(r"account_deactivated|deleted or deactivated", re.I)
        )
        return marker.count() > 0
    except Exception:
        return False


_VERIFICATION_SELECTORS = list(ONE_TIME_CODE_INPUT_SELECTORS)


def _first_visible(page: Any, selectors: list[str]) -> Any:
    return first_visible(page, selectors)


def _visible_elements(page: Any, selector: str) -> list[Any]:
    try:
        return [
            element
            for element in page.query_selector_all(selector)
            if element.is_visible()
        ]
    except Exception:
        return []


def _element_text(element: Any) -> str:
    values: list[str] = []
    for attribute in (None, "value", "aria-label", "title", "data-dd-action-name"):
        try:
            value = (
                element.text_content()
                if attribute is None
                else element.get_attribute(attribute)
            )
            if value:
                values.append(str(value))
        except Exception:
            pass
    return " ".join(values).strip()


def _find_action(page: Any, pattern: str, *, include_disabled: bool = False) -> Any:
    return find_action(page, pattern, include_disabled=include_disabled)


def _verification_target(page: Any) -> tuple[str, Any] | None:
    # Use Locators for OTP fields. Unlike ElementHandle, a Locator resolves the
    # current DOM node again when React replaces the verification form after a
    # resend, so the second fill does not fail with "not attached to the DOM".
    def visible_locators(selector: str) -> list[Any]:
        result: list[Any] = []
        try:
            candidates = page.locator(selector)
            for index in range(candidates.count()):
                candidate = candidates.nth(index)
                if candidate.is_visible():
                    result.append(candidate)
        except Exception:
            pass
        return result

    split = visible_locators('input[maxlength="1"]')
    singles: list[Any] = []
    for selector in _VERIFICATION_SELECTORS:
        singles.extend(visible_locators(selector))
        if singles:
            break
    if not singles:
        try:
            labelled = page.get_by_label(re.compile(r"code|verification|验证码", re.I))
            for index in range(labelled.count()):
                candidate = labelled.nth(index)
                if candidate.is_visible():
                    singles.append(candidate)
        except Exception:
            pass
    single = singles[0] if singles else None
    if single:
        try:
            if int(single.get_attribute("maxlength") or 0) == 1 and len(split) >= 4:
                return "split", split
        except Exception:
            pass
        return "single", single
    if len(split) >= 4:
        return "split", split
    return None


def _verification_submission_pending(page: Any) -> bool:
    """Return True while the verification form visibly reports processing."""
    action = _find_action(
        page,
        action_pattern("verify", r"verifying|loading|processing|处理中"),
        include_disabled=True,
    )
    if not action:
        return False
    try:
        attributes = " ".join(
            str(action.get_attribute(name) or "").strip().lower()
            for name in (
                "aria-busy",
                "aria-disabled",
                "data-loading",
                "data-pending",
                "data-submitting",
                "data-state",
            )
        )
        text = _element_text(action).lower()
        return bool(
            re.search(
                r"\b(?:true|loading|pending|submitting|busy|processing)\b", attributes
            )
            or re.search(
                r"verifying|loading|processing|正在验证|处理中|请稍候", text, re.I
            )
        )
    except Exception:
        return False


def _profile_visible(page: Any) -> bool:
    selectors = [
        'input[name="name"]',
        'input[autocomplete="name"]',
        'input[name="age"]',
        'input[name="birthday"]',
        'input[name="birthdate"]',
        'input[autocomplete="bday"]',
        'input[type="date"]',
        'input[aria-label*="date of birth" i]',
        'input[aria-label*="出生日期"]',
        'input[aria-label*="年龄"]',
        '[role="spinbutton"][data-type="year"]',
    ]
    return _first_visible(page, selectors) is not None


def _is_logged_in_url(raw_url: str) -> bool:
    try:
        parsed = urlparse(str(raw_url or ""))
        if parsed.hostname not in {"chatgpt.com", "www.chatgpt.com", "chat.openai.com"}:
            return False
        return not re.match(
            r"^/(?:auth/|create-account/|email-verification|log-in|add-phone)",
            parsed.path or "",
        )
    except Exception:
        return False


def _signup_state(page: Any) -> str:
    url = str(page.url or "")
    parsed = urlparse(url)
    path = parsed.path.lower()
    text = _safe_page_text(page).lower()
    if _account_deactivated_visible(page):
        return "account_deactivated"
    if parsed.hostname and parsed.hostname not in {
        "chatgpt.com",
        "www.chatgpt.com",
        "chat.openai.com",
        "auth.openai.com",
        "auth0.openai.com",
        "accounts.openai.com",
    }:
        return "external_idp"
    if "max_check_attempts" in text:
        return "security_blocked"
    if "user_already_exists" in text or re.search(
        r"account .*already exists|email address.*already exists|"
        r"アカウント.*(?:すでに|既に).*存在|メールアドレス.*(?:使用されています|登録済み)",
        text,
    ):
        return "existing_account"
    if "account_deactivated" in text or re.search(
        r"account (?:has been |was )?(?:deleted|deactivated)|"
        r"do not have an account because it has been (?:deleted|deactivated)|"
        r"账号.*(?:删除|停用)|账户.*(?:删除|停用)|"
        r"アカウント.*(?:削除|無効|停止)",
        text,
        re.I,
    ):
        return "account_deactivated"
    if re.search(
        r"something went wrong|operation timed out|failed to fetch|405 method not allowed|"
        r"問題が発生しました|操作がタイムアウト|取得に失敗",
        text,
    ):
        if _find_action(
            page, action_pattern("retry"), include_disabled=True
        ):
            return "retry"
    if "create-account-enroll-passkey" in path or re.search(
        r"add passkey|通行密钥|パスキー(?:を追加)?", text
    ):
        return "passkey"
    if "/add-phone" in path or re.search(
        r"add (?:a )?phone|phone number required|添加手机号|"
        r"電話番号(?:を追加|が必要)",
        text,
    ):
        return "add_phone"
    if parsed.hostname in {
        "chatgpt.com",
        "www.chatgpt.com",
        "chat.openai.com",
    } and re.search(
        r"you(?:'| a)?re all set|ready to go|你已准备就绪|"
        r"準備完了|すべての設定が完了",
        text,
        re.I,
    ):
        return "logged_in"
    # The auth app can keep the /email-verification URL (and even the old OTP
    # input in the DOM) after rendering the profile step. Prefer the visible
    # profile controls so a successful code is not mistaken for a failed one.
    if _profile_visible(page) or re.search(
        r"/(?:create-account/profile|signup/profile|about-you)", path
    ):
        return "profile"
    if _verification_target(page) or "/email-verification" in path:
        return "verification"
    if _first_visible(
        page, ['input[name="new-password"]', 'input[autocomplete="new-password"]']
    ):
        return "new_password"
    if _first_visible(page, ['input[autocomplete="current-password"]']):
        return "existing_account"
    if _is_logged_in_url(url):
        return "logged_in"
    return "unknown"


def _wait_for_signup_state(
    page: Any, check_cancel: Callable[[], None], timeout: float
) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        check_cancel()
        state = _signup_state(page)
        if state != "unknown":
            return state
        page.wait_for_timeout(200)
    return _signup_state(page)


def _recover_retry_page(
    page: Any, check_cancel: Callable[[], None], *, attempts: int = 2
) -> bool:
    for _ in range(attempts):
        check_cancel()
        if _signup_state(page) != "retry":
            return True
        button = _find_action(page, action_pattern("retry"))
        if not button:
            page.wait_for_timeout(500)
            continue
        button.click()
        page.wait_for_timeout(1500)
    return _signup_state(page) != "retry"


def _skip_passkey(page: Any) -> bool:
    button = _find_action(
        page, r"^\s*skip\s*$|跳过|スキップ|今はしない|後で"
    )
    if not button:
        return False
    button.click()
    page.wait_for_timeout(1200)
    return True


def _fill_profile_fields(
    page: Any, first_name: str, last_name: str, birthdate: dict[str, str]
) -> None:
    full_name = f"{first_name} {last_name}"
    first = _first_visible(
        page,
        [
            'input[name="firstname"]',
            'input[name="given-name"]',
            'input[aria-label*="first name" i]',
            'input[placeholder*="first name" i]',
        ],
    )
    last = _first_visible(
        page,
        [
            'input[name="lastname"]',
            'input[name="family-name"]',
            'input[aria-label*="last name" i]',
            'input[placeholder*="last name" i]',
        ],
    )
    if first and last:
        first.fill(first_name)
        last.fill(last_name)
    else:
        name = _first_visible(
            page,
            [
                'input[name="name"]',
                'input[autocomplete="name"]',
                'input[aria-label*="full name" i]',
                'input[placeholder*="full name" i]',
            ],
        )
        if not name:
            raise ChatGPTRegistrationError(f"未找到姓名输入框: {page.url}")
        name.fill(full_name)

    # OpenAI currently serves two profile variants: name + full birthdate, or
    # name + numeric age. Always inspect date controls first. Some transitions
    # briefly leave an age input mounted beside the newer date widget; choosing
    # age first would put values such as "24" into the wrong profile variant.
    combined_birthday = _first_visible(
        page,
        [
            'input[name="birthday"]',
            'input[name="birthdate"]',
            'input[name="dateOfBirth"]',
            'input[autocomplete="bday"]',
            'input[type="date"]',
            'input[aria-label*="date of birth" i]',
            'input[aria-label*="birth date" i]',
            'input[aria-label*="birthday" i]',
            'input[aria-label*="出生日期"]',
            'input[aria-label*="生日"]',
            'input[aria-label*="生年月日"]',
            'input[aria-label*="date de naissance" i]',
            'input[placeholder*="YYYY" i]',
        ],
    )
    part_values = {
        "year": birthdate["year"],
        "month": birthdate["month"].zfill(2),
        "day": birthdate["day"].zfill(2),
    }
    part_labels = {
        "year": ("year", "年份", "年"),
        "month": ("month", "月份", "月"),
        "day": ("day", "日期", "日"),
    }
    date_parts: dict[str, Any] = {}
    if not combined_birthday:
        for key, labels in part_labels.items():
            date_parts[key] = _first_visible(
                page,
                [
                    f'[role="spinbutton"][data-type="{key}"]',
                    f'[role="spinbutton"][aria-label*="{labels[0]}" i]',
                    f'[role="spinbutton"][aria-label*="{labels[1]}"]',
                    f'[role="spinbutton"][aria-label="{labels[2]}"]',
                    f'input[name="{key}"]',
                    f'input[name="birth-{key}"]',
                    f'input[name="birth{key}"]',
                    f'input[aria-label*="{labels[0]}" i]',
                    f'input[aria-label*="{labels[1]}"]',
                    f'input[aria-label="{labels[2]}"]',
                    f'select[name="{key}"]',
                    f'select[name="birth-{key}"]',
                    f'select[aria-label*="{labels[0]}" i]',
                    f'select[aria-label*="{labels[1]}"]',
                    f'select[aria-label="{labels[2]}"]',
                ],
            )

    if combined_birthday:
        birthdate_order = _detect_birthdate_input_order(combined_birthday)
        _replace_birthdate_input(
            combined_birthday,
            birthdate["iso"],
            order=birthdate_order,
        )
    elif all(date_parts.values()):
        for key, element in date_parts.items():
            value = part_values[key]
            tag = str(element.evaluate("el => el.tagName.toLowerCase()"))
            if tag == "select":
                try:
                    element.select_option(value)
                except Exception:
                    element.select_option(str(int(value)))
            else:
                try:
                    element.fill(value)
                except Exception:
                    element.click()
                    element.press("Control+A")
                    element.type(value)
        hidden_birthday = page.query_selector(
            'input[name="birthday"], input[name="birthdate"], input[name="dateOfBirth"]'
        )
        if hidden_birthday:
            hidden_birthday.evaluate(
                "(el, value) => { el.value=value; el.dispatchEvent(new Event('input',{bubbles:true})); "
                "el.dispatchEvent(new Event('change',{bubbles:true})); }",
                birthdate["iso"],
            )
    elif any(date_parts.values()):
        missing = ", ".join(key for key, element in date_parts.items() if not element)
        raise ChatGPTRegistrationError(
            f"出生日期输入项不完整，缺少 {missing}: {page.url}"
        )
    else:
        age = _first_visible(
            page,
            [
                'input[name="age"]',
                'input[id*="age" i]',
                'input[aria-label="age" i]',
                'input[aria-label*="年龄"]',
                'input[placeholder="age" i]',
                'input[placeholder*="年龄"]',
            ],
        )
        if not age:
            raise ChatGPTRegistrationError(
                f"未找到完整的出生日期或年龄输入项: {page.url}"
            )
        age.fill("24")

    for checkbox in _visible_elements(page, 'input[type="checkbox"]'):
        try:
            parent_text = str(
                checkbox.evaluate(
                    "el => (el.closest('label,section,div')?.innerText || '')"
                )
            )
            if (
                re.search(r"agree|同意|承諾", parent_text, re.I)
                and not checkbox.is_checked()
            ):
                checkbox.check()
        except Exception:
            continue


def _infer_birthdate_order(probe: dict[str, Any] | None) -> tuple[str, str, str]:
    """Infer visual date segment order from the actual field, not page language."""
    data = probe if isinstance(probe, dict) else {}
    valid = {"year", "month", "day"}
    segments = [str(item).lower() for item in data.get("segments") or []]
    segments = [item for item in segments if item in valid]
    if len(segments) >= 3 and set(segments[:3]) == valid:
        return tuple(segments[:3])  # type: ignore[return-value]

    for raw_hint in data.get("hints") or []:
        hint = str(raw_hint or "").strip()
        if not hint:
            continue
        token_positions: dict[str, int] = {}
        patterns = {
            "year": r"yyyy|\byear\b|年",
            "month": r"(?<!m)mm(?!m)|\bmonth\b|月",
            "day": r"(?<!d)dd(?!d)|\bday\b|日",
        }
        for key, pattern in patterns.items():
            match = re.search(pattern, hint, re.I)
            if match:
                token_positions[key] = match.start()
        if len(token_positions) == 3:
            ordered = tuple(
                key for key, _position in sorted(token_positions.items(), key=lambda item: item[1])
            )
            if set(ordered) == valid:
                return ordered  # type: ignore[return-value]
        if re.match(r"^\s*\d{4}\s*[-/.年]", hint):
            return ("year", "month", "day")

    intl_parts = [str(item).lower() for item in data.get("intl_parts") or []]
    intl_parts = [item for item in intl_parts if item in valid]
    if len(intl_parts) >= 3 and set(intl_parts[:3]) == valid:
        return tuple(intl_parts[:3])  # type: ignore[return-value]
    return ("month", "day", "year")


def _detect_birthdate_input_order(element: Any) -> tuple[str, str, str]:
    try:
        probe = element.evaluate(
            """el => {
                const visible = node => {
                    if (!node) return false;
                    const style = getComputedStyle(node);
                    const rect = node.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden'
                        && rect.width > 0 && rect.height > 0;
                };
                const root = el.closest('[role="group"], fieldset, [data-testid*="birth" i]')
                    || el.parentElement?.parentElement || el.parentElement || el;
                const segments = Array.from(root.querySelectorAll('[data-type]'))
                    .filter(visible)
                    .map(node => ({
                        type: String(node.getAttribute('data-type') || '').toLowerCase(),
                        left: node.getBoundingClientRect().left,
                    }))
                    .filter(item => ['year', 'month', 'day'].includes(item.type))
                    .sort((a, b) => a.left - b.left)
                    .map(item => item.type);
                const inputType = String(el.getAttribute('type') || '').toLowerCase();
                const hints = [
                    el.getAttribute('placeholder'),
                    el.getAttribute('aria-label'),
                    el.getAttribute('data-placeholder'),
                    el.getAttribute('data-format'),
                    inputType === 'date' ? '' : el.getAttribute('value'),
                    inputType === 'date' ? '' : el.value,
                    root.getAttribute?.('aria-label'),
                ].filter(Boolean);
                let intlParts = [];
                try {
                    intlParts = new Intl.DateTimeFormat(undefined, {
                        year: 'numeric', month: '2-digit', day: '2-digit'
                    }).formatToParts(new Date(2001, 10, 22))
                      .map(part => part.type)
                      .filter(type => ['year', 'month', 'day'].includes(type));
                } catch (_error) {}
                return { segments, hints, intl_parts: intlParts };
            }"""
        )
    except Exception:
        probe = {}
    return _infer_birthdate_order(probe)


def _replace_birthdate_input(
    element: Any,
    iso_birthdate: str,
    *,
    order: tuple[str, str, str] = ("month", "day", "year"),
) -> None:
    """Clear a prefilled OpenAI birthday field before entering an adult date."""
    value = str(iso_birthdate or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ChatGPTRegistrationError(f"无效的生日格式: {value!r}")
    try:
        element.click()
    except Exception:
        pass
    # Explicit clearing is important for React's controlled /about-you field;
    # directly assigning el.value can leave its internal state on today's date.
    try:
        element.press("Control+A")
        element.press("Backspace")
    except Exception:
        pass
    year, month, day = value.split("-")
    part_values = {"year": year, "month": month, "day": day}
    normalized_order = tuple(item for item in order if item in part_values)
    if len(normalized_order) != 3 or set(normalized_order) != set(part_values):
        normalized_order = ("month", "day", "year")
    typed_digits = "".join(part_values[item] for item in normalized_order)
    try:
        element.fill("")
    except Exception:
        pass
    retry_segment_navigation = False
    try:
        for item in normalized_order:
            element.type(part_values[item], delay=40)
    except Exception:
        retry_segment_navigation = True
    try:
        current_digits = re.sub(r"\D", "", str(element.input_value() or ""))
        retry_segment_navigation = current_digits not in {
            f"{year}{month}{day}",
            typed_digits,
        }
    except Exception:
        pass
    if retry_segment_navigation:
        try:
            element.click()
            element.press("Control+A")
            element.press("Backspace")
            for index, item in enumerate(normalized_order):
                if index:
                    element.press("ArrowRight")
                element.type(part_values[item], delay=40)
        except Exception:
            # Plain HTML date inputs may reject keyboard typing but still
            # accept their normalized ISO value through Playwright fill.
            element.fill("")
            element.fill(value)
    try:
        element.press("Tab")
    except Exception:
        pass


def _submit_for_element(page: Any, element: Any, pattern: str) -> bool:
    try:
        form = (
            element.evaluate_handle("el => el.form || el.closest('form')")
            if element
            else None
        )
        form_element = form.as_element() if form else None
        if form_element:
            candidates = [
                candidate
                for candidate in form_element.query_selector_all(
                    'button[type="submit"], input[type="submit"]'
                )
                if candidate.is_visible() and candidate.is_enabled()
            ]
            regex = re.compile(pattern, re.I)
            submit = next(
                (
                    candidate
                    for candidate in candidates
                    if regex.search(_element_text(candidate))
                ),
                candidates[0] if len(candidates) == 1 else None,
            )
            if submit:
                submit.click()
                return True
    except Exception:
        pass
    action = _find_action(page, pattern)
    if action:
        action.click()
        return True
    return False


def _profile_submit_button(page: Any) -> Any:
    direct = _first_visible(page, ['button[type="submit"]', 'input[type="submit"]'])
    return direct or _find_action(
        page,
        action_pattern("signup_submit", action_pattern("continue"), r"finish|done|agree"),
    )


def _action_clickable(element: Any) -> bool:
    if not element:
        return False
    try:
        if not element.is_visible() or not element.is_enabled():
            return False
        if element.get_attribute("aria-busy") == "true":
            return False
        pending = " ".join(
            str(element.get_attribute(name) or "").strip().lower()
            for name in (
                "data-loading",
                "data-pending",
                "data-submitting",
                "data-state",
            )
        )
        return not re.search(r"\b(?:true|loading|pending|submitting|busy)\b", pending)
    except Exception:
        return False


class ChatGPTBrowserRuntime:
    """Reusable browser process; every account still gets a fresh context."""

    def __init__(self) -> None:
        self.browser: Any = None
        self.camoufox_manager: Any = None
        self.using_camoufox = False
        self.headless = True
        self.proxy_key = ""

    @staticmethod
    def _key(proxy: dict[str, str] | None) -> str:
        if not proxy:
            return ""
        return "|".join(
            str(proxy.get(key) or "") for key in ("server", "username", "password")
        )

    def ensure(
        self,
        *,
        headless: bool,
        proxy: dict[str, str] | None,
        on_launched: Callable[[str], None] | None = None,
    ) -> tuple[Any, bool, bool]:
        key = self._key(proxy)
        browser_alive = self.browser is not None
        try:
            if browser_alive and hasattr(self.browser, "is_connected"):
                browser_alive = bool(self.browser.is_connected())
        except Exception:
            browser_alive = False
        if browser_alive and self.headless == headless and self.proxy_key == key:
            self.proxy_key = key
            return self.browser, self.using_camoufox, True

        self.close()
        _ensure_camoufox()
        self.headless = headless
        self.proxy_key = key
        debug_window_width, debug_window_height = visible_browser_window_size()
        try:
            from camoufox.sync_api import Camoufox

            # Match the stable Camoufox profile used by openai-free. These
            # options are isolated to ChatGPT and never alter the Grok runtime.
            options: dict[str, Any] = {
                "headless": headless,
                "block_webrtc": True,
                "humanize": True,
                "os": ["windows", "macos", "linux"],
            }
            if not headless:
                options["window"] = (debug_window_width, debug_window_height)
            if proxy and proxy.get("server"):
                options["proxy"] = proxy
                # openai-free derives locale, timezone and geolocation from
                # the real proxy exit. Let Camoufox perform that natively so
                # the browser fingerprint and OpenAI-visible IP stay aligned.
                options["geoip"] = True
            self.camoufox_manager = Camoufox(**options)
            self.browser = self.camoufox_manager.start()
            self.using_camoufox = True
            if on_launched:
                on_launched("launched_camoufox")
        except Exception as exc:
            try:
                if self.camoufox_manager:
                    self.camoufox_manager.__exit__(None, None, None)
            except Exception:
                pass
            self.camoufox_manager = None
            self.browser = None
            raise RuntimeError(f"Camoufox 启动失败：{exc}") from exc
        return self.browser, self.using_camoufox, False

    def close(self) -> None:
        try:
            if self.camoufox_manager:
                self.camoufox_manager.__exit__(None, None, None)
            elif self.browser:
                self.browser.close()
        except Exception:
            pass
        self.browser = None
        self.camoufox_manager = None
        self.using_camoufox = False
        self.proxy_key = ""


def _browser_context() -> BrowserContext:
    """Expose live browser helpers to the registration workflow."""
    return BrowserContext(globals())


def register_chatgpt_account(
    *,
    email: str,
    password: str,
    get_verification_code: Callable[..., str | None],
    proxy: dict[str, str] | None = None,
    headless: bool = True,
    timeout_sec: float = 300.0,
    should_cancel: Callable[[], bool] | None = None,
    on_progress: Callable[[str], None] | None = None,
    browser_data_dir: str | None = None,
    operation_delay_ms: int = 3000,
    checkout_probe_enabled: bool = False,
    checkout_proxy: str = "",
    browser_runtime: ChatGPTBrowserRuntime | None = None,
) -> dict[str, Any]:
    return _registration.register_chatgpt_account(
        _browser_context(),
        email=email,
        password=password,
        get_verification_code=get_verification_code,
        proxy=proxy,
        headless=headless,
        timeout_sec=timeout_sec,
        should_cancel=should_cancel,
        on_progress=on_progress,
        browser_data_dir=browser_data_dir,
        operation_delay_ms=operation_delay_ms,
        checkout_probe_enabled=checkout_probe_enabled,
        checkout_proxy=checkout_proxy,
        browser_runtime=browser_runtime,
    )
