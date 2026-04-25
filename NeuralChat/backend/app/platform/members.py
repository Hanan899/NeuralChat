from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import AccessContext

from .config import platform_is_configured
from .db import get_platform_session_factory
from .models import WorkspaceMember


def sync_workspace_member(access_context: AccessContext) -> None:
    if not platform_is_configured():
        return
    session_factory = get_platform_session_factory()
    with session_factory() as session:
        existing = session.execute(
            select(WorkspaceMember).where(WorkspaceMember.user_id == access_context.user_id)
        ).scalar_one_or_none()
        if existing is None:
            existing = WorkspaceMember(
                user_id=access_context.user_id,
                email=access_context.email,
                display_name=access_context.display_name,
                role=access_context.role.value,
                feature_overrides={feature.value: enabled for feature, enabled in access_context.feature_overrides.items()},
                usage_limits=access_context.usage_limits,
                seeded_owner=access_context.seeded_owner,
            )
            session.add(existing)
        else:
            existing.email = access_context.email
            existing.display_name = access_context.display_name
            existing.role = access_context.role.value
            existing.feature_overrides = {feature.value: enabled for feature, enabled in access_context.feature_overrides.items()}
            existing.usage_limits = access_context.usage_limits
            existing.seeded_owner = access_context.seeded_owner
        session.commit()
