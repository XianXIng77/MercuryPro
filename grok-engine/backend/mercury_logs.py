"""注册诊断日志查看 API(/api/logs/*)。

读取 ``chatgpt_registration.diagnostics`` 落盘的 ``<repo>/log`` 事件目录
(目录名格式 ``YYYYMMDD-HHMMSS.mmm_<stage>_<outcome>_<email>``),提供:
- GET /api/logs               事件列表(支持邮箱/阶段/结果筛选与分页)
- GET /api/logs/{id}/log      log.txt 文本内容
- GET /api/logs/{id}/screenshot  screenshot.png 图片

列表项的真实邮箱优先从 log.txt 的 ``邮箱:`` 行解析(目录名中的邮箱经过
ASCII 清洗,``@`` 会变成 ``-``),解析失败时回退目录名部分。
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse

from chatgpt_registration.diagnostics import _log_root

router = APIRouter(prefix="/api/logs", tags=["Registration Logs"])

_FOLDER_ID_PATTERN = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._-]*$")
_EMAIL_LINE_PATTERN = re.compile(r"^邮箱:\s*(.+)$", re.MULTILINE)

STAGES = ("plus-trial", "checkout-kind", "registration-error")


def _log_dir() -> Path:
    return _log_root(None)


def _parse_incident(directory: Path) -> dict[str, Any] | None:
    """把一个事件目录解析为列表项;目录名不符合格式时返回 None。"""
    parts = directory.name.split("_", 3)
    if len(parts) != 4:
        return None
    stamp, stage, outcome, email = parts
    try:
        when = datetime.strptime(stamp, "%Y%m%d-%H%M%S.%f")
    except ValueError:
        return None
    log_file = directory / "log.txt"
    if log_file.is_file():
        try:
            head = log_file.read_text(encoding="utf-8", errors="replace")[:600]
            match = _EMAIL_LINE_PATTERN.search(head)
            if match:
                email = match.group(1).strip()
        except OSError:
            pass
    return {
        "id": directory.name,
        "time": when.strftime("%Y-%m-%d %H:%M:%S"),
        "stage": stage,
        "outcome": outcome,
        "email": email,
        "hasScreenshot": (directory / "screenshot.png").is_file(),
    }


def _resolve_incident_dir(log_id: str) -> Path:
    """校验 id 并定位事件目录,防止路径穿越。"""
    if log_id in {".", ".."} or not _FOLDER_ID_PATTERN.match(log_id):
        raise HTTPException(status_code=404, detail="日志不存在")
    root = _log_dir()
    directory = root / log_id
    if directory.parent != root or not directory.is_dir():
        raise HTTPException(status_code=404, detail="日志不存在")
    return directory


@router.get("")
async def list_logs(
    email: str = "",
    stage: str = "",
    outcome: str = "",
    limit: int = 200,
    offset: int = 0,
) -> dict[str, Any]:
    root = _log_dir()
    items: list[dict[str, Any]] = []
    if root.is_dir():
        for directory in root.iterdir():
            if not directory.is_dir():
                continue
            record = _parse_incident(directory)
            if record is not None:
                items.append(record)
    # 目录名以时间戳开头,按 id 倒序即最新在前
    items.sort(key=lambda item: item["id"], reverse=True)
    limit = max(1, min(int(limit), 1000))
    offset = max(0, int(offset))

    keyword = email.strip().lower()
    filtered = [
        item
        for item in items
        if (not keyword or keyword in item["email"].lower())
        and (not stage or stage == item["stage"])
        and (not outcome or outcome == item["outcome"])
    ]
    return {
        "items": filtered[offset : offset + limit],
        "total": len(filtered),
        "stages": STAGES,
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
