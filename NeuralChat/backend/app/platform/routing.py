from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.platform.config import get_platform_settings, platform_is_configured
from app.platform.models import AgentDefinition, AgentVersion, DocumentCollection, RoutingPolicy
from app.platform.providers import build_messages, chat_with_model


@dataclass
class RouteDecision:
    target_kind: str
    target_id: str | None
    confidence: float
    reason: str

    def to_payload(self) -> dict[str, Any]:
        return {
            "target_kind": self.target_kind,
            "target_id": self.target_id,
            "confidence": round(self.confidence, 3),
            "reason": self.reason,
        }


def _default_threshold(session: Session | None) -> float:
    if session is None or not platform_is_configured():
        return get_platform_settings().route_confidence_threshold
    policy = session.execute(
        select(RoutingPolicy).where(RoutingPolicy.enabled.is_(True)).order_by(RoutingPolicy.created_at.desc())
    ).scalar_one_or_none()
    if policy is None:
        return get_platform_settings().route_confidence_threshold
    return float(policy.confidence_threshold)


def deterministic_route(payload: dict[str, Any], session: Session | None = None) -> RouteDecision | None:
    collection_id = str(payload.get("collection_id") or "").strip()
    if collection_id:
        return RouteDecision("documents", collection_id, 1.0, "Explicit collection_id was supplied.")

    dynamic_agent_id = str(payload.get("dynamic_agent_id") or "").strip()
    if dynamic_agent_id:
        return RouteDecision("dynamic_agent", dynamic_agent_id, 1.0, "Explicit dynamic_agent_id was supplied.")

    if session is not None and platform_is_configured():
        published_agents = session.execute(
            select(AgentDefinition).where(AgentDefinition.status == "published")
        ).scalars().all()
        if not published_agents:
            return RouteDecision("general", None, 1.0, "No published dynamic agents are available.")
    return None


async def classify_route(payload: dict[str, Any], session: Session | None = None) -> RouteDecision:
    direct_match = deterministic_route(payload, session)
    if direct_match is not None:
        return direct_match
    if session is None or not platform_is_configured():
        return RouteDecision("general", None, 0.0, "Platform routing is not configured.")

    collections = session.execute(select(DocumentCollection).order_by(DocumentCollection.name.asc())).scalars().all()
    agents = session.execute(select(AgentDefinition).where(AgentDefinition.status == "published").order_by(AgentDefinition.name.asc())).scalars().all()
    if not collections and not agents:
        return RouteDecision("general", None, 1.0, "No collections or published dynamic agents are configured.")

    collection_options = [{"id": item.id, "name": item.name, "slug": item.slug} for item in collections]
    agent_options = [{"id": item.id, "name": item.name, "slug": item.slug} for item in agents]
    prompt = (
        "Route the user request to one target. Reply with JSON only in this shape: "
        '{"target_kind":"general|documents|dynamic_agent","target_id":"string|null","confidence":0.0,"reason":"text"}.\n'
        f"Collections: {json.dumps(collection_options, ensure_ascii=True)}\n"
        f"Agents: {json.dumps(agent_options, ensure_ascii=True)}\n"
        f"User request: {payload.get('message') or payload.get('goal') or ''}"
    )
    try:
        text, _usage, _runtime = await chat_with_model(
            session,
            None,
            [{"role": "system", "content": "Return strict JSON only."}, {"role": "user", "content": prompt}],
            timeout_seconds=15.0,
        )
        parsed = json.loads(text)
        decision = RouteDecision(
            target_kind=str(parsed.get("target_kind") or "general").strip() or "general",
            target_id=(str(parsed.get("target_id")).strip() or None) if parsed.get("target_id") not in (None, "", "null") else None,
            confidence=float(parsed.get("confidence", 0.0) or 0.0),
            reason=str(parsed.get("reason") or "LLM classifier response."),
        )
    except Exception:
        return RouteDecision("general", None, 0.0, "Route classifier failed; using general chat fallback.")

    threshold = _default_threshold(session)
    if decision.confidence < threshold or decision.target_kind not in {"general", "documents", "dynamic_agent"}:
        return RouteDecision("general", None, decision.confidence, f"Confidence below threshold ({threshold:.2f}); using general chat.")
    return decision
