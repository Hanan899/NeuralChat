"""Role-based access control helpers for FastAPI endpoints.

This module is the backend RBAC source of truth. It is designed to work with the
existing Clerk JWT verification flow already used by the app.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Awaitable, Callable

from fastapi import HTTPException, Request, status
from pydantic import BaseModel

from app.auth import extract_bearer_token, verify_clerk_token


class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    OWNER = "owner"
    MEMBER = "member"
    VIEWER = "viewer"
    GUEST = "guest"


class Permission(str, Enum):
    CHAT_CREATE = "chat:create"
    CHAT_READ = "chat:read"
    PROJECT_CREATE = "project:create"
    PROJECT_READ = "project:read"
    PROJECT_DELETE = "project:delete"
    AGENT_RUN = "agent:run"
    FILE_UPLOAD = "file:upload"
    FILE_READ = "file:read"
    MEMORY_READ = "memory:read"
    MEMORY_WRITE = "memory:write"
    MEMBER_MANAGE = "member:manage"
    BILLING_READ = "billing:read"
    BILLING_MANAGE = "billing:manage"
    USAGE_READ = "usage:read"
    USAGE_MANAGE = "usage:manage"
    USER_IMPERSONATE = "user:impersonate"
    PLATFORM_MANAGE = "platform:manage"


ROLE_HIERARCHY: dict[Role, int] = {
    Role.SUPER_ADMIN: 100,
    Role.OWNER: 80,
    Role.MEMBER: 50,
    Role.VIEWER: 20,
    Role.GUEST: 10,
}


ROLE_LABELS: dict[Role, str] = {
    Role.SUPER_ADMIN: "Super Admin",
    Role.OWNER: "Owner",
    Role.MEMBER: "Member",
    Role.VIEWER: "Viewer",
    Role.GUEST: "Guest",
}


DEFAULT_ROLE = Role.MEMBER


ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.SUPER_ADMIN: set(Permission),
    Role.OWNER: {
        permission
        for permission in Permission
        if permission not in {Permission.USER_IMPERSONATE, Permission.PLATFORM_MANAGE}
    },
    Role.MEMBER: {
        Permission.CHAT_CREATE,
        Permission.CHAT_READ,
        Permission.PROJECT_CREATE,
        Permission.PROJECT_READ,
        Permission.AGENT_RUN,
        Permission.FILE_UPLOAD,
        Permission.FILE_READ,
        Permission.MEMORY_READ,
        Permission.MEMORY_WRITE,
        Permission.USAGE_READ,
    },
    Role.VIEWER: {
        Permission.CHAT_READ,
        Permission.PROJECT_READ,
        Permission.FILE_READ,
        Permission.USAGE_READ,
    },
    Role.GUEST: {
        Permission.CHAT_READ,
        Permission.PROJECT_READ,
        Permission.FILE_READ,
    },
}


def has_permission(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[role]


def has_minimum_role(user_role: Role, minimum_role: Role) -> bool:
    return ROLE_HIERARCHY[user_role] >= ROLE_HIERARCHY[minimum_role]


class AuthContext(BaseModel):
    user_id: str
    role: Role
    display_name: str | None = None
    email: str | None = None

    def can(self, permission: Permission) -> bool:
        return has_permission(self.role, permission)

    def is_at_least(self, minimum_role: Role) -> bool:
        return has_minimum_role(self.role, minimum_role)

    def is_super_admin(self) -> bool:
        return self.role == Role.SUPER_ADMIN

    def is_owner(self) -> bool:
        return self.role in {Role.SUPER_ADMIN, Role.OWNER}


def _coerce_role(raw_role: Any) -> Role:
    candidate = str(raw_role or "").strip().lower()
    try:
        return Role(candidate)
    except ValueError:
        return DEFAULT_ROLE


def _extract_display_name(claims: dict[str, Any]) -> str | None:
    possible_values = [
        claims.get("display_name"),
        claims.get("name"),
        claims.get("full_name"),
        claims.get("username"),
    ]
    for value in possible_values:
        text_value = str(value or "").strip()
        if text_value:
            return text_value
    return None


def _extract_email(claims: dict[str, Any]) -> str | None:
    possible_values = [
        claims.get("email"),
        claims.get("primary_email_address"),
    ]
    for value in possible_values:
        text_value = str(value or "").strip()
        if text_value:
            return text_value
    return None


async def get_auth_context(request: Request) -> AuthContext:
    cached_context = getattr(request.state, "auth_context", None)
    if isinstance(cached_context, AuthContext):
        return cached_context

    claims = getattr(request.state, "clerk_claims", None)
    if not isinstance(claims, dict):
        authorization = request.headers.get("Authorization")
        token = extract_bearer_token(authorization)
        claims = verify_clerk_token(token)
        request.state.clerk_claims = claims

    user_id = str(claims.get("sub", "")).strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject claim.")

    metadata = claims.get("metadata")
    metadata_dict = metadata if isinstance(metadata, dict) else {}
    role = _coerce_role(metadata_dict.get("role"))

    auth_context = AuthContext(
        user_id=user_id,
        role=role,
        display_name=_extract_display_name(claims),
        email=_extract_email(claims),
    )
    request.state.auth_context = auth_context
    return auth_context


def require_role(minimum_role: Role) -> Callable[[Request], Awaitable[AuthContext]]:
    async def dependency(request: Request) -> AuthContext:
        context = await get_auth_context(request)
        if not context.is_at_least(minimum_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"This action requires the '{ROLE_LABELS[minimum_role]}' role or higher. "
                    f"Your current role is '{ROLE_LABELS[context.role]}'."
                ),
            )
        return context

    return dependency


def require_permission(permission: Permission) -> Callable[[Request], Awaitable[AuthContext]]:
    async def dependency(request: Request) -> AuthContext:
        context = await get_auth_context(request)
        if not context.can(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You do not have the required permission: '{permission.value}'.",
            )
        return context

    return dependency


def require_owner_or_self(target_user_id_param: str = "user_id") -> Callable[[Request], Awaitable[AuthContext]]:
    async def dependency(request: Request) -> AuthContext:
        context = await get_auth_context(request)
        target_user_id = (
            request.path_params.get(target_user_id_param)
            or request.query_params.get(target_user_id_param)
            or ""
        )
        target_user_id = str(target_user_id).strip()

        if context.is_owner() or target_user_id == context.user_id:
            return context

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires owner access or access to your own user record.",
        )

    return dependency
