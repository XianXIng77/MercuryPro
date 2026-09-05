"""Casbin authorization engine for MercuryPro."""
from __future__ import annotations
import casbin
from pathlib import Path

_MODEL = """
[request_definition]
r = sub, obj, act
[policy_definition]
p = sub, obj, act
[role_definition]
g = _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act
"""

def build_enforcer(roles: dict, users: list[dict]) -> casbin.Enforcer:
    model = casbin.Model()
    model.load_model_from_text(_MODEL)
    e = casbin.Enforcer(model)
    for role_key, role in roles.items():
        for permission in role.get("permissions", []):
            resource, _, action = str(permission).partition(":")
            e.add_policy(role_key, resource, action or "use")
    for user in users:
        email = str(user.get("email") or "")
        role = str(user.get("role") or "user")
        if email:
            e.add_role_for_user(email, role)
        for permission in user.get("extraPermissions", []):
            resource, _, action = str(permission).partition(":")
            e.add_policy(email, resource, action or "use")
    return e


def enforce(enforcer: casbin.Enforcer, subject: str, permission: str) -> bool:
    resource, _, action = str(permission).partition(":")
    return bool(enforcer.enforce(subject, resource, action or "use"))
