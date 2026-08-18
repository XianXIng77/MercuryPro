"""Generic IMAP catch-all mailbox protocol.

Supports QQ domain forwarding (imap://imap.qq.com:993/INBOX) with a 16-digit
authorization code supplied as mail_api_key in the format `qq@example.com:1234567890123456`.
QQ IMAP authorization codes are single-use per service restart; always regenerate
after re-enabling IMAP in QQ settings. QQ inboxes require anti-spam whitelisting
for openai.com (and any other domains the registration flow targets).
"""

from __future__ import annotations

import email
import imaplib
import random
import re
import secrets
import ssl
import threading
from email import policy
from email.utils import getaddresses
from typing import Any
from urllib.parse import quote, unquote, urlparse

from .common import _extract_codes_and_links

# ----------------------------------------------------------------------------
# Human-looking local part generator (used by ChatGPT registrations)
# ----------------------------------------------------------------------------
# Common American first names (male + female), weighted toward real usage.
_FIRST_NAMES = (
    "james", "john", "robert", "michael", "william", "david", "richard", "joseph",
    "thomas", "charles", "christopher", "daniel", "matthew", "anthony", "mark",
    "donald", "steven", "andrew", "paul", "joshua", "kenneth", "kevin", "brian",
    "george", "timothy", "ronald", "edward", "jason", "jeffrey", "ryan", "jacob",
    "gary", "nicholas", "eric", "jonathan", "stephen", "larry", "justin", "scott",
    "brandon", "benjamin", "samuel", "gregory", "alexander", "frank", "patrick",
    "raymond", "jack", "dennis", "jerry", "tyler", "aaron", "jose", "adam",
    "henry", "nathan", "zachary", "peter", "kyle", "walter", "ethan", "jeremy",
    "keith", "christian", "roger", "noah", "gerald", "carl", "terry", "sean",
    "austin", "arthur", "lawrence", "jesse", "dylan", "bryan", "joe", "jordan",
    "billy", "bruce", "albert", "willie", "gabriel", "logan", "alan", "juan",
    "wayne", "roy", "ralph", "randy", "eugene", "vincent", "russell", "elijah",
    "louis", "bobby", "philip", "johnny",
    "mary", "patricia", "jennifer", "linda", "elizabeth", "barbara", "susan",
    "jessica", "sarah", "karen", "lisa", "nancy", "betty", "margaret", "sandra",
    "ashley", "kimberly", "emily", "donna", "michelle", "carol", "amanda",
    "dorothy", "melissa", "deborah", "stephanie", "rebecca", "sharon", "laura",
    "cynthia", "kathleen", "amy", "angela", "shirley", "anna", "brenda", "pamela",
    "emma", "nicole", "helen", "samantha", "katherine", "christine", "debra",
    "rachel", "carolyn", "janet", "catherine", "maria", "heather", "diane",
    "ruth", "julie", "olivia", "joyce", "virginia", "victoria", "kelly",
    "lauren", "christina", "joan", "evelyn", "judith", "megan", "andrea",
    "cheryl", "hannah", "jacqueline", "martha", "gloria", "teresa", "ann",
    "sara", "madison", "frances", "kathryn", "janice", "jean", "abigail",
    "alice", "julia", "judy", "sophia", "grace", "denise", "amber", "doris",
    "marilyn", "danielle", "beverly", "isabella", "theresa", "diana", "natalie",
    "brittany", "charlotte", "marie", "kayla", "alexis", "lorraine",
)

# Common American last names.
_LAST_NAMES = (
    "smith", "johnson", "williams", "brown", "jones", "garcia", "miller", "davis",
    "rodriguez", "martinez", "hernandez", "lopez", "gonzalez", "wilson",
    "anderson", "taylor", "moore", "jackson", "martin", "lee", "perez",
    "thompson", "white", "harris", "sanchez", "clark", "ramirez", "lewis",
    "robinson", "walker", "young", "allen", "king", "wright", "scott", "torres",
    "nguyen", "hill", "flores", "green", "adams", "nelson", "baker", "hall",
    "rivera", "campbell", "mitchell", "carter", "roberts", "gomez", "phillips",
    "evans", "turner", "diaz", "parker", "cruz", "edwards", "collins", "reyes",
    "stewart", "morris", "morales", "murphy", "cook", "rogers", "gutierrez",
    "ortiz", "morgan", "cooper", "peterson", "bailey", "reed", "kelly", "howard",
    "ramos", "cox", "ward", "richardson", "watson", "brooks", "chavez",
    "wood", "james", "bennett", "gray", "mendoza", "ruiz", "hughes", "price",
    "alvarez", "castillo", "sanders", "patel", "myers", "long", "ross", "foster",
    "jimenez", "barnes", "kim",
)

_LOCAL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

# Process-wide remembered local parts, so concurrent workers never collide.
_generated_locals: set[str] = set()
_generated_locals_lock = threading.Lock()


def _random_alphanumeric_part() -> str:
    """Fully random letter+digit local part, always starting with a letter."""
    length = random.randint(7, 12)
    head = random.choice("abcdefghijklmnopqrstuvwxyz")
    return head + "".join(
        random.choice(_LOCAL_ALPHABET) for _ in range(length - 1)
    )


def _number_suffix() -> str:
    """Random numeric suffix: year tail / full year / small or large number."""
    roll = random.random()
    if roll < 0.35:
        return str(random.randint(1980, 2005))[-2:]
    if roll < 0.55:
        return str(random.randint(1, 99))
    if roll < 0.68:
        return str(random.randint(1950, 2005))
    if roll < 0.8:
        return str(random.randint(100, 9999))
    return ""


def _human_local_part() -> str:
    """Generate an American-style person-looking local part.

    Examples: james.smith87 / m.williams / emily_johnson2001 / jsmith /
    daniel.r / x7k2p9q3r / sophia.lee1993
    """
    for _ in range(200):
        first = random.choice(_FIRST_NAMES)
        last = random.choice(_LAST_NAMES)
        style = random.random()
        if style < 0.26:
            # first.last — the most common American email pattern.
            local = f"{first}.{last}"
        elif style < 0.47:
            # first_last
            local = f"{first}_{last}"
        elif style < 0.64:
            # firstlast
            local = f"{first}{last}"
        elif style < 0.75:
            # f.last (initial + last name)
            local = f"{first[:1]}.{last}"
        elif style < 0.83:
            # first.l (first name + last initial)
            local = f"{first}.{last[:1]}"
        elif style < 0.89:
            # flast (initial + last, gmail-style)
            local = f"{first[:1]}{last}"
        else:
            # 纯随机字母数字混排,满足"数字字母混合"的随机需求。
            local = _random_alphanumeric_part()
        # 人名风格前缀追加随机数字后缀;纯随机串本身已含数字,不再追加。
        if style < 0.89 and random.random() < 0.85:
            local += _number_suffix()
        if not 6 <= len(local) <= 24:
            continue
        with _generated_locals_lock:
            if local in _generated_locals:
                continue
            _generated_locals.add(local)
            if len(_generated_locals) > 50000:
                # Reset periodically so the set never grows unbounded.
                _generated_locals.clear()
                _generated_locals.add(local)
        return local
    # Practically unreachable; fall back to a random alphanumeric local part.
    return "user" + secrets.token_hex(6)


# ----------------------------------------------------------------------------
# QQ-specific IMAP configuration
# ----------------------------------------------------------------------------
def _imap_config(base_url: str | None, api_key: str | None) -> dict[str, Any]:
    """Parse imap:// or imaps:// base_url + QQ authorization code (username:code)."""
    raw_url = (base_url or "").strip()
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"imap", "imaps"} or not parsed.hostname:
        raise ValueError("IMAP address must use imap:// or imaps://")

    secret = (api_key or "").strip()
    username = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    if secret:
        if ":" not in secret:
            raise ValueError("QQ IMAP API Key must be in the format `qq@example.com:1234567890123456`")
        username, password = secret.split(":", 1)
    if not username or not password:
        raise ValueError("QQ IMAP credentials are missing")

    secure = parsed.scheme == "imaps"
    return {
        "host": parsed.hostname,
        "port": parsed.port or (993 if secure else 143),
        "secure": secure,
        "username": username.strip(),
        "password": password,
        "folder": unquote((parsed.path or "/INBOX").lstrip("/")) or "INBOX",
    }


def imap_test_connection(
    *,
    base_url: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Verify IMAP host/credentials/folder without registering anything.

    Works for both generic IMAP and QQ domain forwarding.
    """
    try:
        config = _imap_config(base_url, api_key)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    try:
        client = _imap_connect(config)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    try:
        return {
            "ok": True,
            "host": config["host"],
            "port": config["port"],
            "username": config["username"],
            "folder": config["folder"],
        }
    finally:
        try:
            client.logout()
        except Exception:
            pass


def _imap_connect(config: dict[str, Any]) -> imaplib.IMAP4:
    """Internal IMAP connect helper (used by test and fetch)."""
    if config["secure"]:
        client = imaplib.IMAP4_SSL(
            config["host"],
            config["port"],
            ssl_context=ssl.create_default_context(),
        )
    else:
        client = imaplib.IMAP4(config["host"], config["port"])
    client.login(config["username"], config["password"])
    status, _ = client.select(config["folder"], readonly=True)
    if status != "OK":
        client.logout()
        raise RuntimeError(f"IMAP folder is unavailable: {config['folder']}")
    return client


def imap_create_mailbox(
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
    """Create a virtual address received by the QQ catch-all inbox.

    For QQ domain forwarding, the mailbox name is generated as a realistic
    American-style local part (e.g. james.smith87@xing1024.com). The QQ
    authorization code is supplied via mail_api_key.
    """
    del expiry_ms, proxy, proxy_username, proxy_password
    dom = _pick_domain(domain)
    if name and name.strip():
        local = re.sub(r"[^a-z0-9._+-]", "", name.strip().lower())
    else:
        local = _human_local_part()
    if not local:
        raise ValueError("IMAP mailbox name is required")

    config = _imap_config(base_url, api_key)
    client = _imap_connect(config)
    try:
        client.noop()
    finally:
        client.logout()

    address = f"{local}@{dom}"
    return {
        "id": address,
        "email": address,
        "token": "",
        "provider": "imap",
    }


def imap_fetch_messages(
    email_id: str,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    include_details: bool = True,
    address: str | None = None,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Read recent messages addressed to one virtual catch-all address."""
    del include_details, token
    target = (address or email_id or "").strip().lower()
    if "@" not in target:
        return []

    config = _imap_config(base_url, api_key)
    client = _imap_connect(config)
    try:
        status, data = client.uid("search", None, "ALL")
        if status != "OK" or not data:
            return []
        uids = data[0].split()[-100:]
        messages: list[dict[str, Any]] = []
        for uid in reversed(uids):
            status, payload = client.uid("fetch", uid, "(BODY.PEEK[])")
            if status != "OK" or not payload:
                continue
            raw = next(
                (
                    item[1]
                    for item in payload
                    if isinstance(item, tuple) and isinstance(item[1], bytes)
                ),
                None,
            )
            if raw is None:
                continue
            message = email.message_from_bytes(raw, policy=policy.default)
            if target not in _message_recipients(message):
                continue
            text, html = _message_content(message)
            content = "\n".join((str(message.get("subject") or ""), text, html))
            messages.append(
                {
                    "id": uid.decode(errors="replace"),
                    "subject": str(message.get("subject") or ""),
                    "from": str(message.get("from") or ""),
                    "to": str(message.get("to") or ""),
                    "date": str(message.get("date") or ""),
                    "text": text,
                    "html": html,
                    "content": content,
                    "extracted": _extract_codes_and_links(content),
                }
            )
            if len(messages) >= 20:
                break
        return messages
    finally:
        client.logout()


# ----------------------------------------------------------------------------
# Shared helpers (kept for compatibility)
# ----------------------------------------------------------------------------
def _pick_domain(value: str | None) -> str:
    """Pick one domain from comma/semicolon/space-separated list."""
    domains = [
        item.strip().lstrip("@").strip(".").lower()
        for item in re.split(r"[,;\s]+", value or "")
        if item.strip()
    ]
    domains = list(dict.fromkeys(domains))
    if not domains:
        raise ValueError("IMAP mailbox domain is required")
    invalid = [
        domain
        for domain in domains
        if not re.fullmatch(
            r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?",
            domain,
        )
    ]
    if invalid:
        raise ValueError(f"Invalid IMAP mailbox domain: {invalid[0]}")
    return random.choice(domains)


def _message_recipients(message: email.message.Message) -> set[str]:
    values: list[str] = []
    for header in (
        "to",
        "cc",
        "delivered-to",
        "envelope-to",
        "x-envelope-to",
        "x-original-to",
        "original-recipient",
    ):
        values.extend(message.get_all(header, []))
    recipients = {address.lower() for _, address in getaddresses(values) if address}
    # Some MTAs only preserve the catch-all target in a Received header.
    for received in message.get_all("received", []):
        recipients.update(
            match.lower()
            for match in re.findall(r"\bfor\s+<?([^>;\s]+@[^>;\s]+)>?", received, re.I)
        )
    return recipients


def _message_content(message: email.message.Message) -> tuple[str, str]:
    texts: list[str] = []
    htmls: list[str] = []
    parts = message.walk() if message.is_multipart() else (message,)
    for part in parts:
        if part.get_content_disposition() == "attachment":
            continue
        content_type = (part.get_content_type() or "").lower()
        if content_type not in {"text/plain", "text/html"}:
            continue
        try:
            value = part.get_content()
        except Exception:
            payload = part.get_payload(decode=True)
            if not isinstance(payload, bytes):
                continue
            value = payload.decode(
                part.get_content_charset() or "utf-8", errors="replace"
            )
        if not isinstance(value, str):
            continue
        (htmls if content_type == "text/html" else texts).append(value)
    return "\n".join(texts), "\n".join(htmls)
