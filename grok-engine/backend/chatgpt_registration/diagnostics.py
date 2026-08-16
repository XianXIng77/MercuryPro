"""Timestamped ChatGPT registration diagnostics under ``<repo>/log``.

One folder per incident (Plus trial check / checkout-kind check /
registration error), each containing ``log.txt`` and, when a live browser
page is available, ``screenshot.png``. All helpers are best-effort and
must never raise into the registration flow.

Folder layout::

    log/20260815-143025.123_plus-trial_eligible_user-example.com/
        log.txt         timestamped metadata + step timeline + page snapshot
        screenshot.png  browser screenshot at the moment of capture
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

_REGISTRATION_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _REGISTRATION_DIR.parent
_PROJECT_ROOT = _BACKEND_DIR.parent.parent
DEFAULT_LOG_DIR = _PROJECT_ROOT / "log"

_LOG_FILENAME = "log.txt"
_SCREENSHOT_FILENAME = "screenshot.png"
_MAX_PAGE_TEXT_CHARS = 3000
_MAX_EXTRA_CHARS = 4000


def _log_root(root: Path | str | None) -> Path:
    if root is not None:
        return Path(root)
    env_dir = os.environ.get("MERCURY_REGISTRATION_LOG_DIR", "").strip()
    if env_dir:
        return Path(env_dir)
    return DEFAULT_LOG_DIR


def _safe_part(value: Any, fallback: str, limit: int = 48) -> str:
    """Return an ASCII, filesystem-safe component for a folder name."""
    cleaned = "".join(
        ch if ch.isascii() and (ch.isalnum() or ch in "-_.") else "-"
        for ch in str(value or "").strip().lower()
    ).strip("-._")
    return cleaned[:limit] or fallback


def _format_local(when: float) -> str:
    return (
        datetime.fromtimestamp(when)
        .astimezone()
        .strftime("%Y-%m-%d %H:%M:%S %z")
    )


def _folder_name(when: float, stage: str, outcome: str, email: str) -> str:
    stamp = datetime.fromtimestamp(when).strftime("%Y%m%d-%H%M%S")
    milliseconds = round((when - int(when)) * 1000) % 1000
    return "_".join(
        (
            f"{stamp}.{milliseconds:03d}",
            _safe_part(stage, "incident", 24),
            _safe_part(outcome, "unknown", 24),
            _safe_part(email, "unknown-email", 40),
        )
    )


def create_incident_dir(
    *,
    stage: str,
    outcome: str,
    email: str = "",
    at: float | None = None,
    root: Path | str | None = None,
) -> Path:
    """Create (and return) the timestamped folder for one incident."""
    when = float(at if at is not None else time.time())
    directory = _log_root(root) / _folder_name(when, stage, outcome, email)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    return directory


def _page_url(page: Any) -> str:
    if page is None:
        return ""
    try:
        return str(page.url or "")[:300]
    except Exception:
        return ""


def _page_text(page: Any) -> str:
    if page is None:
        return ""
    try:
        return str(page.locator("body").inner_text() or "")[
            :_MAX_PAGE_TEXT_CHARS
        ]
    except Exception:
        return ""


def _format_steps(steps: list[Any]) -> list[str]:
    lines: list[str] = []
    for step in steps or []:
        if not isinstance(step, dict):
            continue
        at = float(step.get("at") or 0.0)
        stamp = (
            datetime.fromtimestamp(at).strftime("%H:%M:%S")
            if at > 0
            else "--:--:--"
        )
        detail = " ".join(
            f"{key}={value}"
            for key, value in sorted(step.items())
            if key not in {"step", "status", "at"} and value not in (None, "")
        )
        line = f"[{stamp}] {step.get('step')}: {step.get('status')}"
        if detail:
            line += f" ({detail})"
        lines.append(line)
    return lines


def _save_screenshot(page: Any, directory: Path) -> Path | None:
    """Save a full-page screenshot, falling back to viewport-only."""
    if page is None:
        return None
    target = directory / _SCREENSHOT_FILENAME
    for full_page in (True, False):
        try:
            page.screenshot(
                path=str(target), full_page=full_page, timeout=8000
            )
            if target.exists() and target.stat().st_size > 0:
                return target
        except Exception:
            continue
    try:
        target.unlink(missing_ok=True)
    except OSError:
        pass
    return None


def _write_incident_log(
    directory: Path,
    *,
    when: float,
    stage: str,
    outcome: str,
    email: str,
    session_id: str,
    reason: str,
    steps: list[Any],
    extra: dict[str, Any] | None,
    page: Any,
    screenshot: Path | None,
) -> None:
    lines: list[str] = [
        "MercuryPro ChatGPT 注册诊断日志",
        "=" * 44,
        f"时间: {_format_local(when)}",
        f"阶段: {stage}",
        f"结果: {outcome}",
    ]
    if email:
        lines.append(f"邮箱: {email}")
    if session_id:
        lines.append(f"会话: {session_id}")
    if reason:
        lines.append(f"原因: {reason}")
    page_url = _page_url(page)
    if page_url:
        lines.append(f"页面: {page_url}")
    lines.append(
        f"截图: {screenshot.name if screenshot else '（无可用浏览器页面）'}"
    )
    step_lines = _format_steps(steps)
    if step_lines:
        lines += ["", "-" * 44, "步骤时间线:"] + step_lines
    page_snapshot = _page_text(page)
    if page_snapshot:
        lines += ["", "-" * 44, "页面文本快照:", page_snapshot]
    if extra:
        try:
            payload = json.dumps(
                extra, ensure_ascii=False, indent=2, default=str
            )
        except Exception:
            payload = str(extra)
        lines += ["", "-" * 44, "附加数据:", payload[:_MAX_EXTRA_CHARS]]
    target = directory / _LOG_FILENAME
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass


def capture_registration_incident(
    *,
    stage: str,
    outcome: str,
    email: str = "",
    session_id: str = "",
    reason: str = "",
    page: Any = None,
    steps: list[dict[str, Any]] | None = None,
    extra: dict[str, Any] | None = None,
    root: Path | str | None = None,
) -> dict[str, Any]:
    """Persist one timestamped incident folder (log.txt + screenshot.png).

    Best-effort: returns ``{"ok": False, "reason": ...}`` on failure and
    never raises, so diagnostics cannot break the registration flow.
    """
    when = time.time()
    record: dict[str, Any] = {
        "ok": False,
        "stage": stage,
        "outcome": outcome,
        "at": when,
        "email": email,
        "reason": "",
    }
    try:
        directory = create_incident_dir(
            stage=stage, outcome=outcome, email=email, at=when, root=root
        )
        screenshot = _save_screenshot(page, directory)
        _write_incident_log(
            directory,
            when=when,
            stage=stage,
            outcome=outcome,
            email=email,
            session_id=session_id,
            reason=reason,
            steps=list(steps or []),
            extra=extra,
            page=page,
            screenshot=screenshot,
        )
        record.update(
            {
                "ok": True,
                "dir": str(directory),
                "screenshot": str(screenshot) if screenshot else None,
            }
        )
    except Exception as exc:
        record["reason"] = (
            f"诊断日志写入失败: {type(exc).__name__}: {exc}"[:200]
        )
    return record
