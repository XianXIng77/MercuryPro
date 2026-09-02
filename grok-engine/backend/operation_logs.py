"""Persistent JSONL user operation audit log."""
from __future__ import annotations

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
        if (not keyword or any(keyword in str(item.get(field, "")).lower() for field in ("id", "user", "email", "action", "module", "detail", "ip")))
        and (not action or item.get("action") == action)
        and (not status or item.get("status") == status)
    ]
    filtered.sort(key=lambda item: str(item.get("time", "")), reverse=True)
    today = datetime.now().astimezone().strftime("%Y-%m-%d")
    return {
        "items": filtered[offset : offset + limit],
        "total": len(filtered),
        "summary": {
            "today": sum(str(item.get("time", "")).startswith(today) for item in filtered),
            "activeUsers": len({str(item.get("email", "")) for item in filtered if item.get("email") != "未知用户"}),
            "success": sum(item.get("status") == "成功" for item in filtered),
            "risks": sum(item.get("risk") == "高风险" for item in filtered),
        },
    }
