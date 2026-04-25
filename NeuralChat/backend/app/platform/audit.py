from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import AuditEvent


def record_audit_event(
    session: Session,
    *,
    actor_user_id: str | None,
    event_type: str,
    target_type: str,
    target_id: str | None,
    payload: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditEvent(
            actor_user_id=actor_user_id,
            event_type=event_type,
            target_type=target_type,
            target_id=target_id,
            payload_json=payload or {},
        )
    )
