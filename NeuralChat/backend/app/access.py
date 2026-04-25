from __future__ import annotations

import os
from datetime import UTC, datetime
from enum import Enum
from typing import Any

import httpx
from fastapi import Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.auth import extract_bearer_token, verify_clerk_token
from app.services.cache import api_cache
from app.services.cost_tracker import resolve_daily_limit, resolve_monthly_limit
from app.services.memory import load_profile, save_profile

ACCESS_CACHE_TTL_SECONDS = 60
CLERK_USERS_CACHE_KEY = "access::clerk::users"
CLERK_API_BASE_URL = "https://api.clerk.com/v1"


class AppRole(str, Enum):
    OWNER = "owner"
    MEMBER = "member"
    USER = "user"


class AppFeature(str, Enum):
    CHAT_CREATE = "chat:create"
    PROJECT_CREATE = "project:create"
    PROJECT_DELETE = "project:delete"
    AGENT_RUN = "agent:run"
    FILE_UPLOAD = "file:upload"
    MEMORY_READ = "memory:read"
    MEMORY_WRITE = "memory:write"
    USAGE_READ = "usage:read"
    USAGE_MANAGE = "usage:manage"
    BILLING_MANAGE = "billing:manage"


ROLE_LABELS: dict[AppRole, str] = {
    AppRole.OWNER: "Owner",
    AppRole.MEMBER: "Member",
    AppRole.USER: "User",
}
DEFAULT_ROLE = AppRole.USER
ROLE_DEFAULT_FEATURES: dict[AppRole, set[AppFeature]] = {
    AppRole.OWNER: set(AppFeature),
    AppRole.MEMBER: {
        AppFeature.CHAT_CREATE,
        AppFeature.PROJECT_CREATE,
        AppFeature.PROJECT_DELETE,
        AppFeature.AGENT_RUN,
        AppFeature.FILE_UPLOAD,
        AppFeature.MEMORY_READ,
        AppFeature.MEMORY_WRITE,
        AppFeature.USAGE_READ,
    },
    AppRole.USER: {
        AppFeature.CHAT_CREATE,
        AppFeature.USAGE_READ,
    },
}


class AccessContext(BaseModel):
    user_id: str
    email: str | None = None
    display_name: str | None = None
    role: AppRole = DEFAULT_ROLE
    feature_overrides: dict[AppFeature, bool] = Field(default_factory=dict)
    usage_limits: dict[str, float | None] = Field(default_factory=lambda: {"daily_limit_usd": None, "monthly_limit_usd": None})
    seeded_owner: bool = False

    def is_owner(self) -> bool:
        return self.role == AppRole.OWNER

    def has_feature(self, feature: AppFeature) -> bool:
        if self.is_owner():
            return True
        if feature in self.feature_overrides:
            return bool(self.feature_overrides[feature])
        return feature in ROLE_DEFAULT_FEATURES[self.role]

    def get_effective_limits(self, profile: dict[str, Any] | None = None) -> dict[str, float]:
        return {
            "daily_limit_usd": _resolve_limit_value(self.usage_limits.get("daily_limit_usd"), profile, "daily"),
            "monthly_limit_usd": _resolve_limit_value(self.usage_limits.get("monthly_limit_usd"), profile, "monthly"),
        }


class MemberUsageSummary(BaseModel):
    daily_spent_usd: float
    monthly_spent_usd: float
    total_cost_usd: float
    total_input_tokens: int
    total_output_tokens: int


class MemberAccessProfile(BaseModel):
    user_id: str
    display_name: str
    email: str | None = None
    last_active_at: str | None = None
    role: AppRole
    role_label: str
    feature_overrides: dict[str, bool]
    effective_features: list[str]
    usage_limits: dict[str, float]
    usage: MemberUsageSummary | None = None
    seeded_owner: bool = False


def _access_cache_key(user_id: str) -> str:
    return f"access::user::{user_id}"


def _normalize_email(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized or None


def _parse_csv_env(name: str) -> set[str]:
    raw_value = os.getenv(name, "")
    return {item.strip() for item in raw_value.split(",") if item.strip()}


def _parse_email_env(name: str) -> set[str]:
    return {item.lower() for item in _parse_csv_env(name)}


def _get_seeded_owner_ids() -> set[str]:
    return _parse_csv_env("OWNER_USER_IDS")


def _get_seeded_owner_emails() -> set[str]:
    return _parse_email_env("OWNER_EMAILS")


def _get_clerk_secret_key(required: bool = False) -> str | None:
    secret = os.getenv("CLERK_SECRET_KEY", "").strip() or None
    if required and not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLERK_SECRET_KEY is required for access management routes.",
        )
    return secret


def _extract_claims_email(claims: dict[str, Any]) -> str | None:
    email_candidates = [
        claims.get("email"),
        claims.get("email_address"),
        claims.get("primary_email_address"),
    ]
    for candidate in email_candidates:
        normalized = _normalize_email(candidate if isinstance(candidate, str) else None)
        if normalized:
            return normalized
    return None


def _extract_claims_display_name(claims: dict[str, Any]) -> str | None:
    for field_name in ("name", "full_name", "username", "preferred_username", "given_name"):
        raw_value = claims.get(field_name)
        if isinstance(raw_value, str) and raw_value.strip():
            return raw_value.strip()
    return None


def _extract_clerk_email(clerk_user: dict[str, Any]) -> str | None:
    primary_email_id = str(clerk_user.get("primary_email_address_id", "") or "").strip()
    email_addresses = clerk_user.get("email_addresses")
    if isinstance(email_addresses, list):
        for entry in email_addresses:
            if not isinstance(entry, dict):
                continue
            email_address = _normalize_email(str(entry.get("email_address", "") or ""))
            if not email_address:
                continue
            if primary_email_id and str(entry.get("id", "") or "").strip() == primary_email_id:
                return email_address
            if not primary_email_id:
                return email_address
    return None


def _extract_clerk_display_name(clerk_user: dict[str, Any]) -> str | None:
    first_name = str(clerk_user.get("first_name", "") or "").strip()
    last_name = str(clerk_user.get("last_name", "") or "").strip()
    full_name = " ".join(part for part in (first_name, last_name) if part).strip()
    if full_name:
        return full_name
    for field_name in ("username",):
        raw_value = clerk_user.get(field_name)
        if isinstance(raw_value, str) and raw_value.strip():
            return raw_value.strip()
    return _extract_clerk_email(clerk_user)


def _normalize_clerk_timestamp(value: Any) -> str | None:
    if isinstance(value, (int, float)):
        timestamp_value = float(value)
        if timestamp_value > 10_000_000_000:
            timestamp_value /= 1000
        try:
            return datetime.fromtimestamp(timestamp_value, UTC).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _extract_clerk_last_active_at(clerk_user: dict[str, Any]) -> str | None:
    for field_name in ("last_active_at", "last_sign_in_at", "updated_at", "created_at"):
        normalized = _normalize_clerk_timestamp(clerk_user.get(field_name))
        if normalized:
            return normalized
    return None


def _normalize_role(value: Any) -> AppRole:
    if isinstance(value, AppRole):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        for role in AppRole:
            if role.value == normalized:
                return role
    return DEFAULT_ROLE


def _normalize_limit_value(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    parsed_value = round(float(value), 2)
    if parsed_value <= 0:
        return None
    return parsed_value


def _normalize_feature_overrides(raw_overrides: Any) -> dict[AppFeature, bool]:
    if not isinstance(raw_overrides, dict):
        return {}
    normalized: dict[AppFeature, bool] = {}
    for raw_feature_name, raw_enabled in raw_overrides.items():
        if not isinstance(raw_feature_name, str) or not isinstance(raw_enabled, bool):
            continue
        try:
            feature = AppFeature(raw_feature_name.strip())
        except ValueError:
            continue
        normalized[feature] = raw_enabled
    return normalized


def _normalize_usage_limits(raw_limits: Any) -> dict[str, float | None]:
    if not isinstance(raw_limits, dict):
        return {"daily_limit_usd": None, "monthly_limit_usd": None}
    return {
        "daily_limit_usd": _normalize_limit_value(raw_limits.get("daily_limit_usd")),
        "monthly_limit_usd": _normalize_limit_value(raw_limits.get("monthly_limit_usd")),
    }


def _fetch_clerk_user_sync(user_id: str) -> dict[str, Any] | None:
    cache_key = _access_cache_key(user_id)
    cached_payload = api_cache.get(cache_key)
    if isinstance(cached_payload, dict):
        return cached_payload

    secret = _get_clerk_secret_key(required=False)
    if not secret:
        return None

    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            f"{CLERK_API_BASE_URL}/users/{user_id}",
            headers={"Authorization": f"Bearer {secret}"},
        )

    if response.status_code == status.HTTP_404_NOT_FOUND:
        return None
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to load user access data from Clerk.",
        )

    payload = response.json()
    if isinstance(payload, dict):
        api_cache.set(cache_key, payload, ACCESS_CACHE_TTL_SECONDS)
        return payload
    return None


def _patch_clerk_public_metadata_sync(user_id: str, public_metadata_updates: dict[str, Any]) -> dict[str, Any]:
    secret = _get_clerk_secret_key(required=True)
    current_user = _fetch_clerk_user_sync(user_id)
    current_metadata = current_user.get("public_metadata") if isinstance(current_user, dict) else {}
    if not isinstance(current_metadata, dict):
        current_metadata = {}

    next_metadata = dict(current_metadata)
    for key, value in public_metadata_updates.items():
        if isinstance(value, dict) and isinstance(current_metadata.get(key), dict):
            next_metadata[key] = {**current_metadata[key], **value}
        else:
            next_metadata[key] = value

    with httpx.Client(timeout=10.0) as client:
        response = client.patch(
            f"{CLERK_API_BASE_URL}/users/{user_id}/metadata",
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            json={"public_metadata": next_metadata},
        )

    if response.status_code >= 400:
        detail = response.text.strip() or "Unable to update Clerk metadata."
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)

    payload = response.json()
    api_cache.invalidate(_access_cache_key(user_id))
    api_cache.invalidate_prefix("usage::users")
    if isinstance(payload, dict):
        return payload
    return current_user or {}


def list_clerk_users_sync(limit: int = 100) -> list[dict[str, Any]]:
    cached_users = api_cache.get(CLERK_USERS_CACHE_KEY)
    if isinstance(cached_users, list):
        return [user for user in cached_users if isinstance(user, dict)]

    secret = _get_clerk_secret_key(required=True)
    all_users: list[dict[str, Any]] = []
    offset = 0

    with httpx.Client(timeout=15.0) as client:
        while True:
            response = client.get(
                f"{CLERK_API_BASE_URL}/users",
                headers={"Authorization": f"Bearer {secret}"},
                params={"limit": min(limit, 100), "offset": offset},
            )
            if response.status_code >= 400:
                detail = response.text.strip() or "Unable to list users from Clerk."
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
            payload = response.json()
            if not isinstance(payload, list) or not payload:
                break
            all_users.extend([item for item in payload if isinstance(item, dict)])
            if len(payload) < min(limit, 100):
                break
            offset += len(payload)
    api_cache.set(CLERK_USERS_CACHE_KEY, all_users, ACCESS_CACHE_TTL_SECONDS)
    return all_users


def delete_clerk_user_sync(user_id: str) -> None:
    secret = _get_clerk_secret_key(required=True)
    with httpx.Client(timeout=10.0) as client:
        response = client.delete(
            f"{CLERK_API_BASE_URL}/users/{user_id}",
            headers={"Authorization": f"Bearer {secret}"},
        )
    if response.status_code >= 400:
        detail = response.text.strip() or "Unable to remove user from Clerk."
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
    api_cache.invalidate(_access_cache_key(user_id))
    api_cache.invalidate(CLERK_USERS_CACHE_KEY)
    api_cache.invalidate(f"access::member-usage::{user_id}")
    api_cache.invalidate_prefix("usage::users")


def create_clerk_invitation_sync(email: str, role: AppRole) -> dict[str, Any]:
    secret = _get_clerk_secret_key(required=True)
    normalized_email = _normalize_email(email)
    if not normalized_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid email is required.")

    with httpx.Client(timeout=10.0) as client:
        response = client.post(
            f"{CLERK_API_BASE_URL}/invitations",
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            json={
                "email_address": normalized_email,
                "public_metadata": {"role": role.value},
            },
        )

    if response.status_code >= 400:
        detail = response.text.strip() or "Unable to create Clerk invitation."
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)

    payload = response.json()
    api_cache.invalidate(CLERK_USERS_CACHE_KEY)
    api_cache.invalidate_prefix("usage::users")
    if isinstance(payload, dict):
        return payload
    return {"email_address": normalized_email, "status": "pending"}


def _resolve_seeded_owner(user_id: str, email: str | None) -> bool:
    if user_id in _get_seeded_owner_ids():
        return True
    normalized_email = _normalize_email(email)
    return normalized_email in _get_seeded_owner_emails() if normalized_email else False


def _resolve_limit_value(override: float | None, profile: dict[str, Any] | None, limit_type: str) -> float:
    if override is not None:
        return override
    if limit_type == "daily":
        return resolve_daily_limit(profile)
    return resolve_monthly_limit(profile)


def _build_access_context_from_sources(user_id: str, claims: dict[str, Any], clerk_user: dict[str, Any] | None) -> AccessContext:
    public_metadata = clerk_user.get("public_metadata") if isinstance(clerk_user, dict) else claims.get("public_metadata") or claims.get("metadata")
    if not isinstance(public_metadata, dict):
        public_metadata = {}

    email = _extract_clerk_email(clerk_user or {}) or _extract_claims_email(claims)
    display_name = _extract_clerk_display_name(clerk_user or {}) or _extract_claims_display_name(claims) or email or user_id
    seeded_owner = _resolve_seeded_owner(user_id, email)
    role = AppRole.OWNER if seeded_owner else _normalize_role(public_metadata.get("role"))
    feature_overrides = _normalize_feature_overrides(public_metadata.get("feature_overrides"))
    usage_limits = _normalize_usage_limits(public_metadata.get("usage_limits"))
    return AccessContext(
        user_id=user_id,
        email=email,
        display_name=display_name,
        role=role,
        feature_overrides=feature_overrides,
        usage_limits=usage_limits,
        seeded_owner=seeded_owner,
    )


def resolve_access_context_from_claims(claims: dict[str, Any], initialize_defaults: bool = True) -> AccessContext:
    user_id = str(claims.get("sub", "") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject claim.")

    clerk_user = _fetch_clerk_user_sync(user_id)
    access_context = _build_access_context_from_sources(user_id, claims, clerk_user)

    public_metadata = clerk_user.get("public_metadata") if isinstance(clerk_user, dict) else claims.get("public_metadata") or claims.get("metadata")
    if initialize_defaults and isinstance(public_metadata, dict) and "role" not in public_metadata and not access_context.seeded_owner:
        _patch_clerk_public_metadata_sync(user_id, {"role": DEFAULT_ROLE.value})
        clerk_user = _fetch_clerk_user_sync(user_id)
        access_context = _build_access_context_from_sources(user_id, claims, clerk_user)

    return access_context


def get_access_context(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> AccessContext:
    cached_context = getattr(request.state, "access_context", None)
    if isinstance(cached_context, AccessContext):
        return cached_context

    token = extract_bearer_token(authorization)
    claims = verify_clerk_token(token)
    request.state.clerk_claims = claims
    access_context = resolve_access_context_from_claims(claims)
    try:
        from app.platform.members import sync_workspace_member

        sync_workspace_member(access_context)
    except Exception:
        # Keep the existing app usable even when the optional platform control plane is unavailable.
        pass
    request.state.access_context = access_context
    return access_context


def require_owner(access_context: AccessContext = Depends(get_access_context)) -> AccessContext:
    if access_context.is_owner():
        return access_context
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This action requires owner access.",
    )


def require_feature(feature: AppFeature):
    def _dependency(access_context: AccessContext = Depends(get_access_context)) -> AccessContext:
        if access_context.has_feature(feature):
            return access_context
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Your current access does not allow '{feature.value}'.",
        )

    return _dependency


def resolve_limits_for_user(user_id: str, display_name: str | None = None) -> dict[str, float]:
    profile = load_profile(user_id, display_name)
    access_context = resolve_access_context_from_claims({"sub": user_id}, initialize_defaults=False)
    return access_context.get_effective_limits(profile)


def get_effective_access_payload(access_context: AccessContext, profile: dict[str, Any] | None = None) -> dict[str, Any]:
    effective_features = sorted(feature.value for feature in AppFeature if access_context.has_feature(feature))
    limits = access_context.get_effective_limits(profile)
    return {
        "role": access_context.role.value,
        "role_label": ROLE_LABELS[access_context.role],
        "is_owner": access_context.is_owner(),
        "feature_overrides": {feature.value: enabled for feature, enabled in access_context.feature_overrides.items()},
        "effective_features": effective_features,
        "usage_limits": limits,
        "email": access_context.email,
        "display_name": access_context.display_name,
        "seeded_owner": access_context.seeded_owner,
    }


def build_member_profile(clerk_user: dict[str, Any], include_usage: bool = False) -> MemberAccessProfile:
    claims = {"sub": str(clerk_user.get("id", "") or "")}
    access_context = _build_access_context_from_sources(claims["sub"], claims, clerk_user)
    profile = load_profile(access_context.user_id, access_context.display_name)
    usage_limits = access_context.get_effective_limits(profile)
    usage = None
    if include_usage:
        from app.services.cost_tracker import get_usage_status, get_usage_summary

        status_payload = get_usage_status(
            access_context.user_id,
            usage_limits["daily_limit_usd"],
            usage_limits["monthly_limit_usd"],
            "chat",
            access_context.display_name,
        )
        summary_payload = get_usage_summary(access_context.user_id, 30, access_context.display_name)
        usage = MemberUsageSummary(
            daily_spent_usd=float(status_payload["daily"]["spent_usd"]),
            monthly_spent_usd=float(status_payload["monthly"]["spent_usd"]),
            total_cost_usd=float(summary_payload["total_cost_usd"]),
            total_input_tokens=int(summary_payload["total_input_tokens"]),
            total_output_tokens=int(summary_payload["total_output_tokens"]),
        )

    return MemberAccessProfile(
        user_id=access_context.user_id,
        display_name=access_context.display_name or access_context.user_id,
        email=access_context.email,
        last_active_at=_extract_clerk_last_active_at(clerk_user),
        role=access_context.role,
        role_label=ROLE_LABELS[access_context.role],
        feature_overrides={feature.value: enabled for feature, enabled in access_context.feature_overrides.items()},
        effective_features=sorted(feature.value for feature in AppFeature if access_context.has_feature(feature)),
        usage_limits=usage_limits,
        usage=usage,
        seeded_owner=access_context.seeded_owner,
    )


def get_member_usage_summary(user_id: str) -> MemberUsageSummary:
    cache_key = f"access::member-usage::{user_id}"
    cached_summary = api_cache.get(cache_key)
    if isinstance(cached_summary, MemberUsageSummary):
        return cached_summary

    target_user = _fetch_clerk_user_sync(user_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    member_profile = build_member_profile(target_user, include_usage=True)
    if member_profile.usage is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to load member usage.")
    api_cache.set(cache_key, member_profile.usage, ACCESS_CACHE_TTL_SECONDS)
    return member_profile.usage


def update_member_role(user_id: str, role: AppRole) -> MemberAccessProfile:
    updated_user = _patch_clerk_public_metadata_sync(user_id, {"role": role.value})
    api_cache.invalidate(CLERK_USERS_CACHE_KEY)
    api_cache.invalidate(f"access::member-usage::{user_id}")
    return build_member_profile(updated_user, include_usage=False)


def update_member_features(user_id: str, feature_overrides: dict[AppFeature, bool]) -> MemberAccessProfile:
    updated_user = _patch_clerk_public_metadata_sync(
        user_id,
        {
            "feature_overrides": {feature.value: enabled for feature, enabled in feature_overrides.items()},
        },
    )
    api_cache.invalidate(CLERK_USERS_CACHE_KEY)
    api_cache.invalidate(f"access::member-usage::{user_id}")
    return build_member_profile(updated_user, include_usage=False)


def update_member_usage_limits(
    user_id: str,
    limits: dict[str, float | None],
    display_name: str | None = None,
) -> MemberAccessProfile:
    normalized_limits = {
        "daily_limit_usd": _normalize_limit_value(limits.get("daily_limit_usd")),
        "monthly_limit_usd": _normalize_limit_value(limits.get("monthly_limit_usd")),
    }
    updated_user = _patch_clerk_public_metadata_sync(user_id, {"usage_limits": {key: value for key, value in normalized_limits.items() if value is not None}})
    save_profile(user_id, {key: value for key, value in normalized_limits.items() if value is not None}, display_name)
    api_cache.invalidate(CLERK_USERS_CACHE_KEY)
    api_cache.invalidate(f"access::member-usage::{user_id}")
    return build_member_profile(updated_user, include_usage=False)


def list_member_profiles(include_usage: bool = True) -> list[MemberAccessProfile]:
    users = list_clerk_users_sync()
    members = [build_member_profile(user, include_usage=include_usage) for user in users]
    return sorted(members, key=lambda member: ((0 if member.role == AppRole.OWNER else 1), member.display_name.lower()))


def remove_member(user_id: str) -> None:
    delete_clerk_user_sync(user_id)
