from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.access import (
    AppFeature,
    AppRole,
    ROLE_LABELS,
    AccessContext,
    build_member_profile,
    list_member_profiles,
    remove_member,
    require_owner,
    update_member_features,
    update_member_role,
    update_member_usage_limits,
    _fetch_clerk_user_sync,
)

router = APIRouter(prefix="/api/members", tags=["members"])


class MemberRoleUpdate(BaseModel):
    role: AppRole


class MemberFeatureUpdate(BaseModel):
    feature_overrides: dict[AppFeature, bool] = Field(default_factory=dict)


class MemberUsageLimitUpdate(BaseModel):
    daily_limit_usd: float | None = Field(default=None, gt=0)
    monthly_limit_usd: float | None = Field(default=None, gt=0)

    def to_payload(self) -> dict[str, float | None]:
        return {
            "daily_limit_usd": self.daily_limit_usd,
            "monthly_limit_usd": self.monthly_limit_usd,
        }


def _get_target_member(target_user_id: str) -> dict[str, Any]:
    target_user = _fetch_clerk_user_sync(target_user_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return target_user


@router.get("")
def get_members(_ctx: AccessContext = Depends(require_owner)) -> dict[str, Any]:
    return {"members": [member.model_dump(mode="json") for member in list_member_profiles(include_usage=True)]}


@router.patch("/{target_user_id}/role")
def patch_member_role(
    target_user_id: str,
    body: MemberRoleUpdate,
    ctx: AccessContext = Depends(require_owner),
) -> dict[str, Any]:
    if target_user_id == ctx.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot change your own role.")
    target_user = _get_target_member(target_user_id)
    target_profile = build_member_profile(target_user)
    if target_profile.seeded_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Seeded owners are managed through OWNER_EMAILS or OWNER_USER_IDS.")
    updated_member = update_member_role(target_user_id, body.role)
    return updated_member.model_dump(mode="json")


@router.patch("/{target_user_id}/features")
def patch_member_features(
    target_user_id: str,
    body: MemberFeatureUpdate,
    ctx: AccessContext = Depends(require_owner),
) -> dict[str, Any]:
    if target_user_id == ctx.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot change your own feature overrides.")
    target_user = _get_target_member(target_user_id)
    target_profile = build_member_profile(target_user)
    if target_profile.seeded_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Seeded owners are managed through OWNER_EMAILS or OWNER_USER_IDS.")
    updated_member = update_member_features(target_user_id, body.feature_overrides)
    return updated_member.model_dump(mode="json")


@router.patch("/{target_user_id}/usage-limit")
def patch_member_usage_limit(
    target_user_id: str,
    body: MemberUsageLimitUpdate,
    ctx: AccessContext = Depends(require_owner),
) -> dict[str, Any]:
    payload = body.to_payload()
    if payload["daily_limit_usd"] is None and payload["monthly_limit_usd"] is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="daily_limit_usd or monthly_limit_usd is required.")
    target_user = _get_target_member(target_user_id)
    updated_member = update_member_usage_limits(target_user_id, payload, build_member_profile(target_user).display_name)
    return updated_member.model_dump(mode="json")


@router.delete("/{target_user_id}")
def delete_member(
    target_user_id: str,
    ctx: AccessContext = Depends(require_owner),
) -> dict[str, str]:
    if target_user_id == ctx.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot remove your own account.")
    target_user = _get_target_member(target_user_id)
    target_profile = build_member_profile(target_user)
    if target_profile.seeded_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Seeded owners are managed through OWNER_EMAILS or OWNER_USER_IDS.")
    remove_member(target_user_id)
    return {"removed": target_user_id}
