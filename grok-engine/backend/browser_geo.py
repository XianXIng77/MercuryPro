"""Resolve browser locale and timezone from the active proxy exit."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit


GEO_LOOKUP_URL = "https://ipwho.is/"
DEFAULT_LOCALE = "en-US"
DEFAULT_TIMEZONE = "America/New_York"

# Camoufox 0.5 removed the public territory selector that 0.4 exposed. Keep
# locale selection deterministic instead of silently falling back to en-US for
# every proxy country. Values here cover the common residential-proxy regions;
# unknown countries still use the safe project default.
_COUNTRY_LOCALES = {
    "AE": "ar-AE",
    "AR": "es-AR",
    "AT": "de-AT",
    "AU": "en-AU",
    "BE": "nl-BE",
    "BR": "pt-BR",
    "CA": "en-CA",
    "CH": "de-CH",
    "CL": "es-CL",
    "CN": "zh-CN",
    "CO": "es-CO",
    "CZ": "cs-CZ",
    "DE": "de-DE",
    "DK": "da-DK",
    "ES": "es-ES",
    "FI": "fi-FI",
    "FR": "fr-FR",
    "GB": "en-GB",
    "GR": "el-GR",
    "HK": "zh-HK",
    "HU": "hu-HU",
    "ID": "id-ID",
    "IE": "en-IE",
    "IL": "he-IL",
    "IN": "hi-IN",
    "IT": "it-IT",
    "JP": "ja-JP",
    "KR": "ko-KR",
    "MX": "es-MX",
    "MY": "ms-MY",
    "NL": "nl-NL",
    "NO": "nb-NO",
    "NZ": "en-NZ",
    "PH": "en-PH",
    "PL": "pl-PL",
    "PT": "pt-PT",
    "RO": "ro-RO",
    "RU": "ru-RU",
    "SA": "ar-SA",
    "SE": "sv-SE",
    "SG": "en-SG",
    "TH": "th-TH",
    "TR": "tr-TR",
    "TW": "zh-TW",
    "UA": "uk-UA",
    "US": "en-US",
    "VN": "vi-VN",
    "ZA": "en-ZA",
}


def _proxy_request_url(proxy: dict[str, str] | None) -> str | None:
    """Convert a Playwright proxy dictionary to an authenticated proxy URL."""
    if not proxy or not str(proxy.get("server") or "").strip():
        return None
    server = str(proxy["server"]).strip()
    source = server if "://" in server else f"http://{server}"
    parsed = urlsplit(source)
    if not parsed.hostname:
        raise ValueError("proxy server is missing a hostname")

    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    port = f":{parsed.port}" if parsed.port else ""
    username = str(proxy.get("username") or "")
    password = str(proxy.get("password") or "")
    auth = ""
    if username:
        auth = quote(username, safe="")
        if password:
            auth += f":{quote(password, safe='')}"
        auth += "@"
    return urlunsplit((parsed.scheme or "http", f"{auth}{host}{port}", "", "", ""))


def _dominant_locale(country_code: str) -> str:
    """Return the most widely used Camoufox locale for an ISO country code."""
    code = str(country_code or "").strip().upper()
    if not code:
        return DEFAULT_LOCALE
    try:
        from camoufox.locale import SELECTOR, normalize_locale

        languages, probabilities = SELECTOR._load_territory_data(code)
        index = max(range(len(probabilities)), key=lambda item: float(probabilities[item]))
        language = str(languages[index]).replace("_", "-")
        return normalize_locale(f"{language}-{code}").as_string
    except Exception:
        return _COUNTRY_LOCALES.get(code, DEFAULT_LOCALE)


def _profile_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("success") is False:
        raise ValueError(str(payload.get("message") or "IP location lookup failed"))

    ip = str(payload.get("ip") or "").strip()
    country_code = str(payload.get("country_code") or "").strip().upper()
    timezone_value = payload.get("timezone")
    if isinstance(timezone_value, dict):
        timezone_id = str(timezone_value.get("id") or "").strip()
    else:
        timezone_id = str(timezone_value or "").strip()
    if not ip or not country_code or not timezone_id:
        raise ValueError("IP location response is incomplete")

    profile: dict[str, Any] = {
        "resolved": True,
        "ip": ip,
        "country_code": country_code,
        "country": str(payload.get("country") or "").strip(),
        "region": str(payload.get("region") or "").strip(),
        "city": str(payload.get("city") or "").strip(),
        "locale": _dominant_locale(country_code),
        "timezone": timezone_id,
    }
    try:
        profile["latitude"] = float(payload["latitude"])
        profile["longitude"] = float(payload["longitude"])
    except (KeyError, TypeError, ValueError):
        pass
    return profile


def resolve_browser_geo_profile(
    proxy: dict[str, str] | None,
    *,
    timeout: float = 6.0,
) -> dict[str, Any]:
    """Resolve a browser regional profile through the same proxy as the browser."""
    fallback: dict[str, Any] = {
        "resolved": False,
        "ip": "",
        "country_code": "US",
        "country": "",
        "region": "",
        "city": "",
        "locale": DEFAULT_LOCALE,
        "timezone": DEFAULT_TIMEZONE,
    }
    try:
        import httpx

        request_proxy = _proxy_request_url(proxy)
        with httpx.Client(
            proxy=request_proxy,
            timeout=httpx.Timeout(timeout, connect=min(timeout, 4.0)),
            follow_redirects=True,
            trust_env=False,
            headers={"User-Agent": "MercuryPro browser region resolver/1.0"},
        ) as client:
            response = client.get(GEO_LOOKUP_URL)
            response.raise_for_status()
            return _profile_from_payload(response.json())
    except Exception as exc:  # noqa: BLE001 - regional matching must be best effort
        fallback["error"] = f"{exc.__class__.__name__}: {exc}"
        return fallback


def camoufox_region_options(profile: dict[str, Any]) -> dict[str, Any]:
    """Translate a resolved/fallback profile into Camoufox launch options."""
    locale = str(profile.get("locale") or DEFAULT_LOCALE)
    timezone_id = str(profile.get("timezone") or DEFAULT_TIMEZONE)
    config: dict[str, Any] = {"timezone": timezone_id}
    if "latitude" in profile and "longitude" in profile:
        config.update(
            {
                "geolocation:latitude": float(profile["latitude"]),
                "geolocation:longitude": float(profile["longitude"]),
                "geolocation:accuracy": 50,
            }
        )
    return {
        "locale": locale,
        "config": config,
        # These settings intentionally align the browser with its network exit.
        "i_know_what_im_doing": True,
    }
