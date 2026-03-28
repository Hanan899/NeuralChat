"""Member management routes for workspace RBAC administration."""

from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.rbac import (
    AuthContext,
    Permission,
    ROLE_HIERARCHY,
    ROLE_LABELS,
    Role,
    get_auth_context,
    require_permission,
    require_role,
)

members_router = APIRouter(prefix="/members", tags=["members"])


class MemberRoleUpdate(BaseModel):
    role: Role


class MemberResponse(BaseModel):
    user_id: str
    display_name: str | None = None
    email: str | None = None
    role: Role
    role_label: str


async def _clerk_update_metadata(user_id: str, role: Role) -> None:
    clerk_secret_key = os.environ.get("CLERK_SECRET_KEY", "").strip()
    if not clerk_secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLERK_SECRET_KEY is required for member role updates.",
        )

    clerk_url = f"https://api.clerk.com/v1/users/{user_id}/metadata"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.patch(
            clerk_url,
            headers={
                "Authorization": f"Bearer {clerk_secret_key}",
                "Content-Type": "application/json",
            },
            json={"public_metadata": {"role": role.value}},
        )

    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to update Clerk user metadata.",
        )


@members_router.get("/")
async def list_members(
    _: AuthContext = Depends(require_role(Role.OWNER)),
) -> dict[str, str]:
    # TODO: paginate members from the Clerk Backend API (/v1/users).
    return {"message": "fetch from Clerk /v1/users"}


@members_router.patch("/{target_user_id}/role", response_model=MemberResponse)
async def update_member_role(
    target_user_id: str,
    body: MemberRoleUpdate,
    ctx: AuthContext = Depends(require_permission(Permission.MEMBER_MANAGE)),
) -> MemberResponse:
    if target_user_id == ctx.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )

    if ROLE_HIERARCHY[body.role] >= ROLE_HIERARCHY[ctx.role]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"You cannot assign the '{ROLE_LABELS[body.role]}' role. "
                f"You may only assign roles below your own ('{ROLE_LABELS[ctx.role]}')."
            ),
        )

    await _clerk_update_metadata(target_user_id, body.role)
    return MemberResponse(
        user_id=target_user_id,
        display_name=None,
        email=None,
        role=body.role,
        role_label=ROLE_LABELS[body.role],
    )


@members_router.delete("/{target_user_id}")
async def remove_member(
    target_user_id: str,
    ctx: AuthContext = Depends(require_role(Role.OWNER)),
) -> dict[str, str]:
    if target_user_id == ctx.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove yourself",
        )

    # TODO: call Clerk DELETE /v1/users/{id} or revoke the user's active sessions.
    return {"removed": target_user_id}


@members_router.post("/invite")
async def invite_member(
    email: str = Query(...),
    role: Role = Query(Role.MEMBER),
    ctx: AuthContext = Depends(require_role(Role.OWNER)),
) -> dict[str, str]:
    if ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[ctx.role]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"You cannot assign the '{ROLE_LABELS[role]}' role. "
                f"You may only assign roles below your own ('{ROLE_LABELS[ctx.role]}')."
            ),
        )

    # TODO: call Clerk POST /v1/invitations with public_metadata={"role": role.value}.
    return {"invited": email, "role": role.value, "role_label": ROLE_LABELS[role]}
