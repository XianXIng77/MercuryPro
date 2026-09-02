"""Filesystem-backed invitation codes used to gate account registration."""

from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any


DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "runtime" / "data"
INVITE_CODES_FILE = Path(
    os.environ.get("MERCURY_INVITE_CODES_FILE", str(DEFAULT_DATA_DIR / "invite-codes.json"))
)
_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_lock = RLock()


class InviteCodeError(ValueError):
    """Raised when an invitation code is missing, invalid, or revoked."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_unlocked() -> list[dict[str, Any]]:
    if not INVITE_CODES_FILE.is_file():
        return []
    try:
        payload = json.loads(INVITE_CODES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    raw_codes = payload.get("codes") if isinstance(payload, dict) else payload
    if not isinstance(raw_codes, list):
        return []
    records: list[dict[str, Any]] = []
    for item in raw_codes:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip().upper()
        if not code:
            continue
        records.append(
            {
                "code": code,
                "created_at": str(item.get("created_at") or ""),
                "uses": max(0, int(item.get("uses") or 0)),
                "max_uses": max(1, int(item.get("max_uses") or 1)),
                "last_used_at": item.get("last_used_at"),
                "enabled": bool(item.get("enabled", True)),
            }
        )
    return records


def _save_unlocked(records: list[dict[str, Any]]) -> None:
    INVITE_CODES_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = INVITE_CODES_FILE.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps({"codes": records}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, INVITE_CODES_FILE)


def _new_code(existing: set[str]) -> str:
    while True:
        code = "MP-" + "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(10))
        if code not in existing:
            return code


def _public(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": str(record.get("code") or ""),
        "created_at": str(record.get("created_at") or ""),
        "uses": max(0, int(record.get("uses") or 0)),
        "max_uses": max(1, int(record.get("max_uses") or 1)),
        "last_used_at": record.get("last_used_at"),
        "enabled": bool(record.get("enabled", True)),
    }


def list_invite_codes(keyword: str = "", page: int = 1, page_size: int = 10, status: str = "") -> dict[str, Any]:
    """Return a filtered, newest-first page of invitation codes."""
    normalized_keyword = str(keyword or "").strip().upper()
    normalized_status = str(status or "").strip().lower()
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 10), 100))
    with _lock:
        records = _load_unlocked()
    records.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)

    def record_status(item: dict[str, Any]) -> str:
        if not bool(item.get("enabled", True)):
            return "invalid"
        if int(item.get("uses") or 0) >= max(1, int(item.get("max_uses") or 1)):
            return "used"
        return "valid"

    filtered = [
        item for item in records
        if (not normalized_keyword or normalized_keyword in str(item.get("code") or "").upper())
        and (not normalized_status or normalized_status == record_status(item))
    ]
    total = len(filtered)
    pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, pages)
    start = (page - 1) * page_size
    items = filtered[start:start + page_size]
    return {
        "ok": True,
        "codes": [_public(item) | {"status": record_status(item)} for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


def generate_invite_codes(count: int = 1, max_uses: int = 1) -> dict[str, Any]:
    count = max(1, min(int(count or 1), 50))
    max_uses = max(1, min(int(max_uses or 1), 1000))
    with _lock:
        records = _load_unlocked()
        existing = {str(item.get("code") or "") for item in records}
        created: list[dict[str, Any]] = []
        for _ in range(count):
            record = {
                "code": _new_code(existing),
                "created_at": _now(),
                "uses": 0,
                "max_uses": max_uses,
                "last_used_at": None,
                "enabled": True,
            }
            existing.add(record["code"])
            records.append(record)
            created.append(record)
        _save_unlocked(records)
    return {"ok": True, "codes": [_public(item) for item in created]}


def revoke_invite_code(code: str) -> dict[str, Any]:
    normalized = str(code or "").strip().upper()
    if not normalized:
        raise InviteCodeError("邀请码不能为空")
    with _lock:
        records = _load_unlocked()
        for record in records:
            if str(record.get("code") or "").upper() == normalized:
                record["enabled"] = False
                _save_unlocked(records)
                return {"ok": True, "code": _public(record)}
    raise InviteCodeError("邀请码不存在")


def update_invite_code(code: str, max_uses: int) -> dict[str, Any]:
    """Update the usage allowance for an existing invitation code."""
    normalized = str(code or "").strip().upper()
    if not normalized:
        raise InviteCodeError("邀请码不能为空")
    max_uses = max(1, min(int(max_uses or 1), 1000))
    with _lock:
        records = _load_unlocked()
        for record in records:
            if str(record.get("code") or "").upper() != normalized:
                continue
            if not bool(record.get("enabled", True)):
                raise InviteCodeError("邀请码已撤销，不能修改")
            if max_uses < int(record.get("uses") or 0):
                raise InviteCodeError("可使用次数不能小于已使用次数")
            record["max_uses"] = max_uses
            _save_unlocked(records)
            return {"ok": True, "code": _public(record)}
    raise InviteCodeError("邀请码不存在")


def use_invite_code(code: str) -> dict[str, Any]:
    normalized = str(code or "").strip().upper()
    if not normalized:
        raise InviteCodeError("请输入邀请码")
    with _lock:
        records = _load_unlocked()
        for record in records:
            if str(record.get("code") or "").upper() != normalized:
                continue
            if not bool(record.get("enabled", True)):
                raise InviteCodeError("邀请码已撤销")
            max_uses = max(1, int(record.get("max_uses") or 1))
            if int(record.get("uses") or 0) >= max_uses:
                raise InviteCodeError("Invitation code already used")
            record["uses"] = int(record.get("uses") or 0) + 1
            record["last_used_at"] = _now()
            _save_unlocked(records)
            return _public(record)
    raise InviteCodeError("邀请码无效")