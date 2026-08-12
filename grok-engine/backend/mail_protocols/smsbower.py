"""SMSBower API protocol — purchase Gmail mailboxes and receive verification codes.

Implements the standard mail-protocol interface (create_mailbox / fetch_messages)
backed by the SMSBower REST API.  Each registration purchases a temporary Gmail
address on demand; codes are polled via SMSBower's getCode endpoint.

API reference: https://smsbower.org/api/?page=main

Endpoint summary
----------------
Base URL       https://smsbower.page/api/mail/
Auth           ?api_key=YOUR_KEY  (query parameter on every request)

getActivation  GET …/getActivation?api_key=…&service=dr&domain=gmail.com
               → {"status":1, "mail":"…@gmail.com", "mailId":123}

getCode        GET …/getCode?api_key=…&mailId=123
               → {"status":1, "code":"654321"}

getPriceRests  GET …/getPriceRests?api_key=…&service=dr&domain=gmail.com
               → {"status":1, "data":{"dr":{"gmail.com":{"price":"0.05","count":10}}}}

setStatus      GET …/setStatus?api_key=…&id=123&status=3   (3=complete, 2=cancel)
"""
from __future__ import annotations

from typing import Any

import httpx

from .common import _extract_codes_and_links

# ---------------------------------------------------------------------------
# SMSBower API constants
# ---------------------------------------------------------------------------
SMSBOWER_DEFAULT_BASE_URL = "https://smsbower.page/api/mail"

# Service code for OpenAI / ChatGPT (from SMSBower's service list).
SMSBOWER_DEFAULT_SERVICE = "dr"

# Gmail is the recommended domain for OpenAI registrations.
SMSBOWER_DEFAULT_DOMAIN = "gmail.com"


def _smsbower_get(
    endpoint: str,
    api_key: str,
    base_url: str,
    params: dict[str, Any] | None = None,
    timeout: float = 45.0,
) -> dict[str, Any]:
    """Call a SMSBower API endpoint (GET with api_key query param)."""
    base = (base_url or SMSBOWER_DEFAULT_BASE_URL).rstrip("/")
    if not base.startswith(("http://", "https://")):
        base = f"https://{base}"
    query: dict[str, Any] = {"api_key": api_key}
    if params:
        query.update(params)

    # Use generous timeouts — SMSBower API can be slow from some regions.
    with httpx.Client(timeout=httpx.Timeout(timeout, connect=15.0)) as client:
        try:
            resp = client.get(f"{base}/{endpoint.lstrip('/')}", params=query)
        except httpx.RequestError as exc:
            raise RuntimeError(f"SMSBower {endpoint} request failed: {exc}") from exc

        if resp.status_code >= 400:
            raise RuntimeError(f"SMSBower {endpoint} HTTP {resp.status_code}: {resp.text[:500]}")

        data = resp.json() if resp.content else {}

    if isinstance(data, dict) and data.get("status") == 0:
        raise RuntimeError(f"SMSBower {endpoint}: {data.get('error', 'unknown error')}")

    return data


def smsbower_create_mailbox(
    *,
    name: str | None = None,
    domain: str | None = None,
    expiry_ms: int | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    proxy: str | None = None,
    proxy_username: str | None = None,
    proxy_password: str | None = None,
) -> dict[str, Any]:
    """Purchase a temporary Gmail mailbox via SMSBower.

    Returns {"id": str, "email": str, "token": str, "provider": "smsbower", "raw": dict}
    """
    key = (api_key or "").strip()
    if not key:
        raise ValueError("SMSBower API key is required")

    dom = (domain or SMSBOWER_DEFAULT_DOMAIN).strip().lstrip("@").strip(".")

    data = _smsbower_get(
        "getActivation",
        api_key=key,
        base_url=base_url or SMSBOWER_DEFAULT_BASE_URL,
        params={"service": SMSBOWER_DEFAULT_SERVICE, "domain": dom},
    )

    mail_addr = str(data.get("mail") or "").strip()
    if not mail_addr or "@" not in mail_addr:
        raise RuntimeError(f"SMSBower getActivation did not return a valid email: {data}")

    mail_id = data.get("mailId")
    if mail_id is None:
        raise RuntimeError(f"SMSBower getActivation missing mailId: {data}")

    mail_id_str = str(mail_id)

    return {
        "id": mail_id_str,
        "email": mail_addr,
        "token": mail_id_str,
        "provider": "smsbower",
        "raw": data,
    }


def smsbower_fetch_messages(
    email_id: str,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    include_details: bool = True,
    address: str | None = None,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Poll SMSBower for a verification code. Returns synthetic message with extracted code."""
    key = (api_key or "").strip()
    if not key:
        raise ValueError("SMSBower API key is required")

    mail_id = (token or email_id or "").strip()

    try:
        data = _smsbower_get(
            "getCode",
            api_key=key,
            base_url=base_url or SMSBOWER_DEFAULT_BASE_URL,
            params={"mailId": mail_id},
            timeout=15.0,
        )
    except RuntimeError:
        return []

    code = str(data.get("code") or "").strip()
    if not code:
        return []

    text = f"verification code {code}"
    extracted = _extract_codes_and_links(text)

    return [{
        "id": f"{mail_id}-code",
        "subject": "Verification Code",
        "from": "noreply@smsbower",
        "text": text,
        "html": "",
        "content": text,
        "extracted": extracted,
    }]


def _smsbower_sms_api(
    api_key: str,
    action: str,
    base_url: str,
    extra_params: dict[str, Any] | None = None,
    timeout: float = 15.0,
) -> str:
    """Call the SMSBower SMS API (handler_api.php).

    Returns the raw text response body (e.g. "ACCESS_BALANCE:1.50").
    """
    mail_base = (base_url or SMSBOWER_DEFAULT_BASE_URL).rstrip("/")
    # Derive SMS API root from the mail API base.
    # Mail API:  https://smsbower.page/api/mail
    # SMS API:   https://smsbower.page/stubs/handler_api.php
    from urllib.parse import urlparse

    parsed = urlparse(mail_base if "://" in mail_base else f"https://{mail_base}")
    sms_base = f"{parsed.scheme}://{parsed.netloc}/stubs/handler_api.php"

    params: dict[str, Any] = {"api_key": api_key, "action": action}
    if extra_params:
        params.update(extra_params)

    with httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
        try:
            resp = client.get(sms_base, params=params)
        except httpx.RequestError as exc:
            raise RuntimeError(f"SMSBower SMS API {action}: {exc}") from exc

        if resp.status_code >= 400:
            raise RuntimeError(f"SMSBower SMS API {action} HTTP {resp.status_code}: {resp.text[:300]}")

        return (resp.text or "").strip()


def check_balance(
    api_key: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Query SMSBower account balance and email stock for OpenAI/Gmail.

    Uses the SMS API ``getBalance`` for a fast balance check, then the mail
    API ``getPriceRests`` for per-service stock info.

    Returns {"balance": float|None, "count": int|None, "currency": "USD", "raw": {...}}
    """
    key = (api_key or "").strip()
    if not key:
        raise ValueError("SMSBower API key is required")

    url = base_url or SMSBOWER_DEFAULT_BASE_URL

    # 1. Fast balance check via SMS API
    balance = None
    balance_raw = ""
    try:
        balance_raw = _smsbower_sms_api(key, "getBalance", url, timeout=15.0)
        # Response: "ACCESS_BALANCE:1.50"
        if balance_raw.startswith("ACCESS_BALANCE:"):
            balance = float(balance_raw.split(":", 1)[1].strip())
    except Exception:
        pass  # fall through to mail API

    # 2. Email stock check via mail API
    price = None
    count = None
    mail_raw: dict[str, Any] = {}
    try:
        data = _smsbower_get(
            "getPriceRests",
            api_key=key,
            base_url=url,
            params={"service": SMSBOWER_DEFAULT_SERVICE, "domain": SMSBOWER_DEFAULT_DOMAIN},
            timeout=20.0,
        )
        mail_raw = data
        inner = data.get("data") if isinstance(data, dict) else {}
        svc = inner.get(SMSBOWER_DEFAULT_SERVICE) if isinstance(inner, dict) else None
        dom = svc.get(SMSBOWER_DEFAULT_DOMAIN) if isinstance(svc, dict) else None
        if isinstance(dom, dict):
            try:
                price = float(dom.get("price", 0))
            except (TypeError, ValueError):
                pass
            try:
                count = int(dom.get("count", 0))
            except (TypeError, ValueError):
                pass
    except Exception:
        pass

    # Fallback: if balance is None, try to use price as a proxy for available credit
    display_balance = balance if balance is not None else price

    return {
        "balance": display_balance,
        "count": count,
        "currency": "USD",
        "raw": {"balance_api": balance_raw, "mail_api": mail_raw},
    }


def cancel_activation(
    mail_id: str,
    api_key: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Cancel / release a SMSBower activation (status=2)."""
    key = (api_key or "").strip()
    if not key:
        raise ValueError("SMSBower API key is required")

    return _smsbower_get(
        "setStatus",
        api_key=key,
        base_url=base_url or SMSBOWER_DEFAULT_BASE_URL,
        params={"id": str(mail_id), "status": "2"},
        timeout=10.0,
    )
