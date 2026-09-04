"""Persistent JSONL user operation audit log."""
from __future__ import annotations

import ipaddress
import json
import os
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix="/api/audit-logs", tags=["Operation Audit"])
PROJECT_ROOT = Path(__file__).resolve().parents[2]
_configured_dir = Path(os.environ.get("DATA_DIR", "data"))
DATA_DIRECTORY = _configured_dir if _configured_dir.is_absolute() else PROJECT_ROOT / _configured_dir
AUDIT_LOG_FILE = DATA_DIRECTORY / "operation-audit.jsonl"
_lock = threading.RLock()
_geo_lock = threading.RLock()
_geo_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_geo_reader: Any = None
_geo_reader_loaded = False
_GEO_CACHE_TTL_SECONDS = 24 * 3600
_GEO_DB_PATH = Path(os.environ.get("MERCURY_GEOIP_DB", str(DATA_DIRECTORY / "GeoLite2-City.mmdb")))


def _private_ip_location(ip: str) -> dict[str, Any] | None:
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if address.is_loopback:
        label = "本机"
    elif address.is_private or address.is_link_local:
        label = "内网"
    else:
        return None
    return {
        "label": label,
        "country": "",
        "country_code": "",
        "region": "",
        "city": "",
        "postal": "",
        "timezone": "",
        "latitude": None,
        "longitude": None,
        "isp": "",
        "org": "",
        "asn": "",
        "private": True,
        "available": True,
    }


def _geo_reader_instance() -> Any:
    global _geo_reader, _geo_reader_loaded
    with _geo_lock:
        if _geo_reader_loaded:
            return _geo_reader
        _geo_reader_loaded = True
        if not _GEO_DB_PATH.is_file():
            return None
        try:
            from geoip2.database import Reader
            _geo_reader = Reader(str(_GEO_DB_PATH))
        except Exception:
            _geo_reader = None
        return _geo_reader


def _geo_label(country: str, region: str, city: str) -> str:
    parts = [value for value in (country, region, city) if value]
    return " · ".join(parts) or "位置未知"


def lookup_ip_location(ip: str) -> dict[str, Any]:
    """Resolve a public IP via an optional local GeoLite2-City database."""
    normalized = str(ip or "").strip()
    if not normalized or normalized == "未知":
        return {"label": "位置未知", "available": False}
    private = _private_ip_location(normalized)
    if private is not None:
        return private
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        return {"label": "位置未知", "available": False}
    if not address.is_global:
        return {"label": "未知网络地址", "available": False}

    now = time.time()
    with _geo_lock:
        cached = _geo_cache.get(normalized)
        if cached and cached[0] > now:
            return dict(cached[1])
    reader = _geo_reader_instance()
    if reader is None:
        return {"label": "未配置 GeoIP 数据库", "available": False}
    try:
        record = reader.city(normalized)
        country = str(record.country.name or "").strip()
        country_code = str(record.country.iso_code or "").strip().upper()
        region = str((record.subdivisions.most_specific.name if record.subdivisions else "") or "").strip()
        city = str(record.city.name or "").strip()
        postal = str(record.postal.code or "").strip()
        timezone_name = str((record.location.time_zone if record.location else "") or "").strip()
        result = {
            "label": _geo_label(country, region, city),
            "country": country,
            "country_code": country_code,
            "region": region,
            "city": city,
            "postal": postal,
            "timezone": timezone_name,
            "latitude": record.location.latitude if record.location else None,
            "longitude": record.location.longitude if record.location else None,
            "isp": "",
            "org": "",
            "asn": "",
            "private": False,
            "available": True,
        }
    except Exception:
        result = {"label": "位置未知", "available": False}
    with _geo_lock:
        _geo_cache[normalized] = (time.time() + _GEO_CACHE_TTL_SECONDS, result)
    return dict(result)


MODULE_LABELS = {
    "auth": "账户安全",
    "microsoft": "邮箱管理",
    "grok": "注册任务",
    "register": "注册任务",
    "logs": "注册诊断",
    "audit-logs": "操作审计",
}


def module_for_path(path: str) -> str:
    for part in path.split("/"):
        if part in MODULE_LABELS:
            return MODULE_LABELS[part]
    return "工作台"


def action_for_request(method: str, path: str) -> str:
    normalized = path.rstrip("/").lower()
    if normalized.endswith("/login"):
        return "登录"
    if normalized.endswith("/logout"):
        return "退出登录"
    if normalized.endswith("/register"):
        return "注册"
    return {"POST": "执行", "PUT": "修改", "PATCH": "修改", "DELETE": "删除"}.get(method.upper(), method.upper())


def _read_records() -> list[dict[str, Any]]:
    if not AUDIT_LOG_FILE.is_file():
        return []
    records: list[dict[str, Any]] = []
    try:
        with AUDIT_LOG_FILE.open("r", encoding="utf-8") as stream:
            for line in stream:
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    records.append(value)
    except OSError:
        pass
    return records


def record_operation(
    *,
    request: Request | None,
    action: str,
    status_code: int,
    user: dict[str, Any] | None = None,
    detail: str = "",
    module: str = "",
    risk: str = "普通",
) -> dict[str, Any]:
    actor = user or {}
    email = str(actor.get("email") or "").strip().lower()
    username = str(actor.get("username") or email.split("@")[0] or "未知用户")
    forwarded = request.headers.get("x-forwarded-for", "") if request else ""
    client = request.client.host if request and request.client else ""
    ip = forwarded.split(",", 1)[0].strip() or client or "未知"
    geo = lookup_ip_location(ip)
    user_agent = request.headers.get("user-agent", "") if request else ""
    status = "成功" if 200 <= int(status_code) < 400 else "失败"
    path = request.url.path if request else ""
    record = {
        "id": f"AUD-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6].upper()}",
        "user": username,
        "email": email or "未知用户",
        "action": action,
        "module": module or module_for_path(path),
        "detail": detail or f"{action} {path}",
        "ip": ip,
        "geo": geo,
        "device": user_agent[:160] or "未知设备",
        "time": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "status": status,
        "risk": risk if risk in {"普通", "关注", "高风险"} else "普通",
        "statusCode": int(status_code),
    }
    with _lock:
        DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG_FILE.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


def _current_user(request: Request) -> dict[str, Any] | None:
    try:
        from mercury_auth import get_current_user
        return get_current_user(request)
    except HTTPException:
        return None


@router.get("")
async def list_operation_logs(
    request: Request,
    q: str = Query(default="", max_length=120),
    action: str = Query(default="", max_length=40),
    status: str = Query(default="", max_length=20),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    user = _current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    records = _read_records()
    if user.get("role") != "admin":
        email = str(user.get("email", "")).lower()
        records = [item for item in records if str(item.get("email", "")).lower() == email]
    keyword = q.strip().lower()
    filtered = [
        item for item in records
        if (not keyword or any(keyword in str(item.get(field, "")).lower() for field in ("id", "user", "email", "action", "module", "detail", "ip", "geo")))
        and (not action or item.get("action") == action)
        and (not status or item.get("status") == status)
    ]
    filtered.sort(key=lambda item: str(item.get("time", "")), reverse=True)
    # Enrich only the visible page so large audit histories stay fast.
    page_items = [
        {**item, "geo": item.get("geo") or lookup_ip_location(str(item.get("ip") or ""))}
        for item in filtered[offset : offset + limit]
    ]
    today = datetime.now().astimezone().strftime("%Y-%m-%d")
    return {
        "items": page_items,
        "total": len(filtered),
        "summary": {
            "today": sum(str(item.get("time", "")).startswith(today) for item in filtered),
            "activeUsers": len({str(item.get("email", "")) for item in filtered if item.get("email") != "未知用户"}),
            "success": sum(item.get("status") == "成功" for item in filtered),
            "risks": sum(item.get("risk") == "高风险" for item in filtered),
        },
    }

