"""SMSBower API protocol — purchase Gmail mailboxes and receive verification codes.

Implements the standard mail-protocol interface (create_mailbox / fetch_messages)
backed by the SMSBower REST API.  Each registration purchases a temporary Gmail
address on demand; codes are polled via SMSBower's getCode endpoint.

API reference: https://smsbower.app/cn/api  (mail: https://smsbower.app/cn/api?page=mails)

Endpoint summary
----------------
Mail API base  https://smsbower.page/api/mail/
SMS API base   https://smsbower.page/stubs/handler_api.php
Auth           ?api_key=YOUR_KEY  (query parameter on every request)

getMailServicesList  GET …/handler_api.php?action=getMailServicesList
                     → {"status":"success","services":[{"code":"kt","name":"KakaoTalk"}]}

getBalance           GET …/handler_api.php?action=getBalance
                     → ACCESS_BALANCE:12.34  (plain text)

getActivation        GET …/getActivation?api_key=…&service=dr&domain=gmail.com
                     → {"status":1, "mail":"…@gmail.com", "mailId":123}

getCode              GET …/getCode?api_key=…&mailId=123
                     → {"status":1, "code":"654321"}

getPriceRests        GET …/getPriceRests?api_key=…&service=dr&domain=gmail.com
                     → {"status":1, "data":{"dr":{"gmail.com":{"price":"0.05","count":10}}}}

setStatus            GET …/setStatus?api_key=…&id=123&status=3
                     status: 2=cancel, 3=complete (confirm receipt), 5=wait for next code
"""
from __future__ import annotations

from typing import Any

import httpx

from .common import _extract_codes_and_links

# ---------------------------------------------------------------------------
# SMSBower API constants
# ---------------------------------------------------------------------------
SMSBOWER_DEFAULT_BASE_URL = "https://smsbower.page/api/mail"

# Fallback service code — call getMailServicesList() at runtime to verify.
# The service list can change; do not rely on this value without checking.
SMSBOWER_DEFAULT_SERVICE = "dr"

# Gmail is the recommended domain for OpenAI registrations.
SMSBOWER_DEFAULT_DOMAIN = "gmail.com"


def _normalize_base(base_url: str | None) -> str:
    base = (base_url or SMSBOWER_DEFAULT_BASE_URL).strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        base = f"https://{base}"
    return base


def _smsbower_get(
    endpoint: str,
    api_key: str,
    base_url: str,
    params: dict[str, Any] | None = None,
    timeout: float = 45.0,
) -> dict[str, Any]:
    """Call a SMSBower mail API endpoint (GET with api_key query param).

    If the configured base URL is unreachable, retries once against the
    official default base URL so a stale/wrong address doesn't hard-fail.
    """
    base = _normalize_base(base_url)
    query: dict[str, Any] = {"api_key": api_key}
    if params:
        query.update(params)

    bases = [base]
    if base != SMSBOWER_DEFAULT_BASE_URL:
        bases.append(SMSBOWER_DEFAULT_BASE_URL)

    # Use generous timeouts — SMSBower API can be slow from some regions.
    with httpx.Client(timeout=httpx.Timeout(timeout, connect=15.0)) as client:
        last_exc: Exception | None = None
        resp = None
        for candidate in bases:
            try:
                resp = client.get(f"{candidate}/{endpoint.lstrip('/')}", params=query)
                break
            except httpx.RequestError as exc:
                last_exc = exc
        if resp is None:
            raise RuntimeError(f"SMSBower {endpoint} request failed: {last_exc}") from last_exc

        if resp.status_code >= 400:
            raise RuntimeError(f"SMSBower {endpoint} HTTP {resp.status_code}: {resp.text[:500]}")

        data = resp.json() if resp.content else {}

    if isinstance(data, dict) and data.get("status") == 0:
        detail = data.get("error") or data.get("message") or "unknown error"
        raise RuntimeError(f"SMSBower {endpoint}: {detail}")

    return data


# ---------------------------------------------------------------------------
# SMS API (handler_api.php) — balance, service list, etc.
# ---------------------------------------------------------------------------


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
    mail_base = _normalize_base(base_url)
    # Derive SMS API root from the mail API base.
    # Mail API:  https://smsbower.page/api/mail
    # SMS API:   https://smsbower.page/stubs/handler_api.php
    from urllib.parse import urlparse

    candidates = [mail_base]
    if mail_base != SMSBOWER_DEFAULT_BASE_URL:
        candidates.append(SMSBOWER_DEFAULT_BASE_URL)

    params: dict[str, Any] = {"api_key": api_key, "action": action}
    if extra_params:
        params.update(extra_params)

    with httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
        last_exc: Exception | None = None
        resp = None
        for candidate in candidates:
            parsed = urlparse(candidate)
            sms_base = f"{parsed.scheme}://{parsed.netloc}/stubs/handler_api.php"
            try:
                resp = client.get(sms_base, params=params)
                break
            except httpx.RequestError as exc:
                last_exc = exc
        if resp is None:
            raise RuntimeError(f"SMSBower SMS API {action}: {last_exc}") from last_exc

        if resp.status_code >= 400:
            raise RuntimeError(f"SMSBower SMS API {action} HTTP {resp.status_code}: {resp.text[:300]}")

        return (resp.text or "").strip()


def get_mail_services_list(
    api_key: str,
    base_url: str | None = None,
) -> list[dict[str, str]]:
    """Fetch the current mail service list from SMSBower.

    Returns a list of {"code": "…", "name": "…"} dicts.
    Call this before creating activations to confirm the correct service code.
    """
    key = (api_key or "").strip()
    if not key:
        raise ValueError("SMSBower API key is required")

    raw = _smsbower_sms_api(key, "getMailServicesList", base_url or SMSBOWER_DEFAULT_BASE_URL)

    # The SMS API may return JSON for this action.
    import json as _json

    try:
        data = _json.loads(raw)
    except _json.JSONDecodeError:
        raise RuntimeError(f"SMSBower getMailServicesList returned non-JSON: {raw[:300]}")

    if isinstance(data, dict):
        if data.get("status") == "success" and isinstance(data.get("services"), list):
            return [{"code": str(s.get("code", "")), "name": str(s.get("name", ""))}
                    for s in data["services"] if isinstance(s, dict)]
        # Some error responses come back as JSON with an error field.
        err = data.get("error") or data.get("message") or ""
        if err:
            raise RuntimeError(f"SMSBower getMailServicesList: {err}")

    raise RuntimeError(f"SMSBower getMailServicesList unexpected response: {raw[:300]}")


def resolve_service_code(
    api_key: str,
    target_name: str,
    base_url: str | None = None,
) -> str | None:
    """Look up the service code for a named service (case-insensitive match).

    Returns the ``code`` string, or ``None`` if no match is found.
    """
    services = get_mail_services_list(api_key, base_url=base_url)
    target_lower = target_name.strip().lower()
    for svc in services:
        if svc["name"].strip().lower() == target_lower:
            return svc["code"]
    return None


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
    service: str | None = None,
    max_price: float | None = None,
) -> dict[str, Any]:
    """Purchase a temporary Gmail mailbox via SMSBower.

    ``service`` is the target platform's service code (e.g. "dr" for OpenAI).
    If omitted, uses ``SMSBOWER_DEFAULT_SERVICE`` — but you should verify the
    current code via ``get_mail_services_list()`` / ``resolve_service_code()`` first.

    Returns {"id": str, "email": str, "token": str, "provider": "smsbower", "raw": dict}
    """
    key = (api_key or "").strip()
    if not key:
        raise ValueError("SMSBower API key is required")

    dom = (domain or SMSBOWER_DEFAULT_DOMAIN).strip().lstrip("@").strip(".")
    svc = (service or SMSBOWER_DEFAULT_SERVICE).strip()

    params: dict[str, Any] = {"service": svc, "domain": dom}
    if max_price is not None and max_price > 0:
        params["maxPrice"] = str(max_price)

    data = _smsbower_get(
        "getActivation",
        api_key=key,
        base_url=base_url or SMSBOWER_DEFAULT_BASE_URL,
        params=params,
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


def check_balance(
    api_key: str,
    base_url: str | None = None,
    *,
    service: str | None = None,
    domain: str | None = None,
) -> dict[str, Any]:
    """Query SMSBower account balance and email stock.

    Uses the SMS API ``getBalance`` for balance, then the mail API
    ``getPriceRests`` for per-service stock info.

    Returns {"balance": float|None, "count": int|None, "price": float|None, "currency": "USD", "raw": {...}}
    """
    key = (api_key or "").strip()
    if not key:
        raise ValueError("SMSBower API key is required")

    url = base_url or SMSBOWER_DEFAULT_BASE_URL
    svc = (service or SMSBOWER_DEFAULT_SERVICE).strip()
    dom = (domain or SMSBOWER_DEFAULT_DOMAIN).strip()

    # 1. Fast balance check via SMS API
    balance = None
    balance_raw = ""
    try:
        balance_raw = _smsbower_sms_api(key, "getBalance", url, timeout=15.0)
        # Response: "ACCESS_BALANCE:12.34"
        if balance_raw.startswith("ACCESS_BALANCE:"):
            balance = float(balance_raw.split(":", 1)[1].strip())
    except Exception:
        pass

    # 2. Email stock & price check via mail API
    price = None
    count = None
    mail_raw: dict[str, Any] = {}
    try:
        data = _smsbower_get(
            "getPriceRests",
            api_key=key,
            base_url=url,
            params={"service": svc, "domain": dom},
            timeout=20.0,
        )
        mail_raw = data
        inner = data.get("data") if isinstance(data, dict) else {}
        svc_data = inner.get(svc) if isinstance(inner, dict) else None
        dom_data = svc_data.get(dom) if isinstance(svc_data, dict) else None
        if isinstance(dom_data, dict):
            try:
                price = float(dom_data.get("price", 0))
            except (TypeError, ValueError):
                pass
            try:
                count = int(dom_data.get("count", 0))
            except (TypeError, ValueError):
                pass
    except Exception:
        pass

    return {
        "balance": balance,
        "count": count,
        "price": price,
        "currency": "USD",
        "raw": {"balance_api": balance_raw, "mail_api": mail_raw},
    }


# ---------------------------------------------------------------------------
# Activation lifecycle: complete, cancel, wait-for-next-code
# ---------------------------------------------------------------------------


def set_activation_status(
    mail_id: str,
    status: int,
    api_key: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Update a SMSBower activation's status.

    Status values (per SMSBower docs):
      2 — cancel activation (release reservation, no charge)
      3 — complete activation (confirm receipt, settle charge)
      5 — wait for next verification code
    """
    key = (api_key or "").strip()
    if not key:
        raise ValueError("SMSBower API key is required")

    if status not in (2, 3, 5):
        raise ValueError(f"Invalid activation status: {status} (expected 2, 3, or 5)")

    return _smsbower_get(
        "setStatus",
        api_key=key,
        base_url=base_url or SMSBOWER_DEFAULT_BASE_URL,
        params={"id": str(mail_id), "status": str(status)},
        timeout=10.0,
    )


def complete_activation(
    mail_id: str,
    api_key: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Confirm receipt of verification code and settle the charge (status=3).

    Call this after successfully retrieving the verification code so the
    reserved balance is properly settled.
    """
    return set_activation_status(mail_id, 3, api_key, base_url=base_url)


def cancel_activation(
    mail_id: str,
    api_key: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Cancel / release a SMSBower activation without charge (status=2)."""
    return set_activation_status(mail_id, 2, api_key, base_url=base_url)


def wait_for_next_code(
    mail_id: str,
    api_key: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Request the next verification code for this activation (status=5)."""
    return set_activation_status(mail_id, 5, api_key, base_url=base_url)
