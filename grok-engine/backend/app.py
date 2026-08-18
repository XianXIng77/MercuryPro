from __future__ import annotations

import json  # noqa: F401 - exposed through AppContext(globals())
import os  # noqa: F401 - exposed through AppContext(globals())
import socket  # noqa: F401 - exposed through AppContext(globals())
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed  # noqa: F401
from datetime import datetime  # noqa: F401 - exposed through AppContext(globals())
from io import BytesIO  # noqa: F401 - exposed through AppContext(globals())
from pathlib import Path
from threading import RLock
from typing import Any, Literal
from urllib.parse import unquote, urlparse  # noqa: F401
from zipfile import ZIP_DEFLATED, ZipFile  # noqa: F401

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request  # noqa: F401
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


def _configure_console_encoding() -> None:
    """Keep background-worker diagnostics from failing on Windows code pages."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue
        try:
            reconfigure(encoding="utf-8", errors="backslashreplace")
        except (OSError, ValueError):
            pass


_configure_console_encoding()

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

from mercury_runtime import (  # noqa: E402
    RuntimeServiceError,
    configure_environment,
    ensure_for_path,
    setup_hint,
    shutdown_managed_processes,
)

configure_environment()

from app_context import AppContext
from export_formats import (  # noqa: F401
    build_chatgpt_auth_payload,
    build_cpa_record,
    build_sub2api_payload,
    cpa_filename,
)
from account_rotation import (
    delete_records as delete_rotation_records,  # noqa: F401
    list_registration_history,
    list_records as list_rotation_records,  # noqa: F401
    schedule_probe as schedule_rotation_probe,  # noqa: F401
    start_scheduler as start_rotation_scheduler,  # noqa: F401
    stop_scheduler as stop_rotation_scheduler,  # noqa: F401
    sync_imported_sessions,  # noqa: F401
)
import app_core as _app_core
import app_exports as _app_exports
import app_network as _app_network
import app_routes as _app_routes
from mercury_ai import router as mercury_ai_router
from mercury_mail import router as mercury_mail_router
from mercury_auth import (
    ensure_default_admin,
    has_valid_session,
    router as mercury_auth_router,
)
from mercury_logs import router as mercury_logs_router
from browser_debug import router as browser_debug_router

BACKEND_DIR = Path(__file__).resolve().parent
APP_DIR = BACKEND_DIR.parent
MERCURY_DIST_DIR = PROJECT_ROOT / "dist"
CONFIG_DIR = APP_DIR / "config"
WEB_DIR = APP_DIR / "web"
RUNTIME_DIR = APP_DIR / "runtime"
DATA_DIR = RUNTIME_DIR / "data"
VENDOR_DIR = APP_DIR / "vendor"
CONFIG_FILE = CONFIG_DIR / "config.json"
STATIC_DIR = WEB_DIR / "static"
SOLVER_PROXY_FILE = Path(
    os.environ.get(
        "PROGROK_SOLVER_PROXY_FILE",
        str(VENDOR_DIR / "turnstile-solver" / "proxies.txt"),
    )
)
_config_lock = RLock()
CHATGPT_SUB2API_MODELS = [
    "gpt-5.5",
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol",
]

DEFAULT_CONFIG: dict[str, Any] = {
    "registration_target": "grok",
    "registration_mode": "browser",
    "mail_provider": "hotmail_local",
    "mail_api_key": "",
    "mail_base_url": "",
    "mail_domain": "",
    "mail_prefix": "",
    "mail_expiry_ms": 86400000,
    "smsbower_api_key": "",
    "smsbower_base_url": "",
    "naturalflower_mailboxes": "",
    "domain_email_domain": "",
    "domain_email_qq": "",
    "domain_email_auth_code": "",
    "mail_provider_configs": {
        "yyds": {
            "mail_base_url": "",
            "mail_api_key": "",
            "mail_domain": "",
        },
        "custom": {
            "mail_base_url": "",
            "mail_api_key": "",
            "mail_domain": "",
        },
        "cloudflare_grokfree": {
            "mail_base_url": "",
            "mail_api_key": "",
            "mail_domain": "",
        },
        "stalwart": {
            "mail_base_url": "",
            "mail_api_key": "",
            "mail_domain": "",
        },
        "smsbower": {
            "mail_base_url": "",
            "mail_api_key": "",
            "mail_domain": "",
        },
        "domain_email": {
            "mail_base_url": "imaps://imap.qq.com/INBOX",
            "mail_api_key": "",
            "mail_domain": "",
        },
    },
    "hotmail_local_base_url": os.environ.get(
        "PROGROK_HOTMAIL_HELPER_URL", "http://127.0.0.1:17373"
    ).rstrip("/"),
    "hotmail_account_source": "mail_management",
    "captcha_provider": "local",
    "local_solver_url": os.environ.get(
        "PROGROK_SOLVER_URL", "http://127.0.0.1:5072"
    ).rstrip("/"),
    "yescaptcha_key": "",
    "proxy": "",
    "proxy_strategy": "round_robin",
    "count": 1,
    "concurrency": 1,
    "stagger_ms": 1200,
    "chatgpt_step_delay_ms": 3000,
    "chatgpt_checkout_probe_enabled": False,
    "chatgpt_checkout_proxy": "",
    "chatgpt_checkout_proxy_strategy": "round_robin",
    "auto_tune_enabled": False,
    "probe_delay_sec": 0,
    "probe_model": "grok-4.5",
    "chatgpt_probe_model": "gpt-5.5",
    "probe_concurrency": 1,
    "probe_stagger_ms": 10000,
    "import_concurrency": 1,
    "import_stagger_ms": 10000,
    "pre_import_probe_enabled": True,
    "auto_import_enabled": False,
    "auto_import_target": "sub2api",
    "registration_json_format": "cpa",
    "cpa_base_url": "",
    "cpa_management_key": "",
    "sub2api_base_url": "",
    "sub2api_auth_mode": "password",
    "sub2api_admin_email": "",
    "sub2api_admin_password": "",
    "sub2api_api_key": "",
    "sub2api_group_id": 0,
    "sub2api_group_name": "",
    "sub2api_xai_group_id": 0,
    "sub2api_xai_group_name": "",
    "sub2api_chatgpt_models": CHATGPT_SUB2API_MODELS,
    "grok_headless": True,
    "chatgpt_headless": True,
}


def _app_context() -> AppContext:
    """Expose live application services to extracted domains."""
    return AppContext(globals())


def load_config() -> dict[str, Any]:
    return _app_core.load_config(_app_context())


def _sync_solver_proxy_file(cfg: dict[str, Any]) -> int:
    return _app_core._sync_solver_proxy_file(_app_context(), cfg)


def save_config(data: dict[str, Any]) -> dict[str, Any]:
    return _app_core.save_config(_app_context(), data)


def _normalize_mail_provider_configs(value: Any) -> dict[str, dict[str, str]]:
    return _app_core._normalize_mail_provider_configs(_app_context(), value)


def apply_environment(cfg: dict[str, Any]) -> None:
    return _app_core.apply_environment(_app_context(), cfg)


_initial_config = load_config()
apply_environment(_initial_config)
_sync_solver_proxy_file(_initial_config)

# Lazy-load adapters based on registration target
_registration_adapters: dict[str, Any] = {}


def _get_registration_adapter(target: str | None = None) -> Any:
    return _app_core._get_registration_adapter(_app_context(), target)


# Keep the default adapter for backward compatibility
registration = _get_registration_adapter()


class Settings(BaseModel):
    registration_target: Literal["grok", "chatgpt"] = "grok"
    registration_mode: Literal["browser", "protocol"] = "browser"
    mail_provider: Literal[
        "yyds",
        "custom",
        "cloudflare_grokfree",
        "stalwart",
        "hotmail_local",
        "smsbower",
        "naturalflower",
        "domain_email",
    ] = "hotmail_local"
    mail_api_key: str = ""
    mail_base_url: str = ""
    mail_domain: str = ""
    mail_prefix: str = ""
    mail_expiry_ms: int = Field(86400000, ge=60000, le=604800000)
    mail_provider_configs: dict[str, dict[str, str]] = Field(default_factory=dict)
    smsbower_api_key: str = ""
    smsbower_base_url: str = ""
    naturalflower_mailboxes: str = ""
    domain_email_domain: str = ""
    domain_email_qq: str = ""
    domain_email_auth_code: str = ""
    hotmail_local_base_url: str = "http://127.0.0.1:17373"
    hotmail_account_source: Literal["mail_management", "manual"] = "mail_management"
    captcha_provider: Literal["local", "yescaptcha"] = "local"
    local_solver_url: str = "http://127.0.0.1:5072"
    yescaptcha_key: str = ""
    proxy: str = ""
    proxy_strategy: Literal["round_robin", "random", "sticky"] = "round_robin"
    count: int = Field(1, ge=0, le=10000)
    concurrency: int = Field(1, ge=1, le=10000)
    stagger_ms: int = Field(1200, ge=0, le=60000)
    chatgpt_step_delay_ms: int = Field(3000, ge=0, le=30000)
    chatgpt_checkout_probe_enabled: bool = False
    chatgpt_checkout_proxy: str = ""
    chatgpt_checkout_proxy_strategy: Literal["round_robin", "random", "sticky"] = (
        "round_robin"
    )
    auto_tune_enabled: bool = False
    probe_delay_sec: int = Field(0, ge=0, le=600)
    probe_model: str = "grok-4.5"
    chatgpt_probe_model: str = "gpt-5.5"
    probe_concurrency: int = Field(1, ge=1, le=10)
    probe_stagger_ms: int = Field(10000, ge=0, le=60000)
    import_concurrency: int = Field(1, ge=1, le=10)
    import_stagger_ms: int = Field(10000, ge=0, le=60000)
    pre_import_probe_enabled: bool = True
    auto_import_enabled: bool = False
    auto_import_target: Literal["cpa", "sub2api"] = "sub2api"
    registration_json_format: Literal["cpa", "sub2api"] = "cpa"
    cpa_base_url: str = ""
    cpa_management_key: str = ""
    sub2api_base_url: str = ""
    sub2api_auth_mode: Literal["password", "api_key"] = "password"
    sub2api_admin_email: str = ""
    sub2api_admin_password: str = ""
    sub2api_api_key: str = ""
    sub2api_group_id: int = Field(0, ge=0)
    sub2api_group_name: str = ""
    sub2api_xai_group_id: int = Field(0, ge=0)
    sub2api_xai_group_name: str = ""
    sub2api_chatgpt_models: list[str] = Field(
        default_factory=lambda: list(CHATGPT_SUB2API_MODELS)
    )
    grok_headless: bool = True
    chatgpt_headless: bool = True


class Sub2APIConnectionRequest(BaseModel):
    sub2api_base_url: str = ""
    sub2api_auth_mode: Literal["password", "api_key"] = "password"
    sub2api_admin_email: str = ""
    sub2api_admin_password: str = ""
    sub2api_api_key: str = ""


class ManualJsonImportRequest(BaseModel):
    payload: Any = None
    payloads: list[Any] = Field(default_factory=list)
    settings: Settings


class HotmailImportRequest(BaseModel):
    text: str
    base_url: str = ""


class HotmailProbeRequest(BaseModel):
    base_url: str = ""
    source: Literal["mail_management", "manual"] | None = None


class DomainMailTestRequest(BaseModel):
    domain: str = ""
    qq_email: str = ""
    qq_auth_code: str = ""


class ProxyCheckRequest(BaseModel):
    proxy: str = ""


class HotmailStatusRequest(BaseModel):
    used: bool | None = None
    preferred_for_next_use: bool | None = None
    registration_target: Literal["grok", "chatgpt"] = "grok"


class HotmailRestoreUsesRequest(BaseModel):
    count: int = Field(..., ge=1, le=3)
    registration_target: Literal["grok", "chatgpt"] = "grok"


class HotmailDeleteRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)


class AccountRotationProbeRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)
    all_accounts: bool = False


class AccountRotationDeleteRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)


class ChatGPTAccessTokensRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)
    all_accounts: bool = False


def _post_registration_config(cfg: dict[str, Any]) -> dict[str, Any]:
    return _app_core._post_registration_config(_app_context(), cfg)


def _manual_import_records(payload: Any) -> list[dict[str, Any]]:
    return _app_core._manual_import_records(_app_context(), payload)


def _normalize_import_record_for_registration_target(
    record: dict[str, Any], registration_target: str
) -> dict[str, Any]:
    return _app_core._normalize_import_record_for_registration_target(
        _app_context(), record, registration_target
    )


app = FastAPI(title="MercuryPro", version="2.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(mercury_auth_router)
app.include_router(mercury_logs_router)
app.include_router(mercury_mail_router)
app.include_router(mercury_ai_router)
app.include_router(browser_debug_router)

# 首次启动落盘内置管理员账号(m@xianxing.art)
ensure_default_admin()


@app.middleware("http")
async def prepare_embedded_services(request: Request, call_next):
    """Keep the old /api/grok contract while serving Grok in this process."""

    path = request.scope.get("path", "")
    target_path = path
    if path == "/api/grok" or path.startswith("/api/grok/"):
        target_path = f"/api{path[len('/api/grok'):]}"

    try:
        body: dict[str, Any] = {}
        if target_path == "/api/register":
            try:
                parsed = await request.json()
                body = parsed if isinstance(parsed, dict) else {}
            except (json.JSONDecodeError, UnicodeDecodeError):
                body = {}
        await ensure_for_path(target_path, body)
    except RuntimeServiceError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "error": "MercuryPro 内置 Grok 辅助服务不可用",
                "detail": str(exc),
                "hint": setup_hint(exc),
            },
        )

    if target_path != path:
        request.scope["path"] = target_path
        request.scope["raw_path"] = target_path.encode("utf-8")
    return await call_next(request)


@app.middleware("http")
async def enforce_auth_guard(request: Request, call_next):
    """登录守卫(最外层):/api/*(除 /api/auth/*)与 /browser-debug/* 需要有效会话。

    注意 Starlette 中间件为后定义先执行,此守卫定义在 prepare_embedded_services
    之后,因此未登录请求不会触发内置服务拉起。
    """

    path = request.scope.get("path", "")
    is_api = path == "/api" or path.startswith("/api/")
    is_auth_path = path == "/api/auth" or path.startswith("/api/auth/")
    if (is_api and not is_auth_path or path.startswith("/browser-debug")) and not has_valid_session(request):
        return JSONResponse(
            status_code=401,
            content={"code": 401, "error": "未登录或会话已过期"},
        )
    return await call_next(request)


def _rotation_session_items() -> list[tuple[str, dict[str, Any]]]:
    return _app_core._rotation_session_items(_app_context())


def _sync_account_rotation() -> int:
    return _app_core._sync_account_rotation(_app_context())


@app.on_event("startup")
def start_account_rotation() -> None:
    return _app_core.start_account_rotation(_app_context())


@app.on_event("shutdown")
async def stop_account_rotation() -> None:
    _app_core.stop_account_rotation(_app_context())
    await shutdown_managed_processes()


@app.get("/")
def index() -> FileResponse:
    mercury_index = MERCURY_DIST_DIR / "index.html"
    if mercury_index.is_file():
        return FileResponse(mercury_index)
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, Any]:
    cfg = load_config()
    target = str(cfg.get("registration_target") or "grok")
    adapter = _get_registration_adapter(target)
    available = adapter.registration_available()

    # Also probe the other adapter for status display
    other_target = "chatgpt" if target == "grok" else "grok"
    other_available = None
    try:
        other_adapter = _get_registration_adapter(other_target)
        other_available = other_adapter.registration_available()
    except Exception:
        other_available = {
            "ok": False,
            "available": False,
            "error": "adapter not loaded",
        }

    return {
        "ok": bool(available.get("available")),
        "service": "progrok-registration",
        "registration_target": target,
        "registration": available,
        "registration_alt": {other_target: other_available},
        "accounts_dir": str(DATA_DIR / "accounts"),
    }


@app.get("/api/output-paths")
def output_paths() -> dict[str, Any]:
    paths = [
        {"key": "accounts", "label": "账号文件目录", "path": DATA_DIR / "accounts"},
        {"key": "auth", "label": "合并 auth.json", "path": DATA_DIR / "auth.json"},
        {"key": "sso", "label": "浏览器会话目录", "path": DATA_DIR / "register_sso"},
        {"key": "legacy_sso", "label": "旧版 SSO 输出目录", "path": DATA_DIR / "sso_output"},
        {
            "key": "chatgpt_sessions",
            "label": "ChatGPT 原始 Session",
            "path": DATA_DIR / "chatgpt_sessions",
        },
    ]
    return {
        "ok": True,
        "items": [
            {**item, "path": str(item["path"]), "exists": item["path"].exists()}
            for item in paths
        ],
    }


def _stored_auth_by_email() -> dict[str, dict[str, Any]]:
    return _app_exports._stored_auth_by_email(_app_context())


def _download_records(
    batch_id: str | None = None, history_date: str | None = None
) -> list[dict[str, Any]]:
    return _app_exports._download_records(_app_context(), batch_id, history_date)


def _download_chatgpt_records(batch_id: str | None = None) -> list[dict[str, Any]]:
    return _app_exports._download_chatgpt_records(_app_context(), batch_id)


@app.get("/api/download")
def download_accounts(
    export_format: Literal[
        "pure_sso",
        "cookie",
        "email_sso",
        "email_password_sso",
        "json",
        "cpa_json",
        "sub2api_json",
        "chatgpt_auth_json",
    ] = Query("pure_sso", alias="format"),
    batch_id: str | None = None,
    history_date: str | None = None,
) -> Response:
    return _app_exports.download_accounts(
        _app_context(), export_format, batch_id, history_date
    )


@app.get("/api/download/history")
def download_history() -> dict[str, Any]:
    return list_registration_history()


@app.get("/api/solver/detect")
def detect_solver() -> dict[str, Any]:
    return _app_network.detect_solver(_app_context())


def _normalize_detected_proxy(
    raw: str, *, scheme_hint: str = ""
) -> dict[str, str] | None:
    return _app_network._normalize_detected_proxy(
        _app_context(), raw, scheme_hint=scheme_hint
    )


def _detect_windows_system_proxy() -> tuple[dict[str, str] | None, str]:
    return _app_network._detect_windows_system_proxy(_app_context())


def _detect_local_proxy() -> dict[str, Any]:
    return _app_network._detect_local_proxy(_app_context())


@app.get("/api/proxy/detect")
def detect_proxy() -> dict[str, Any]:
    return _app_network.detect_proxy(_app_context())


@app.post("/api/proxy/check")
def check_proxy(request: ProxyCheckRequest) -> dict[str, Any]:
    return _app_network.check_proxy_pool(_app_context(), request.proxy)


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return _app_routes.get_config(_app_context())


@app.post("/api/sub2api/groups")
def sub2api_groups(request: Sub2APIConnectionRequest) -> dict[str, Any]:
    return _app_routes.sub2api_groups(_app_context(), request)


@app.get("/api/performance")
def performance_profile(
    provider: Literal["local", "yescaptcha"] | None = Query(None),
) -> dict[str, Any]:
    return _app_routes.performance_profile(_app_context(), provider)


@app.get("/api/mail/provider-presets")
def mail_provider_presets(response: Response) -> dict[str, Any]:
    return _app_routes.mail_provider_presets(_app_context(), response)


@app.get("/api/mail/hotmail/accounts")
def hotmail_accounts(
    source: Literal["mail_management", "manual"] = Query("mail_management"),
    registration_target: Literal["grok", "chatgpt"] = Query("grok"),
) -> dict[str, Any]:
    return _app_routes.hotmail_accounts(
        _app_context(), source, registration_target
    )


@app.post("/api/mail/hotmail/accounts/import")
def hotmail_import(request: HotmailImportRequest) -> dict[str, Any]:
    return _app_routes.hotmail_import(_app_context(), request)


@app.post("/api/mail/hotmail/accounts/probe")
def hotmail_probe_all(request: HotmailProbeRequest) -> dict[str, Any]:
    return _app_routes.hotmail_probe_all(_app_context(), request)


@app.post("/api/mail/hotmail/accounts/reset-health")
def hotmail_reset_health() -> dict[str, Any]:
    return _app_routes.hotmail_reset_health(_app_context())


@app.post("/api/mail/hotmail/accounts/{account_id}/probe")
def hotmail_probe_one(account_id: str, request: HotmailProbeRequest) -> dict[str, Any]:
    return _app_routes.hotmail_probe_one(_app_context(), account_id, request)


@app.patch("/api/mail/hotmail/accounts/{account_id}")
def hotmail_set_status(
    account_id: str, request: HotmailStatusRequest
) -> dict[str, Any]:
    return _app_routes.hotmail_set_status(_app_context(), account_id, request)


@app.post("/api/mail/hotmail/accounts/{account_id}/restore-uses")
def hotmail_restore_uses(
    account_id: str, request: HotmailRestoreUsesRequest
) -> dict[str, Any]:
    return _app_routes.hotmail_restore_uses(_app_context(), account_id, request)


@app.delete("/api/mail/hotmail/accounts")
def hotmail_delete_selected(request: HotmailDeleteRequest) -> dict[str, Any]:
    return _app_routes.hotmail_delete_selected(_app_context(), request)


@app.delete("/api/mail/hotmail/accounts/used")
def hotmail_delete_used(
    registration_target: Literal["grok", "chatgpt"] = Query("grok"),
) -> dict[str, Any]:
    return _app_routes.hotmail_delete_used(_app_context(), registration_target)


@app.delete("/api/mail/hotmail/accounts/unhealthy")
def hotmail_delete_unhealthy() -> dict[str, Any]:
    return _app_routes.hotmail_delete_unhealthy(_app_context())


@app.delete("/api/mail/hotmail/accounts/{account_id}")
def hotmail_delete(account_id: str) -> dict[str, Any]:
    return _app_routes.hotmail_delete(_app_context(), account_id)


@app.post("/api/mail/hotmail/test")
def hotmail_test(settings: Settings | None = None) -> dict[str, Any]:
    return _app_routes.hotmail_test(_app_context(), settings)


@app.post("/api/mail/domain/test")
def domain_mail_test(request: DomainMailTestRequest) -> dict[str, Any]:
    """Verify the Cloudflare 转发域名 + QQ 邮箱授权码 IMAP 连接可用。"""
    return _app_routes.domain_mail_test(_app_context(), request)


@app.post("/api/smsbower/balance")
def smsbower_balance(request: dict[str, Any]) -> dict[str, Any]:
    """Query SMSBower account balance."""
    from mail_protocols.smsbower import check_balance

    api_key = str(request.get("smsbower_api_key") or "").strip()
    base_url = str(request.get("smsbower_base_url") or "").strip()
    if not api_key:
        return {"ok": False, "error": "SMSBower API Key 未提供"}
    try:
        result = check_balance(api_key=api_key, base_url=base_url or None)
        return {
            "ok": True,
            "balance": result.get("balance"),
            "count": result.get("count"),
            "price": result.get("price"),
            "currency": result.get("currency"),
            "raw": result.get("raw"),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/smsbower/services")
def smsbower_services(request: dict[str, Any]) -> dict[str, Any]:
    """Fetch available mail service codes from SMSBower."""
    from mail_protocols.smsbower import get_mail_services_list

    api_key = str(request.get("smsbower_api_key") or "").strip()
    base_url = str(request.get("smsbower_base_url") or "").strip()
    if not api_key:
        return {"ok": False, "error": "SMSBower API Key 未提供"}
    try:
        services = get_mail_services_list(api_key, base_url=base_url or None)
        return {"ok": True, "services": services}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.put("/api/config")
def put_config(settings: Settings) -> dict[str, Any]:
    return _app_routes.put_config(_app_context(), settings)


@app.post("/api/register")
def start_register(
    settings: Settings | None = None, paused: bool = False
) -> dict[str, Any]:
    return _app_routes.start_register(_app_context(), settings, paused)


@app.get("/api/sessions")
def sessions() -> dict[str, Any]:
    return _app_routes.sessions(_app_context())


@app.get("/api/account-rotation")
def account_rotation_list(
    status: str = Query(""),
    keyword: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=80),
) -> dict[str, Any]:
    return _app_routes.account_rotation_list(
        _app_context(), status, keyword, page, page_size
    )


@app.post("/api/account-rotation/probe")
def account_rotation_probe(request: AccountRotationProbeRequest) -> dict[str, Any]:
    return _app_routes.account_rotation_probe(_app_context(), request)


@app.post("/api/account-rotation/{record_id}/probe")
def account_rotation_probe_one(record_id: str) -> dict[str, Any]:
    return _app_routes.account_rotation_probe_one(_app_context(), record_id)


@app.delete("/api/account-rotation")
def account_rotation_delete(request: AccountRotationDeleteRequest) -> dict[str, Any]:
    return _app_routes.account_rotation_delete(_app_context(), request)


@app.post("/api/sessions/reset")
def reset_sessions() -> dict[str, Any]:
    return _app_routes.reset_sessions(_app_context())


@app.post("/api/sessions/reset/grok")
def reset_grok_sessions() -> dict[str, Any]:
    return _app_routes.reset_grok_sessions(_app_context())


@app.get("/api/sessions/{session_id}")
def session(session_id: str) -> dict[str, Any]:
    return _app_routes.session(_app_context(), session_id)


@app.post("/api/chatgpt/sessions/{session_id}/access-token")
def chatgpt_access_token(session_id: str, response: Response) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    return _app_routes.chatgpt_access_token(_app_context(), session_id)


@app.get("/api/chatgpt/accounts")
def chatgpt_accounts(response: Response) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    return _app_routes.chatgpt_accounts(_app_context())


@app.post("/api/chatgpt/accounts/access-tokens")
def chatgpt_account_access_tokens(
    request: ChatGPTAccessTokensRequest, response: Response
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    return _app_routes.chatgpt_account_access_tokens(_app_context(), request)


@app.get("/api/batches/{batch_id}")
def batch(batch_id: str) -> dict[str, Any]:
    return _app_routes.batch(_app_context(), batch_id)


@app.post("/api/sessions/{session_id}/stop")
def stop_session(session_id: str) -> dict[str, Any]:
    return _app_routes.stop_session(_app_context(), session_id)


@app.post("/api/batches/{batch_id}/stop")
def stop_batch(batch_id: str) -> dict[str, Any]:
    return _app_routes.stop_batch(_app_context(), batch_id)


@app.post("/api/batches/{batch_id}/pause")
def pause_batch(batch_id: str) -> dict[str, Any]:
    return _app_routes.pause_batch(_app_context(), batch_id)


@app.post("/api/batches/{batch_id}/resume")
def resume_batch(batch_id: str) -> dict[str, Any]:
    return _app_routes.resume_batch(_app_context(), batch_id)


@app.post("/api/sessions/{session_id}/retry-probe")
def retry_session_probe(session_id: str) -> dict[str, Any]:
    return _app_routes.retry_session_probe(_app_context(), session_id)


@app.post("/api/batches/{batch_id}/retry-probe")
def retry_batch_probe(batch_id: str) -> dict[str, Any]:
    return _app_routes.retry_batch_probe(_app_context(), batch_id)


@app.post("/api/batches/{batch_id}/pause-probe")
def pause_batch_probe(batch_id: str) -> dict[str, Any]:
    return _app_routes.pause_batch_probe(_app_context(), batch_id)


@app.post("/api/batches/{batch_id}/resume-probe")
def resume_batch_probe(batch_id: str) -> dict[str, Any]:
    return _app_routes.resume_batch_probe(_app_context(), batch_id)


@app.post("/api/sessions/{session_id}/retry-import")
def retry_session_import(session_id: str) -> dict[str, Any]:
    return _app_routes.retry_session_import(_app_context(), session_id)


@app.post("/api/batches/{batch_id}/retry-import")
def retry_batch_import(batch_id: str) -> dict[str, Any]:
    return _app_routes.retry_batch_import(_app_context(), batch_id)


@app.post("/api/import/json")
def manual_json_import(request: ManualJsonImportRequest) -> dict[str, Any]:
    return _app_routes.manual_json_import(_app_context(), request)


@app.get("/{full_path:path}", include_in_schema=False)
def mercury_spa(full_path: str) -> Response:
    """Serve the built React application and preserve client-side routes."""

    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    dist_root = MERCURY_DIST_DIR.resolve()
    requested = (MERCURY_DIST_DIR / full_path).resolve()
    if requested.is_relative_to(dist_root) and requested.is_file():
        return FileResponse(requested)
    index_file = MERCURY_DIST_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return JSONResponse(status_code=404, content={"detail": "Frontend is not built"})
