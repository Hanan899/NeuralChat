"""Clerk webhook handlers for user lifecycle events."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from svix.webhooks import Webhook, WebhookVerificationError

LOGGER = logging.getLogger(__name__)

webhooks_router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def verify_clerk_webhook(
    request: Request,
    svix_id: str | None = Header(default=None, alias="svix-id"),
    svix_timestamp: str | None = Header(default=None, alias="svix-timestamp"),
    svix_signature: str | None = Header(default=None, alias="svix-signature"),
) -> dict[str, Any]:
    webhook_secret = os.environ.get("CLERK_WEBHOOK_SECRET", "").strip()
    if not webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLERK_WEBHOOK_SECRET is required for Clerk webhook verification.",
        )

    if not svix_id or not svix_timestamp or not svix_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing Clerk webhook signature headers.",
        )

    payload = await request.body()
    headers = {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
    }

    try:
        verified_payload = Webhook(webhook_secret).verify(payload, headers)
    except WebhookVerificationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Clerk webhook signature.",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to verify Clerk webhook payload.",
        ) from error

    if isinstance(verified_payload, bytes):
        try:
            verified_payload = json.loads(verified_payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Webhook payload is not valid JSON.",
            ) from error

    if not isinstance(verified_payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Webhook payload must be a JSON object.",
        )

    return verified_payload


async def _clerk_assign_default_role(user_id: str, role: str = "member") -> None:
    clerk_secret_key = os.environ.get("CLERK_SECRET_KEY", "").strip()
    if not clerk_secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLERK_SECRET_KEY is required for Clerk metadata updates.",
        )

    clerk_url = f"https://api.clerk.com/v1/users/{user_id}/metadata"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.patch(
            clerk_url,
            headers={
                "Authorization": f"Bearer {clerk_secret_key}",
                "Content-Type": "application/json",
            },
            json={"public_metadata": {"role": role}},
        )

    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to update Clerk user metadata from webhook.",
        )


@webhooks_router.post("/clerk")
async def handle_clerk_webhook(
    payload: dict[str, Any] = Depends(verify_clerk_webhook),
) -> dict[str, bool]:
    event_type = str(payload.get("type", "")).strip()
    event_data = payload.get("data", {})

    if event_type == "user.created" and isinstance(event_data, dict):
        user_id = str(event_data.get("id", "")).strip()
        if user_id:
            await _clerk_assign_default_role(user_id, "member")
            LOGGER.info("Assigned default role 'member' to user %s", user_id)
    elif event_type == "user.updated":
        LOGGER.info("Received Clerk user.updated webhook event.")
        # TODO: sync role changes if Clerk becomes the source of truth for workspace roles.

    return {"received": True}
