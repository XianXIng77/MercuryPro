"""Registration diagnostics API (/api/logs/*).

Reads target-specific incident folders from log/grok and log/openai
and continues to expose legacy incident folders stored directly under
log. The list endpoint supports target, email, stage, and outcome filters;
detail endpoints accept target-prefixed IDs such as grok--<folder>.
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse

from chatgpt_registration.diagnostics import (
    REGISTRATION_TARGETS,
    _log_root,
    normalize_registration_target,
)

router = APIRouter(prefix="/api/logs", tags=["Registration Logs"])

_FOLDER_ID_PATTERN = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._-]*$")
_EMAIL_LINE_PATTERN = re.compile(r"^邮箱:\s*(.+)$", re.MULTILINE)

STAGES = ("plus-trial", "checkout-kind", "registration-error")


def _log_dir() -> Path:
    return _log_root(None)


def _parse_incident(
    directory: Path,
    registration_target: str | None = None,
) -> dict[str, Any] | None:
    """把一个事件目录解析为列表项;目录名不符合格式时返回 None。"""
    nested = registration_target is not None
    parts = directory.name.split("_", 3)
    if len(parts) != 4:
        return None
    stamp, stage, outcome, email = parts
    try:
        when = datetime.strptime(stamp, "%Y%m%d-%H%M%S.%f")
    except ValueError:
        return None
    log_file = directory / "log.txt"
    head = ""
    if log_file.is_file():
        try:
            head = log_file.read_text(encoding="utf-8", errors="replace")[:600]
            match = _EMAIL_LINE_PATTERN.search(head)
            if match:
                email = match.group(1).strip()
        except OSError:
            pass
    if registration_target is None:
        text = head.lower()
        registration_target = (
            "openai"
            if stage in {"plus-trial", "checkout-kind"}
            else "grok"
            if "xai" in text or "grok" in text
            else "openai"
        )
    target = normalize_registration_target(registration_target)
    return {
        "id": f"{target}--{directory.name}" if nested else directory.name,
        "time": when.strftime("%Y-%m-%d %H:%M:%S"),
        "stage": stage,
        "outcome": outcome,
        "email": email,
        "registrationTarget": target,
        "hasScreenshot": (directory / "screenshot.png").is_file(),
    }


def _resolve_incident_dir(log_id: str) -> Path:
    """Validate an API id and locate its incident directory."""
    base = _log_dir()
    target, separator, folder = log_id.partition("--")
    if separator:
        if (
            target not in REGISTRATION_TARGETS
            or folder in {".", ".."}
            or not _FOLDER_ID_PATTERN.fullmatch(folder)
        ):
            raise HTTPException(status_code=404, detail="日志不存在")
        root = base / target
        folder_name = folder
    else:
        if log_id in {".", ".."} or not _FOLDER_ID_PATTERN.fullmatch(log_id):
            raise HTTPException(status_code=404, detail="日志不存在")
        root = base
        folder_name = log_id
    directory = root / folder_name
    if directory.parent != root or not directory.is_dir():
        raise HTTPException(status_code=404, detail="日志不存在")
    return directory


def _iter_incident_dirs(root: Path):
    for target in REGISTRATION_TARGETS:
        target_root = root / target
        if not target_root.is_dir():
            continue
        for directory in target_root.iterdir():
            if directory.is_dir():
                yield directory, target
    if root.is_dir():
        for directory in root.iterdir():
            if directory.is_dir():
                yield directory, None


@router.get("")
async def list_logs(
    email: str = "",
    stage: str = "",
    outcome: str = "",
    target: str = "",
    limit: int = 200,
    offset: int = 0,
) -> dict[str, Any]:
    root = _log_dir()
    items: list[dict[str, Any]] = []
    for directory, directory_target in _iter_incident_dirs(root):
        record = _parse_incident(directory, directory_target)
        if record is not None:
            items.append(record)
    # 按事件目录名排序可保留毫秒精度，且兼容带目标前缀的 ID。
    items.sort(key=lambda item: item["id"].split("--", 1)[-1], reverse=True)
    limit = max(1, min(int(limit), 1000))
    offset = max(0, int(offset))

    keyword = email.strip().lower()
    target_filter = (
        normalize_registration_target(target, default="__invalid__")
        if target.strip()
        else ""
    )
    filtered = [
        item
        for item in items
        if (not keyword or keyword in item["email"].lower())
        and (not stage or stage == item["stage"])
        and (not outcome or outcome == item["outcome"])
        and (not target_filter or target_filter == item["registrationTarget"])
    ]
    return {
        "items": filtered[offset : offset + limit],
        "total": len(filtered),
        "stages": STAGES,
        "registrationTargets": list(REGISTRATION_TARGETS),
    }


@router.get("/{log_id}/log")
async def get_log_text(log_id: str) -> PlainTextResponse:
    log_file = _resolve_incident_dir(log_id) / "log.txt"
    if not log_file.is_file():
        raise HTTPException(status_code=404, detail="日志文件不存在")
    return PlainTextResponse(
        log_file.read_text(encoding="utf-8", errors="replace")
    )


@router.get("/{log_id}/screenshot")
async def get_log_screenshot(log_id: str) -> FileResponse:
    image = _resolve_incident_dir(log_id) / "screenshot.png"
    if not image.is_file():
        raise HTTPException(status_code=404, detail="截图不存在")
    return FileResponse(image, media_type="image/png")
