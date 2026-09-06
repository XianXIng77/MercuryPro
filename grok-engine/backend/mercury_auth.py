"""MercuryPro 登录认证:邮箱+密码注册/登录,JWT HttpOnly Cookie 会话。

    profile = access_profile(user)
    if permission not in profile["permissions"]:
        return False
    return enforce(build_enforcer(_load_roles(), _load_users()), str(user.get("email") or ""), permission)
    if permission not in profile["permissions"]:
        return False
    return enforce(build_enforcer(_load_roles(), _load_users()), str(user.get("email") or ""), permission)

用户状态存放在 ``<repo>/data/users.json``(与 microsoft-mail-accounts.json
同级,由 DATA_DIR 解析)。首次导入时若无该邮箱,会自动创建内置管理员
账号(见 ``DEFAULT_ADMIN_EMAIL``)。
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import secrets
import threading
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field

from invite_codes import InviteCodeError, use_invite_code
from casbin_authorization import build_enforcer, enforce

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
OWNER_EMAIL = DEFAULT_ADMIN_EMAIL
OWNER_ROLE = "owner"
DEFAULT_ADMIN_PASSWORD = "xianxing1"

SESSION_COOKIE_NAME = "mercurypro_session"
SESSION_TTL_SECONDS = 7 * 24 * 3600  # 记住我 7 天;未勾选则仅浏览器会话 Cookie
JWT_ALGORITHM = "HS256"
# 权限模型：角色授权与用户额外授权合并后生成最终菜单和权限。
# 后端权限校验默认启用；仅允许通过环境变量在紧急排障时显式关闭。
PERMISSION_ENFORCEMENT_ENABLED = os.environ.get("MERCURY_PERMISSION_ENFORCEMENT", "true").strip().lower() in {"1", "true", "yes", "on"}

MENU_DEFINITIONS: list[dict[str, Any]] = [
    {"key": "dashboard", "path": "/dashboard", "label": "数据仪表盘", "icon": "dashboard", "permission": "dashboard:view"},
    {"key": "email", "path": "/email", "label": "邮箱管理", "icon": "mail", "permission": "email:view"},
    {"key": "register", "path": "/register", "label": "AI注册", "icon": "register", "permission": "register:view"},
    {"key": "invite", "path": "/invite", "label": "邀请码", "icon": "invite", "permission": "invite:view"},
    {"key": "logs", "path": "/logs", "label": "注册日志", "icon": "logs", "permission": "logs:view"},
    {"key": "audit", "path": "/audit", "label": "操作审计", "icon": "audit", "permission": "audit:view"},
    {"key": "access", "path": "/access", "label": "权限中心", "icon": "access", "permission": "access:manage"},
]


def _load_menu_registry() -> list[dict[str, Any]]:
    """Read the shared frontend registry; new entries become catalog options automatically."""
    registry = PROJECT_ROOT / "src" / "data" / "menu-registry.json"
    try:
        parsed = json.loads(registry.read_text(encoding="utf-8"))
        if isinstance(parsed, list):
            items = [item for item in parsed if isinstance(item, dict) and item.get("key") and item.get("path") and item.get("permission")]
            if items:
                return items
    except (OSError, json.JSONDecodeError):
        pass
    return MENU_DEFINITIONS


MENU_DEFINITIONS = _load_menu_registry()


def _menu_permission_definitions(menu_definitions: list[dict[str, Any]]) -> list[dict[str, str]]:
    definitions: list[dict[str, str]] = []
    for menu in menu_definitions:
        raw_permissions = menu.get("permissions", [])
        if isinstance(raw_permissions, dict):
            raw_permissions = [{"code": code, "label": label} for code, label in raw_permissions.items()]
        if not isinstance(raw_permissions, list):
            continue
        for raw in raw_permissions:
            if isinstance(raw, str):
                code, item = raw.strip(), {}
            elif isinstance(raw, dict):
                code, item = str(raw.get("code") or "").strip(), raw
            else:
                continue
            if code:
                definitions.append({"code": code, "label": str(item.get("label") or item.get("permissionLabel") or f"操作{menu.get('label', '')}"), "group": str(item.get("group") or menu.get("group") or "工作台")})
    return definitions


PERMISSION_DEFINITIONS: list[dict[str, str]] = [
    {"code": "dashboard:view", "label": "查询数据仪表盘", "group": "工作台"},
    {"code": "email:view", "label": "查询邮箱", "group": "邮箱管理"},
    {"code": "email:messages", "label": "查询收件邮件", "group": "邮箱公开接口"},
    {"code": "email:detail", "label": "查询邮件详情", "group": "邮箱公开接口"},
    {"code": "email:refresh", "label": "刷新 Token", "group": "邮箱管理"},
    {"code": "email:create", "label": "新增邮箱", "group": "邮箱管理"},
    {"code": "email:delete", "label": "删除邮箱", "group": "邮箱管理"},
    {"code": "register:view", "label": "查询 AI 注册", "group": "注册中心"},
    {"code": "register:config", "label": "AI 注册配置", "group": "注册中心"},
    {"code": "register:run", "label": "AI 注册执行", "group": "注册中心"},
    {"code": "register:resource", "label": "AI 注册资源管理", "group": "注册中心"},
    {"code": "register:tools", "label": "AI 注册导入与工具", "group": "注册中心"},
    {"code": "register:token:read", "label": "AI 注册 Token 查看", "group": "注册中心"},
    {"code": "invite:view", "label": "查询邀请码", "group": "系统管理"},
    {"code": "invite:create", "label": "生成邀请码", "group": "邀请码管理"},
    {"code": "invite:update", "label": "修改邀请码", "group": "邀请码管理"},
    {"code": "invite:delete", "label": "销毁邀请码", "group": "邀请码管理"},
    {"code": "invite:export", "label": "导出邀请码", "group": "邀请码管理"},
    {"code": "invite:manage", "label": "管理邀请码", "group": "系统管理"},
    {"code": "logs:view", "label": "注册日志查询", "group": "审计中心"},
    {"code": "audit:view", "label": "操作日志查询", "group": "审计中心"},
    {"code": "access:manage", "label": "管理角色与权限", "group": "系统管理"},
    {"code": "profile:update", "label": "材料修改权限", "group": "个人中心"},
]

# Every registered menu automatically contributes its view permission to the catalog.
_registered_permissions = {str(item["permission"]): item for item in MENU_DEFINITIONS}
for _permission, _menu in reversed(list(_registered_permissions.items())):
    if not any(str(item.get("code")) == _permission for item in PERMISSION_DEFINITIONS):
        PERMISSION_DEFINITIONS.insert(0, {"code": _permission, "label": str(_menu.get("permissionLabel") or f"查看{_menu.get('label', '')}"), "group": str(_menu.get("group") or "工作台")})
for _permission in reversed(_menu_permission_definitions(MENU_DEFINITIONS)):
    if not any(str(item.get("code")) == _permission["code"] for item in PERMISSION_DEFINITIONS):
        PERMISSION_DEFINITIONS.insert(0, _permission)


def _roles_file() -> Path:
    return DATA_DIRECTORY / "roles.json"


def _public_permissions_file() -> Path:
    return DATA_DIRECTORY / "public-permissions.json"


def _load_public_permissions() -> set[str]:
    defaults = {"email:messages", "email:detail"}
    path = _public_permissions_file()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        values = parsed.get("permissions", []) if isinstance(parsed, dict) else parsed
        if isinstance(values, list):
            return set(_clean_access_values(values, set(_all_permission_codes())))
    except (OSError, json.JSONDecodeError):
        pass
    return defaults & set(_all_permission_codes())


def _save_public_permissions(values: list[str]) -> None:
    path = _public_permissions_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"permissions": values}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")



def permission_is_public(permission: str) -> bool:
    return str(permission or "") in _load_public_permissions()


def _all_menu_keys() -> list[str]:
    return [str(item["key"]) for item in MENU_DEFINITIONS]


def _all_permission_codes() -> list[str]:
    return [str(item["code"]) for item in PERMISSION_DEFINITIONS]


def _default_roles() -> dict[str, dict[str, Any]]:
    all_menus = _all_menu_keys()
    all_permissions = _all_permission_codes()
    return {
        "owner": {
            "key": "owner",
            "label": "站主",
            "description": "站主拥有全部当前及未来菜单和权限，身份不可修改。",
            "color": "amber",
            "menuKeys": list(all_menus),
            "permissions": list(all_permissions),
            "isSystem": True, "isProtected": True,
        },
        "admin": {
            "key": "admin",
            "label": "管理员",
            "description": "可以访问工作台全部模块并管理系统授权。",
            "color": "violet",
            "menuKeys": list(all_menus),
            "permissions": list(all_permissions),
        },
        "user": {
            "key": "user",
            "label": "普通用户",
            "description": "默认注册角色，可使用个人邮箱工作台。",
            "color": "blue",
            "menuKeys": ["dashboard", "email"],
            "permissions": ["dashboard:view", "email:view"],
        },
    }


def _load_roles() -> dict[str, dict[str, Any]]:
    path = _roles_file()
    defaults = _default_roles()
    if not path.exists():
        return defaults
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return defaults
    if not isinstance(parsed, dict):
        return defaults
    roles = defaults.copy()
    for key, value in parsed.items():
        if isinstance(value, dict) and str(key).strip():
            roles[str(key)] = {**defaults.get(str(key), {"key": str(key)}), **value, "key": str(key)}
    all_menus = _all_menu_keys()
    all_permissions = _all_permission_codes()
    normalized: dict[str, dict[str, Any]] = {}
    for key, role in roles.items():
        menu_keys = _clean_access_values(role.get("menuKeys"), set(_all_menu_keys()))
        permissions = _clean_access_values(role.get("permissions"), set(_all_permission_codes()))
        permissions = list(dict.fromkeys([*permissions, *_menu_permissions(menu_keys)]))
        if key == OWNER_ROLE:
            # Owner is a capability wildcard: newly registered menus/permissions are automatic.
            menu_keys = list(all_menus)
            permissions = list(all_permissions)
        elif key == "admin":
            menu_keys = list(dict.fromkeys([*menu_keys, "access"]))
            permissions = list(dict.fromkeys([*permissions, "access:manage"]))
        normalized[key] = {**role, "key": key, "menuKeys": menu_keys, "permissions": permissions}
    return normalized


def _save_roles(roles: dict[str, dict[str, Any]]) -> None:
    path = _roles_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(roles, ensure_ascii=False, indent=2), encoding="utf-8")


def _clean_access_values(values: Any, allowed: set[str]) -> list[str]:
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip() in allowed))


def _menu_permissions(menu_keys: list[str]) -> list[str]:
    selected = set(menu_keys)
    return list(dict.fromkeys(
        str(item.get("permission") or "").strip()
        for item in MENU_DEFINITIONS
        if str(item.get("key") or "") in selected and str(item.get("permission") or "").strip()
    ))


def is_owner(user: dict[str, Any] | None) -> bool:
    """Owner status is derived from canonical email, never client supplied role."""
    return bool(user) and str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower()

def _effective_role(user: dict[str, Any] | None) -> str:
    if is_owner(user):
        return OWNER_ROLE
    role = str((user or {}).get("role") or "user")
    return role if role != OWNER_ROLE else "user"

def access_profile(user: dict[str, Any]) -> dict[str, Any]:
    """Merge persisted role grants and per-user grants into one access profile."""
    email = str(user.get("email") or "").strip()
    stored_user = _find_user(email) if email else None
    source = stored_user or user
    roles = _load_roles()
    role_key = _effective_role(source)
    role = roles.get(role_key) or roles["user"]
    role_menus = _clean_access_values(role.get("menuKeys"), set(_all_menu_keys()))
    role_permissions = _clean_access_values(role.get("permissions"), set(_all_permission_codes()))
    extra_menus = _clean_access_values(source.get("extraMenus"), set(_all_menu_keys()))
    extra_permissions = _clean_access_values(source.get("extraPermissions"), set(_all_permission_codes()))
    removed_menus = set(_clean_access_values(source.get("removedMenus"), set(_all_menu_keys())))
    removed_permissions = set(_clean_access_values(source.get("removedPermissions"), set(_all_permission_codes())))
    if role_key == OWNER_ROLE:
        role_menus = list(_all_menu_keys())
        role_permissions = list(_all_permission_codes())
        extra_menus, extra_permissions = [], []
        removed_menus, removed_permissions = set(), set()
    elif role_key == "admin":
        # 管理员模板可以收紧业务权限，但必须始终保留权限中心，避免把系统锁死。
        role_menus = list(dict.fromkeys([*role_menus, "access"]))
        role_permissions = list(dict.fromkeys([*role_permissions, "access:manage"]))
    else:
        role_menus = [key for key in role_menus if key != "access"]
        extra_menus = [key for key in extra_menus if key != "access"]
        role_permissions = [code for code in role_permissions if code != "access:manage"]
        extra_permissions = [code for code in extra_permissions if code != "access:manage"]
    role_permissions = list(dict.fromkeys([*role_permissions, *_menu_permissions(role_menus)]))
    # Do not return computed permissions as raw overrides: editing/saving them
    # would otherwise turn inherited grants into persistent personal grants.
    # Explicit user grants have the highest precedence.
    menu_keys = ((set(role_menus) - removed_menus) | set(extra_menus))
    permission_codes = set(role_permissions) | set(extra_permissions) | set(_menu_permissions(extra_menus))
    for menu in MENU_DEFINITIONS:
        permission = str(menu.get("permission") or "")
        if menu["key"] in removed_menus and permission not in extra_permissions and not any(
            other["key"] in menu_keys and other.get("permission") == permission
            for other in MENU_DEFINITIONS
        ):
            permission_codes.discard(permission)
    permission_codes = (permission_codes - removed_permissions) | set(extra_permissions)
    if role_key == OWNER_ROLE:
        menu_keys = set(_all_menu_keys())
        permission_codes = set(_all_permission_codes())
    elif role_key == "admin":
        menu_keys.add("access")
        permission_codes.add("access:manage")
    # Menu visibility is independent from action permissions.
    menus = [dict(item) for item in MENU_DEFINITIONS
             if str(item["key"]) in menu_keys]
    permissions = [code for code in _all_permission_codes() if code in permission_codes]
    return {
        "role": role_key,
        "roleLabel": "站主" if is_owner(source) else str(role.get("label") or role_key),
        "isOwner": is_owner(source),
        "accessLocked": is_owner(source),
        "menus": menus,
        "permissions": permissions,
        "roleMenus": role_menus,
        "rolePermissions": role_permissions,
        "extraMenus": extra_menus,
        "extraPermissions": extra_permissions,
        "removedMenus": sorted(removed_menus),
        "removedPermissions": sorted(removed_permissions),
    }

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
    # Required for registration; ignored by login.
    invite_code: str = Field(default="", max_length=128)


class RolePayload(BaseModel):
    key: str = Field(min_length=2, max_length=40, pattern=r"^[a-z][a-z0-9_-]*$")
    label: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=200)
    color: str = Field(default="blue", max_length=20)
    menuKeys: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)


class UserAccessPayload(BaseModel):
    role: str = Field(min_length=2, max_length=40)
    extraMenus: list[str] = Field(default_factory=list)
    extraPermissions: list[str] = Field(default_factory=list)
    removedMenus: list[str] = Field(default_factory=list)
    removedPermissions: list[str] = Field(default_factory=list)


class PublicPermissionsPayload(BaseModel):
    permissions: list[str] = Field(default_factory=list)


class ProfilePayload(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    phone: str = Field(default="", max_length=32)
    bio: str = Field(default="", max_length=180)
    avatarColor: str = Field(default="blue", max_length=24)
    avatar: str = Field(default="", max_length=1_100_000)


class PasswordPayload(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


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
        if not isinstance(parsed, list):
            return []
        # Canonical owner identity is email-bound; migrate old admin records and
        # prevent role spoofing through stale persisted data.
        for item in parsed:
            if isinstance(item, dict):
                email = str(item.get("email") or "").strip().lower()
                if email == OWNER_EMAIL.lower():
                    item["role"] = OWNER_ROLE
                elif str(item.get("role") or "") == OWNER_ROLE:
                    item["role"] = "user"
        return parsed


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
    """Ensure the canonical site owner exists and migrate legacy admin data."""
    users = _load_users()
    owner = next((item for item in users if str(item.get("email", "")).strip().lower() == OWNER_EMAIL.lower()), None)
    if owner is None:
        users.append({
            "email": OWNER_EMAIL,
            "username": "站主",
            "role": OWNER_ROLE,
            "passwordHash": hash_password(DEFAULT_ADMIN_PASSWORD),
            "createdAt": int(time.time()),
        })
        _save_users(users)
        return
    changed = True
    owner["role"] = OWNER_ROLE
    if not owner.get("username"):
        owner["username"] = "站主"
        changed = True
    if changed:
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
        "role": OWNER_ROLE if str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower() else user.get("role", "user"),
        "roleLabel": "站主" if str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower() else ("管理员" if user.get("role") == "admin" else "普通用户"),
        "isOwner": str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower(),
        "accessLocked": str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower(),
        "phone": user.get("phone", ""),
        "bio": user.get("bio", ""),
        "avatarColor": user.get("avatarColor", "blue"),
        "avatar": user.get("avatar", ""),
        "createdAt": user.get("createdAt"),
    }



_ALLOWED_AVATAR_PREFIXES = (
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/webp;base64,",
)
_MAX_AVATAR_BYTES = 768 * 1024


def _normalize_avatar_data(value: str) -> str:
    avatar = value.strip()
    if not avatar:
        return ""
    prefix = next((item for item in _ALLOWED_AVATAR_PREFIXES if avatar.startswith(item)), None)
    if prefix is None:
        raise AuthError(400, "头像仅支持 PNG、JPG 或 WebP 格式")
    try:
        decoded = base64.b64decode(avatar[len(prefix):], validate=True)
    except (binascii.Error, ValueError):
        raise AuthError(400, "头像数据无效，请重新上传") from None
    if not decoded or len(decoded) > _MAX_AVATAR_BYTES:
        raise AuthError(400, "头像处理后不能超过 768KB")
    return avatar

def _created_date(user: dict[str, Any]) -> date | None:
    """兼容历史用户数据,把 Unix 秒时间戳安全转换为服务端本地日期。"""
    try:
        created_at = float(user.get("createdAt", 0))
        if created_at <= 0:
            return None
        return date.fromtimestamp(created_at)
    except (OSError, OverflowError, TypeError, ValueError):
        return None


def build_user_stats(today: date | None = None) -> dict[str, Any]:
    """生成不含个人信息的用户统计数据,供登录后的仪表盘展示。"""
    current_day = today or date.today()
    users = _load_users()
    created_dates = [value for user in users if (value := _created_date(user))]

    last_30_start = current_day - timedelta(days=29)
    previous_30_start = last_30_start - timedelta(days=30)
    new_last_30 = sum(last_30_start <= value <= current_day for value in created_dates)
    new_previous_30 = sum(previous_30_start <= value < last_30_start for value in created_dates)
    if new_previous_30:
        growth_rate = round((new_last_30 - new_previous_30) / new_previous_30 * 100, 1)
    else:
        growth_rate = 100.0 if new_last_30 else 0.0

    daily = []
    for offset in range(29, -1, -1):
        day = current_day - timedelta(days=offset)
        daily.append(
            {
                "date": day.isoformat(),
                "label": f"{day.month}/{day.day}",
                "count": sum(value == day for value in created_dates),
            }
        )

    weekly = []
    for week_index in range(7, -1, -1):
        end = current_day - timedelta(days=week_index * 7)
        start = end - timedelta(days=6)
        weekly.append(
            {
                "label": f"{start.month}/{start.day}-{end.month}/{end.day}",
                "count": sum(start <= value <= end for value in created_dates),
            }
        )

    admin_count = sum(str(user.get("role", "user")) == "admin" for user in users)
    return {
        "summary": {
            "totalUsers": len(users),
            "newUsersLast30Days": new_last_30,
            "newUsersToday": sum(value == current_day for value in created_dates),
            "growthRate": growth_rate,
        },
        "dailyRegistrations": daily,
        "weeklyRegistrations": weekly,
        "roleDistribution": [
            {"label": "管理员", "count": admin_count},
            {"label": "普通用户", "count": len(users) - admin_count},
        ],
        "generatedAt": int(time.time()),
    }


# ── JWT 会话 ────────────────────────────────────────────────


def issue_session(response: Response, user: dict[str, Any], remember: bool) -> None:
    now = int(time.time())
    token = jwt.encode(
        {
            "sub": str(user.get("email", "")).lower(),
            "username": user.get("username") or "",
            "role": OWNER_ROLE if str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower() else user.get("role", "user"),
        "roleLabel": "站主" if str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower() else ("管理员" if user.get("role") == "admin" else "普通用户"),
        "isOwner": str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower(),
        "accessLocked": str(user.get("email") or "").strip().lower() == OWNER_EMAIL.lower(),
        "phone": user.get("phone", ""),
        "bio": user.get("bio", ""),
        "avatarColor": user.get("avatarColor", "blue"),
        "createdAt": user.get("createdAt"),
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
    if user.get("role") not in {"admin", OWNER_ROLE}:
        raise AuthError(403, "需要管理员权限")
    return user


def user_has_permission(user: dict[str, Any], permission: str) -> bool:
    """Return whether the persisted user grants allow one permission."""
    if not PERMISSION_ENFORCEMENT_ENABLED:
        return True
    profile = access_profile(user)
    if permission not in profile["permissions"]:
        return False
    return enforce(build_enforcer(_load_roles(), _load_users()), str(user.get("email") or ""), permission)


def require_permission(permission: str):
    """Build a reusable FastAPI permission dependency."""
    def checker(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if not user_has_permission(user, permission):
            raise AuthError(403, f"没有权限访问该资源（需要 {permission}）")
        return user

    return checker


_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_REGISTRATION_PREFIXES = (
    "/api/health",
    "/api/output-paths",
    "/api/download",
    "/api/solver",
    "/api/proxy",
    "/api/config",
    "/api/sub2api",
    "/api/performance",
    "/api/mail",
    "/api/smsbower",
    "/api/register",
    "/api/sessions",
    "/api/account-rotation",
    "/api/chatgpt",
    "/api/batches",
    "/api/import",
    "/api/browser-debug",
)


def required_permission_for_request(path: str, method: str) -> str | None:
    """Map a protected request to the permission enforced by the API guard."""
    normalized = "/" + str(path or "").lstrip("/")
    verb = str(method or "GET").upper()
    if normalized == "/api/grok" or normalized.startswith("/api/grok/"):
        normalized = "/api" + normalized[len("/api/grok"):]

    if normalized == "/api/health/live":
        return None
    if normalized.startswith("/api/microsoft/public/mailboxes/"):
        suffix = normalized[len("/api/microsoft/public/mailboxes/"):].strip("/").split("/")
        if len(suffix) >= 3 and suffix[-2] == "messages":
            return "email:detail"
        return "email:messages"
    if normalized == "/api/microsoft/accounts" or normalized.startswith("/api/microsoft/accounts/"):
        suffix = normalized[len("/api/microsoft/accounts"):].strip("/").split("/")
        # Mailbox listing is the read permission; import and destructive account
        # operations have dedicated grants so they can be assigned independently.
        if normalized == "/api/microsoft/accounts":
            return "email:delete" if verb == "DELETE" else "email:view"
        if suffix and suffix[0] == "import":
            return "email:create" if verb in {"POST", "PUT", "PATCH"} else "email:view"
        if suffix and suffix[-1] == "refresh-token":
            return "email:refresh"
        if suffix and suffix[-1] == "status":
            return "email:view"
        if "messages" in suffix:
            return "email:detail" if len(suffix) >= 3 and suffix[-2] == "messages" else "email:messages"
        if verb == "DELETE":
            return "email:delete"
        return "email:view"
    # AI registration API permissions are intentionally explicit so the
    # registration page can grant read, configuration, execution, resources,
    # tools, and token visibility independently.
    if normalized == "/api/config" or normalized.startswith("/api/config/"):
        return "register:config"
    if normalized == "/api/register":
        return "register:run"
    if normalized == "/api/sessions":
        return "register:view" if verb in _READ_METHODS else "register:run"
    if normalized.startswith("/api/sessions/"):
        suffix = normalized[len("/api/sessions/"):]
        if verb in _READ_METHODS and not any(token in suffix for token in ("/stop", "/retry", "/reset")):
            return "register:view"
        return "register:run"
    if normalized == "/api/batches" or normalized.startswith("/api/batches/"):
        return "register:view" if verb in _READ_METHODS else "register:run"
    if normalized == "/api/chatgpt/accounts/access-tokens" or (normalized.startswith("/api/chatgpt/sessions/") and normalized.endswith("/access-token")):
        return "register:token:read"
    if normalized == "/api/chatgpt/accounts" or normalized.startswith("/api/chatgpt/accounts/"):
        return "register:resource"
    if normalized == "/api/chatgpt" or normalized.startswith("/api/chatgpt/"):
        return "register:view" if verb in _READ_METHODS else "register:resource"
    if normalized == "/api/account-rotation" or normalized.startswith("/api/account-rotation/"):
        return "register:resource"
    if normalized == "/api/mail/domain/test" or normalized.startswith("/api/solver") or normalized.startswith("/api/proxy") or normalized.startswith("/api/performance") or normalized.startswith("/api/sub2api") or normalized.startswith("/api/smsbower") or normalized.startswith("/api/import") or normalized.startswith("/api/browser-debug"):
        return "register:tools"
    if normalized == "/api/mail/hotmail/test":
        return "register:tools"
    if normalized == "/api/mail" or normalized.startswith("/api/mail/"):
        return "register:resource" if "/hotmail" in normalized else "register:config"
    if normalized == "/api/auth/stats":
        return "dashboard:view"
    if normalized.startswith("/api/auth/access/"):
        return "access:manage"
    if normalized == "/api/auth/profile" and verb in {"PUT", "PATCH", "POST"}:
        return "profile:update"
    for menu in MENU_DEFINITIONS:
        menu_path = str(menu.get("path") or "").rstrip("/")
        if menu_path and (normalized == menu_path or normalized.startswith(menu_path + "/")):
            return str(menu.get("permission") or "") or None
    if normalized.startswith("/api/auth/"):
        return None
    if normalized == "/api/microsoft" or normalized.startswith("/api/microsoft/"):
        return "email:view"
    if normalized == "/api/ai" or normalized.startswith("/api/ai/"):
        return "email:view"
    if normalized == "/api/logs" or normalized.startswith("/api/logs/"):
        return "logs:view"
    if normalized == "/api/audit-logs" or normalized.startswith("/api/audit-logs/"):
        return "audit:view"
    if normalized == "/api/invite-codes" or normalized.startswith("/api/invite-codes/"):
        suffix = normalized[len("/api/invite-codes"):].strip("/")
        if suffix == "export" and verb == "POST":
            return "invite:export"
        if not suffix:
            if verb == "POST":
                return "invite:create"
            if verb == "GET":
                return "invite:view"
        elif verb == "PUT":
            return "invite:update"
        elif verb == "DELETE":
            return "invite:delete"
        return "invite:view"
    if normalized == "/browser-debug" or normalized.startswith("/browser-debug/"):
        return "register:view"
    if any(normalized == prefix or normalized.startswith(prefix + "/") for prefix in _REGISTRATION_PREFIXES):
        return "register:view" if verb in _READ_METHODS else "register:run"
    if normalized == "/api" or normalized.startswith("/api/"):
        return "access:manage"
    return None


def has_valid_session(request: Request) -> bool:
    """中间件用:请求是否携带有效会话(不抛异常)。"""
    try:
        get_current_user(request)
        return True
    except HTTPException:
        return False


# ── 路由 ────────────────────────────────────────────────────


@router.post("/register")
async def register(payload: AuthCredentials, response: Response, request: Request = None) -> dict[str, Any]:
    from operation_logs import record_operation
    email = str(payload.email).strip().lower()
    if _find_user(email) is not None:
        record_operation(request=request, action="注册", status_code=409, detail="注册失败：邮箱已注册", risk="关注")
        raise AuthError(409, "该邮箱已注册,请直接登录")
    # Invitation codes are single-use credentials.
    try:
        use_invite_code(payload.invite_code)
    except InviteCodeError as exc:
        record_operation(request=request, action="注册", status_code=403, detail="注册失败：邀请码无效或已使用", risk="关注")
        raise AuthError(403, str(exc)) from exc

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
    record_operation(request=request, action="注册", status_code=200, user=_public_user(user), detail="创建用户并登录工作台")
    return {"user": _public_user(user), **access_profile(user)}


@router.post("/login")
async def login(payload: AuthCredentials, response: Response, request: Request = None) -> dict[str, Any]:
    from operation_logs import record_operation
    user = _find_user(str(payload.email))
    if user is None or not verify_password(
        payload.password, str(user.get("passwordHash", ""))
    ):
        # 邮箱不存在与密码错误返回同一提示,避免账号枚举
        record_operation(request=request, action="登录", status_code=401, user=user, detail="登录失败：邮箱或密码错误", risk="高风险")
        raise AuthError(401, "邮箱或密码错误")
    issue_session(response, user, remember=payload.remember)
    record_operation(request=request, action="登录", status_code=200, user=_public_user(user), detail="密码验证通过，登录工作台")
    return {"user": _public_user(user), **access_profile(user)}


@router.post("/logout")
async def logout(response: Response, request: Request = None) -> dict[str, Any]:
    from operation_logs import record_operation
    user = None
    if request is not None:
        try:
            user = get_current_user(request)
        except HTTPException:
            pass
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    record_operation(request=request, action="退出登录", status_code=200, user=user, detail="退出当前工作台会话")
    return {"ok": True}


@router.get("/me")
async def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": user, **access_profile(user)}


@router.get("/menus")
async def menus(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Return the merged role and per-user menu/permission profile."""
    return access_profile(user)



@router.put("/profile")
async def update_profile(payload: ProfilePayload, request: Request = None, user: dict[str, Any] = Depends(require_permission("profile:update"))) -> dict[str, Any]:
    from operation_logs import record_operation
    users = _load_users()
    target = next((item for item in users if str(item.get("email", "")).strip().lower() == str(user.get("email", "")).strip().lower()), None)
    if target is None:
        raise AuthError(404, "用户不存在")
    target["username"] = payload.username.strip()
    target["phone"] = payload.phone.strip()
    target["bio"] = payload.bio.strip()
    target["avatarColor"] = payload.avatarColor.strip() or "blue"
    target["avatar"] = _normalize_avatar_data(payload.avatar)
    _save_users(users)
    updated = _public_user(target)
    record_operation(request=request, action="材料修改权限", status_code=200, user=updated, detail="更新个人中心资料", module="个人中心")
    return {"user": updated}


@router.put("/password")
async def update_password(payload: PasswordPayload, request: Request = None, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    from operation_logs import record_operation
    target = _find_user(str(user.get("email", "")))
    if target is None or not verify_password(payload.currentPassword, str(target.get("passwordHash", ""))):
        record_operation(request=request, action="修改密码", status_code=400, user=user, detail="修改密码失败：当前密码错误", module="个人中心", risk="高风险")
        raise AuthError(400, "当前密码错误")
    if payload.newPassword == payload.currentPassword:
        raise AuthError(400, "新密码不能与当前密码相同")
    target["passwordHash"] = hash_password(payload.newPassword)
    users = _load_users()
    for index, item in enumerate(users):
        if str(item.get("email", "")).strip().lower() == str(target.get("email", "")).strip().lower():
            users[index] = target
            break
    _save_users(users)
    record_operation(request=request, action="修改密码", status_code=200, user=user, detail="密码已更新，下次登录生效", module="个人中心", risk="关注")
    return {"ok": True}
@router.get("/access/catalog")
async def access_catalog(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    public = _load_public_permissions()
    permissions = [{**item, "isPublic": str(item["code"]) in public} for item in PERMISSION_DEFINITIONS]
    return {"menus": [dict(item) for item in MENU_DEFINITIONS], "permissions": permissions, "capabilities": {"canManagePublicPermissions": is_owner(_admin), "canManageAdministrators": is_owner(_admin), "canEditAdminRole": is_owner(_admin)}}


@router.put("/access/public-permissions")
async def update_public_permissions(
    payload: PublicPermissionsPayload,
    _admin: dict[str, Any] = Depends(require_admin),
    request: Request = None,
) -> dict[str, Any]:
    from operation_logs import record_operation
    if not is_owner(_admin):
        raise AuthError(403, "仅站主可以修改公开接口权限")
    permissions = _clean_access_values(payload.permissions, set(_all_permission_codes()))
    _save_public_permissions(permissions)
    record_operation(
        request=request, action="权限变更", status_code=200, user=_admin,
        module="权限中心", risk="高风险",
        detail="更新公开接口：" + json.dumps(permissions, ensure_ascii=False),
    )
    return {"permissions": permissions}


@router.get("/access/roles")
async def access_roles(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    actor_owner = is_owner(_admin)
    items = []
    for role in _load_roles().values():
        item = dict(role)
        item["isSystem"] = role.get("key") in {OWNER_ROLE, "admin", "user"}
        item["isProtected"] = role.get("key") == OWNER_ROLE
        item["canEdit"] = role.get("key") != OWNER_ROLE and (actor_owner or role.get("key") != "admin")
        items.append(item)
    return {"items": items}


@router.put("/access/roles/{role_key}")
async def update_access_role(role_key: str, payload: RolePayload, _admin: dict[str, Any] = Depends(require_admin), request: Request = None) -> dict[str, Any]:
    from operation_logs import record_operation
    key = str(role_key or payload.key).strip()
    if key == OWNER_ROLE:
        raise AuthError(403, "站主角色不可修改")
    if key == "admin" and not is_owner(_admin):
        raise AuthError(403, "管理员角色仅站主可以修改")
    if key != payload.key:
        raise AuthError(400, "角色标识不能在编辑时修改")
    roles = _load_roles()
    if key not in roles:
        raise AuthError(404, "角色不存在")
    menu_keys = _clean_access_values(payload.menuKeys, set(_all_menu_keys()))
    permissions = _clean_access_values(payload.permissions, set(_all_permission_codes()))
    if key == "admin":
        menu_keys = list(dict.fromkeys([*menu_keys, "access"]))
        permissions = list(dict.fromkeys([*permissions, "access:manage"]))
    else:
        menu_keys = [item for item in menu_keys if item != "access"]
        permissions = [item for item in permissions if item != "access:manage"]
    permissions = list(dict.fromkeys([*permissions, *_menu_permissions(menu_keys)]))
    previous = roles[key]
    roles[key] = {
        "key": key,
        "label": payload.label.strip(),
        "description": payload.description.strip(),
        "color": payload.color.strip() or "blue",
        "menuKeys": menu_keys,
        "permissions": permissions,
    }
    _save_roles(roles)
    record_operation(
        request=request, action="权限变更", status_code=200, user=_admin,
        module="权限中心", risk="高风险",
        detail=f"修改角色授权：{key}；" + json.dumps(
            {"before": previous, "after": roles[key]}, ensure_ascii=False,
        ),
    )
    return roles[key]


def _access_target_metadata(actor: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    actor_owner = is_owner(actor)
    target_owner = is_owner(target)
    target_role = _effective_role(target)
    return {
        "canEdit": actor_owner and not target_owner or (not actor_owner and target_role not in {OWNER_ROLE, "admin"}),
        "assignableRoles": [key for key in _load_roles() if key != OWNER_ROLE and (actor_owner or key != "admin")],
    }


@router.get("/access/users")
async def access_users(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    items = []
    for user in _load_users():
        public = _public_user(user)
        profile = access_profile(user)
        items.append({**public, **_access_target_metadata(_admin, user), "createdAt": user.get("createdAt"), "extraMenus": profile["extraMenus"], "extraPermissions": profile["extraPermissions"], "removedMenus": profile["removedMenus"], "removedPermissions": profile["removedPermissions"], "roleMenus": profile["roleMenus"], "rolePermissions": profile["rolePermissions"], "menus": profile["menus"], "permissions": profile["permissions"]})
    return {"items": items}


@router.get("/access/users/{email}")
async def access_user(email: str, _admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    target = _find_user(email)
    if target is None:
        raise AuthError(404, "用户不存在")
    public = _public_user(target)
    profile = access_profile(target)
    return {**public, **profile, **_access_target_metadata(_admin, target), "createdAt": target.get("createdAt")}


@router.put("/access/users/{email}")
async def update_user_access(email: str, payload: UserAccessPayload, _admin: dict[str, Any] = Depends(require_admin), request: Request = None) -> dict[str, Any]:
    from operation_logs import record_operation
    roles = _load_roles()
    if payload.role not in roles:
        raise AuthError(400, "角色不存在")
    if payload.role == OWNER_ROLE:
        raise AuthError(403, "站主角色仅绑定系统站主账号，不可分配")
    users = _load_users()
    target = next((item for item in users if str(item.get("email", "")).strip().lower() == email.strip().lower()), None)
    if target is None:
        raise AuthError(404, "用户不存在")
    actor_is_owner = is_owner(_admin)
    target_is_owner = is_owner(target)
    target_role = _effective_role(target)
    if target_is_owner:
        raise AuthError(403, "站主账号和角色不可修改")
    if not actor_is_owner and (target_role == "admin" or payload.role in {OWNER_ROLE, "admin"}):
        raise AuthError(403, "管理员只能调整普通用户或自定义角色")
    if (not actor_is_owner) and (
        str(target.get("role") or "user") == "admin"
        and payload.role != "admin"
        and sum(str(item.get("role") or "user") == "admin" for item in users) <= 1
    ):
        raise AuthError(400, "必须至少保留一个管理员账号")
    extra_menus = _clean_access_values(payload.extraMenus, set(_all_menu_keys()))
    extra_permissions = _clean_access_values(payload.extraPermissions, set(_all_permission_codes()))
    removed_menus = _clean_access_values(payload.removedMenus, set(_all_menu_keys()))
    removed_permissions = _clean_access_values(payload.removedPermissions, set(_all_permission_codes()))
    if payload.role != "admin":
        extra_menus = [item for item in extra_menus if item != "access"]
        extra_permissions = [item for item in extra_permissions if item != "access:manage"]
    access_fields = ("role", "extraMenus", "extraPermissions", "removedMenus", "removedPermissions")
    previous = {key: target.get(key) for key in access_fields}
    target["role"] = payload.role
    target["extraMenus"] = extra_menus
    target["extraPermissions"] = extra_permissions
    target["removedMenus"] = removed_menus
    target["removedPermissions"] = removed_permissions
    _save_users(users)
    public = _public_user(target)
    profile = access_profile(target)
    record_operation(
        request=request, action="权限变更", status_code=200, user=_admin,
        module="权限中心", risk="高风险",
        detail=f"修改用户授权：{public['email']}；" + json.dumps(
            {"before": previous, "after": {key: target.get(key) for key in access_fields}, "effectivePermissions": profile["permissions"]},
            ensure_ascii=False,
        ),
    )
    return {"user": public, **profile, **_access_target_metadata(_admin, target)}


@router.get("/stats")
async def user_stats(
    _user: dict[str, Any] = Depends(require_permission("dashboard:view")),
) -> dict[str, Any]:
    """返回用户数量、近 30 天趋势、周注册量和角色占比。"""
    return build_user_stats()
