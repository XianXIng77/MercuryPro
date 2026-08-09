"""Microsoft mail account APIs migrated from the former Express backend."""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse


router = APIRouter(prefix="/api/microsoft", tags=["Microsoft Mail"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
DEFAULT_GRANT_TYPE = "refresh_token"
TOKEN_URL = os.environ.get(
    "MICROSOFT_TOKEN_URL",
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
)
MAIL_API_BASE_URL = os.environ.get(
    "MICROSOFT_MAIL_API_BASE_URL", "https://outlook.office.com/api/v2.0"
).rstrip("/")
EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

configured_data_dir = Path(os.environ.get("DATA_DIR", "data"))
DATA_DIRECTORY = (
    configured_data_dir
    if configured_data_dir.is_absolute()
    else PROJECT_ROOT / configured_data_dir
)
ACCOUNTS_FILE = DATA_DIRECTORY / "microsoft-mail-accounts.json"

_accounts_cache: list[dict[str, Any]] | None = None
_accounts_lock = asyncio.Lock()


class MailServiceError(RuntimeError):
    def __init__(self, message: str, status: int = 500, details: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.details = details


def _now_text() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _error_response(error: Exception) -> JSONResponse:
    if isinstance(error, MailServiceError):
        status = error.status
        details = error.details
    else:
        status = 500
        details = None
    return JSONResponse(
        status_code=status,
        content={
            "code": status,
            "msg": str(error) or "邮件服务处理失败",
            "details": details,
        },
    )


def _load_accounts_file() -> list[dict[str, Any]]:
    DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    if not ACCOUNTS_FILE.exists():
        ACCOUNTS_FILE.write_text("[]\n", encoding="utf-8")
        return []
    parsed = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
    return parsed if isinstance(parsed, list) else []


def _save_accounts_file(accounts: list[dict[str, Any]]) -> None:
    DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    temporary = ACCOUNTS_FILE.with_suffix(f"{ACCOUNTS_FILE.suffix}.tmp")
    temporary.write_text(
        f"{json.dumps(accounts, ensure_ascii=False, indent=2)}\n", encoding="utf-8"
    )
    temporary.replace(ACCOUNTS_FILE)


async def _accounts_unlocked() -> list[dict[str, Any]]:
    global _accounts_cache
    if _accounts_cache is None:
        _accounts_cache = await asyncio.to_thread(_load_accounts_file)
    return _accounts_cache


async def _save_unlocked(accounts: list[dict[str, Any]]) -> None:
    global _accounts_cache
    await asyncio.to_thread(_save_accounts_file, accounts)
    _accounts_cache = accounts


def _find_account(
    accounts: list[dict[str, Any]], account_id: str
) -> dict[str, Any]:
    account = next(
        (item for item in accounts if str(item.get("accountId")) == str(account_id)),
        None,
    )
    if not account:
        raise MailServiceError("邮箱账号不存在", 404)
    return account


def _parse_import_content(content: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, source_line in enumerate(content.splitlines(), start=1):
        raw_line = source_line.strip()
        if not raw_line:
            continue
        record: dict[str, Any] = {
            "lineNo": line_number,
            "rawLine": source_line,
            "scope": DEFAULT_SCOPE,
            "grantType": DEFAULT_GRANT_TYPE,
            "valid": False,
            "addStatus": 3,
            "message": "",
        }
        if "----x----" not in raw_line:
            record["message"] = "缺少 ----x---- 分隔符"
            records.append(record)
            continue
        email_part, token_and_client = raw_line.split("----x----", 1)
        if "----" not in token_and_client:
            record["message"] = "缺少 Client ID 分隔符"
            records.append(record)
            continue
        refresh_token, client_id = token_and_client.rsplit("----", 1)
        match = EMAIL_PATTERN.search(email_part)
        email = match.group(0) if match else ""
        refresh_token = refresh_token.strip()
        client_id = client_id.strip()
        record.update(
            {
                "email": email or None,
                "refreshToken": refresh_token or None,
                "clientId": client_id or None,
            }
        )
        if not email:
            record["message"] = "未找到有效邮箱"
        elif not refresh_token:
            record["message"] = "Refresh Token 不能为空"
        elif not client_id:
            record["message"] = "Client ID 不能为空"
        else:
            record.update({"valid": True, "message": "解析成功"})
        records.append(record)
    return records


async def _fetch_microsoft_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
) -> dict[str, Any]:
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "MercuryPro/1.0",
        **(headers or {}),
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.request(
                method, url, headers=request_headers, data=data, params=params
            )
    except httpx.HTTPError as exc:
        raise MailServiceError(f"Microsoft 请求失败：{exc}", 502) from exc

    try:
        payload = response.json() if response.content else {}
    except ValueError:
        payload = {
            "error": "INVALID_RESPONSE",
            "error_description": response.text or "Microsoft 返回了无法解析的响应",
        }
    if not isinstance(payload, dict):
        payload = {"data": payload}
    if not response.is_success or payload.get("error"):
        error = payload.get("error")
        nested_message = error.get("message") if isinstance(error, dict) else None
        message = (
            payload.get("error_description")
            or nested_message
            or error
            or f"Microsoft 请求失败（HTTP {response.status_code}）"
        )
        status = 400 if 400 <= response.status_code < 500 else 502
        raise MailServiceError(str(message), status, payload)
    return payload


@router.get("/accounts")
async def list_accounts(
    page_num: int = Query(1, alias="pageNum", ge=1),
    page_size: int = Query(20, alias="pageSize", ge=1, le=100),
    email: str = "",
    client_id: str = Query("", alias="clientId"),
    status: str = "",
) -> Any:
    try:
        async with _accounts_lock:
            accounts = list(await _accounts_unlocked())
        email_filter = email.strip().lower()
        client_filter = client_id.strip().lower()
        status_filter = status.strip()
        filtered = [
            account
            for account in accounts
            if (not email_filter or email_filter in str(account.get("email", "")).lower())
            and (
                not client_filter
                or client_filter in str(account.get("clientId", "")).lower()
            )
            and (not status_filter or str(account.get("status", "")) == status_filter)
        ]
        start = (page_num - 1) * page_size
        return {
            "code": 200,
            "rows": filtered[start : start + page_size],
            "total": len(filtered),
        }
    except Exception as exc:
        return _error_response(exc)


@router.post("/accounts/import")
async def import_accounts(
    payload: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    content = payload.get("content") if isinstance(payload.get("content"), str) else ""
    if not content.strip():
        return JSONResponse(
            status_code=400, content={"code": 400, "msg": "导入内容不能为空"}
        )
    try:
        async with _accounts_lock:
            accounts = await _accounts_unlocked()
            next_accounts = [dict(item) for item in accounts]
            existing_emails = {
                str(item.get("email", "")).lower() for item in next_accounts
            }
            next_id = (
                max((int(item.get("accountId", 0)) for item in next_accounts), default=0)
                + 1
            )
            records = _parse_import_content(content)
            for record in records:
                email = str(record.get("email") or "")
                if not record.get("valid"):
                    continue
                if email.lower() in existing_emails:
                    record.update({"addStatus": 2, "message": "邮箱已存在，已跳过"})
                    continue
                timestamp = _now_text()
                next_accounts.append(
                    {
                        "accountId": next_id,
                        "email": email,
                        "clientId": record["clientId"],
                        "refreshToken": record["refreshToken"],
                        "scope": record["scope"],
                        "grantType": record["grantType"],
                        "status": "0",
                        "createTime": timestamp,
                        "updateTime": timestamp,
                    }
                )
                next_id += 1
                existing_emails.add(email.lower())
                record.update({"addStatus": 1, "message": "新增成功"})
            await _save_unlocked(next_accounts)
        return {"code": 200, "data": records}
    except Exception as exc:
        return _error_response(exc)


@router.put("/accounts/{account_id}/status")
async def update_status(
    account_id: str, payload: dict[str, Any] = Body(default_factory=dict)
) -> Any:
    status = str(payload.get("status"))
    if status not in {"0", "1"}:
        return JSONResponse(
            status_code=400, content={"code": 400, "msg": "状态必须是 0 或 1"}
        )
    try:
        async with _accounts_lock:
            accounts = await _accounts_unlocked()
            account = _find_account(accounts, account_id)
            next_accounts = [dict(item) for item in accounts]
            for item in next_accounts:
                if item.get("accountId") == account.get("accountId"):
                    item.update({"status": status, "updateTime": _now_text()})
            await _save_unlocked(next_accounts)
        return {"code": 200, "data": True}
    except Exception as exc:
        return _error_response(exc)


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str) -> Any:
    try:
        async with _accounts_lock:
            accounts = await _accounts_unlocked()
            account = _find_account(accounts, account_id)
            await _save_unlocked(
                [
                    dict(item)
                    for item in accounts
                    if item.get("accountId") != account.get("accountId")
                ]
            )
        return {"code": 200, "data": True}
    except Exception as exc:
        return _error_response(exc)


@router.post("/accounts/{account_id}/refresh-token")
async def refresh_token(account_id: str) -> Any:
    try:
        async with _accounts_lock:
            accounts = await _accounts_unlocked()
            account = dict(_find_account(accounts, account_id))
        token_data = await _fetch_microsoft_json(
            "POST",
            TOKEN_URL,
            data={
                "client_id": str(account.get("clientId", "")),
                "refresh_token": str(account.get("refreshToken", "")),
                "grant_type": str(account.get("grantType") or DEFAULT_GRANT_TYPE),
            },
        )
        async with _accounts_lock:
            accounts = await _accounts_unlocked()
            current = _find_account(accounts, account_id)
            next_accounts = [dict(item) for item in accounts]
            for item in next_accounts:
                if item.get("accountId") == current.get("accountId"):
                    item.update(
                        {
                            "accessToken": str(
                                token_data.get("access_token")
                                or item.get("accessToken")
                                or ""
                            ),
                            "refreshToken": str(
                                token_data.get("refresh_token")
                                or item.get("refreshToken")
                                or ""
                            ),
                            "scope": str(
                                token_data.get("scope") or item.get("scope") or ""
                            ),
                            "updateTime": _now_text(),
                        }
                    )
            await _save_unlocked(next_accounts)
        return {"code": 200, "data": token_data}
    except Exception as exc:
        return _error_response(exc)


async def _account_snapshot(account_id: str) -> dict[str, Any]:
    async with _accounts_lock:
        accounts = await _accounts_unlocked()
        return dict(_find_account(accounts, account_id))


@router.get("/accounts/{account_id}/messages")
async def list_messages(
    account_id: str, top: int = Query(20, ge=1, le=50)
) -> Any:
    try:
        account = await _account_snapshot(account_id)
        access_token = str(account.get("accessToken") or "")
        if not access_token:
            raise MailServiceError("Access Token 为空，请先刷新 Token", 400)
        data = await _fetch_microsoft_json(
            "GET",
            f"{MAIL_API_BASE_URL}/me/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"$top": str(top), "$orderby": "ReceivedDateTime desc"},
        )
        return {"code": 200, "data": data}
    except Exception as exc:
        return _error_response(exc)


@router.get("/accounts/{account_id}/messages/{message_id}")
async def get_message(
    account_id: str, message_id: str
) -> Any:
    try:
        account = await _account_snapshot(account_id)
        access_token = str(account.get("accessToken") or "")
        if not access_token:
            raise MailServiceError("Access Token 为空，请先刷新 Token", 400)
        data = await _fetch_microsoft_json(
            "GET",
            f"{MAIL_API_BASE_URL}/me/messages/{quote(message_id, safe='')}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        return {"code": 200, "data": data}
    except Exception as exc:
        return _error_response(exc)
