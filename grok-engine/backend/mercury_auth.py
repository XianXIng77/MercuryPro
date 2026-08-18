"""MercuryPro 登录认证:邮箱+密码注册/登录,JWT HttpOnly Cookie 会话。

用户状态存放在 ``<repo>/data/users.json``(与 microsoft-mail-accounts.json
同级,由 DATA_DIR 解析)。首次导入时若无该邮箱,会自动创建内置管理员
账号(见 ``DEFAULT_ADMIN_EMAIL``)。
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field

router = APIRouter(prefix="/api/auth", tags=["Auth"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
configured_data_dir = Path(os.environ.get("DATA_DIR", "data"))
DATA_DIRECTORY = (
    configured_data_dir
    if configured_data_dir.is_absolute()
    else PROJECT_ROOT / configured_data_dir
)
USERS_FILE = DATA_DIRECTORY / "users.json"
SECRET_FILE = DATA_DIRECTORY / "jwt-secret.txt"

# 内置管理员:登录框默认填写的账号;密码哈希在首次启动时写入 users.json
DEFAULT_ADMIN_EMAIL = "m@xianxing.art"
DEFAULT_ADMIN_PASSWORD = "xianxing1"

SESSION_COOKIE_NAME = "mercurypro_session"
SESSION_TTL_SECONDS = 7 * 24 * 3600  # 记住我 7 天;未勾选则仅浏览器会话 Cookie
JWT_ALGORITHM = "HS256"

_users_lock = threading.RLock()
_secret_key: str | None = None


class AuthError(HTTPException):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(status_code=status, detail=message)


class AuthCredentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    username: str = Field(default="", max_length=32)
    remember: bool = True


# ── 密钥 ────────────────────────────────────────────────────


def _load_secret_key() -> str:
    """JWT 签名密钥:优先 MERCURY_JWT_SECRET 环境变量,否则持久化生成一个。"""
    configured = os.environ.get("MERCURY_JWT_SECRET", "").strip()
    if configured:
        return configured
    with _users_lock:
        if SECRET_FILE.exists():
            saved = SECRET_FILE.read_text(encoding="utf-8").strip()
            if saved:
                return saved
        generated = secrets.token_hex(32)
        DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
        SECRET_FILE.write_text(generated, encoding="utf-8")
        return generated


def secret_key() -> str:
    global _secret_key
    if _secret_key is None:
        _secret_key = _load_secret_key()
    return _secret_key


def reset_runtime_state(secret: str | None = None) -> None:
    """测试辅助:重置缓存的密钥,下一次访问重新读取。"""
    global _secret_key
    _secret_key = secret


# ── 用户存储 ────────────────────────────────────────────────


def _load_users() -> list[dict[str, Any]]:
    with _users_lock:
        if not USERS_FILE.exists():
            return []
        try:
            parsed = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        return parsed if isinstance(parsed, list) else []


def _save_users(users: list[dict[str, Any]]) -> None:
    with _users_lock:
        DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
        USERS_FILE.write_text(
            json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")[:72]  # bcrypt 只取前 72 字节
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8")[:72], password_hash.encode("utf-8")
        )
    except ValueError:
        return False


def ensure_default_admin() -> None:
    """确保内置管理员账号存在(已注册同名邮箱则不覆盖)。"""
    if _find_user(DEFAULT_ADMIN_EMAIL) is not None:
        return
    users = _load_users()
    users.append(
        {
            "email": DEFAULT_ADMIN_EMAIL,
            "username": "管理员",
            "role": "admin",
            "passwordHash": hash_password(DEFAULT_ADMIN_PASSWORD),
            "createdAt": int(time.time()),
        }
    )
    _save_users(users)


def _find_user(email: str) -> dict[str, Any] | None:
    normalized = email.strip().lower()
    for user in _load_users():
        if str(user.get("email", "")).strip().lower() == normalized:
            return user
    return None


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "email": user.get("email"),
        "username": user.get("username") or str(user.get("email", "")).split("@")[0],
        "role": user.get("role", "user"),
    }


# ── JWT 会话 ────────────────────────────────────────────────


def issue_session(response: Response, user: dict[str, Any], remember: bool) -> None:
    now = int(time.time())
    token = jwt.encode(
        {
            "sub": str(user.get("email", "")).lower(),
            "username": user.get("username") or "",
            "role": user.get("role", "user"),
            "iat": now,
            "exp": now + SESSION_TTL_SECONDS,
        },
        secret_key(),
        algorithm=JWT_ALGORITHM,
    )
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_TTL_SECONDS if remember else None,
        httponly=True,
        samesite="lax",
        secure=False,  # 本地 http 部署;启用 HTTPS 后改为 True
        path="/",
    )


def get_current_user(request: Request) -> dict[str, Any]:
    """FastAPI 依赖:校验会话 Cookie,返回用户信息;未登录抛 401。"""
    token = request.cookies.get(SESSION_COOKIE_NAME, "")
    if not token:
        raise AuthError(401, "未登录或会话已过期")
    try:
        payload = jwt.decode(token, secret_key(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise AuthError(401, "未登录或会话已过期") from None
    user = _find_user(str(payload.get("sub", "")))
    if user is None:
        raise AuthError(401, "账号不存在或已被删除")
    return _public_user(user)


def require_admin(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise AuthError(403, "需要管理员权限")
    return user


def has_valid_session(request: Request) -> bool:
    """中间件用:请求是否携带有效会话(不抛异常)。"""
    try:
        get_current_user(request)
        return True
    except HTTPException:
        return False


# ── 路由 ────────────────────────────────────────────────────


@router.post("/register")
async def register(payload: AuthCredentials, response: Response) -> dict[str, Any]:
    email = str(payload.email).strip().lower()
    if _find_user(email) is not None:
        raise AuthError(409, "该邮箱已注册,请直接登录")
    user = {
        "email": email,
        "username": payload.username.strip() or email.split("@")[0],
        "role": "user",
        "passwordHash": hash_password(payload.password),
        "createdAt": int(time.time()),
    }
    users = _load_users()
    users.append(user)
    _save_users(users)
    issue_session(response, user, remember=payload.remember)
    return {"user": _public_user(user)}


@router.post("/login")
async def login(payload: AuthCredentials, response: Response) -> dict[str, Any]:
    user = _find_user(str(payload.email))
    if user is None or not verify_password(
        payload.password, str(user.get("passwordHash", ""))
    ):
        # 邮箱不存在与密码错误返回同一提示,避免账号枚举
        raise AuthError(401, "邮箱或密码错误")
    issue_session(response, user, remember=payload.remember)
    return {"user": _public_user(user)}


@router.post("/logout")
async def logout(response: Response) -> dict[str, Any]:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": user}
