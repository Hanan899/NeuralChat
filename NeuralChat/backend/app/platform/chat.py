from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.platform.documents import search_document_chunks
from app.platform.models import AgentDefinition, AgentVersion, Document
from app.platform.providers import embed_texts
from app.platform.routing import RouteDecision, classify_route


async def build_collection_context_prompt(
    session: Session,
    collection_ids: list[str],
    query: str,
) -> tuple[str, list[dict[str, Any]]]:
    citations: list[dict[str, Any]] = []
    rendered_chunks: list[str] = []
    embeddings, _usage, _runtime = await embed_texts(session, [query])
    if not embeddings:
        return "", []
    query_embedding = embeddings[0]
    for collection_id in collection_ids[:3]:
        for item in search_document_chunks(session, collection_id=collection_id, query_embedding=query_embedding, limit=4):
            document = session.get(Document, item["document_id"])
            if document is None:
                continue
            citations.append(
                {
                    "document_id": document.id,
                    "filename": document.filename,
                    "chunk_id": item["chunk_id"],
                    "collection_id": item["collection_id"],
                    "score": round(float(item["score"]), 4),
                }
            )
            rendered_chunks.append(
                f"[{document.filename} chunk {item['chunk_index']} score={item['score']:.3f}] {item['content']}"
            )
    if not rendered_chunks:
        return "", citations
    return "Use this collection context when it is relevant.\n\n" + "\n\n".join(rendered_chunks), citations


async def resolve_chat_route_context(
    session: Session,
    payload: dict[str, Any],
) -> dict[str, Any]:
    decision = await classify_route(payload, session)
    route_memory_prompt = ""
    route_file_prompt = ""
    resolved_agent_id: str | None = None
    resolved_model = str(payload.get("model") or "").strip() or None
    sources: list[dict[str, Any]] = []

    if decision.target_kind == "documents" and decision.target_id:
        route_file_prompt, sources = await build_collection_context_prompt(session, [decision.target_id], str(payload.get("message", "")))
    elif decision.target_kind == "dynamic_agent" and decision.target_id:
        agent = session.get(AgentDefinition, decision.target_id)
        version_id = agent.published_version_id if agent else None
        version = session.get(AgentVersion, version_id) if version_id else None
        if agent and version:
            resolved_agent_id = agent.id
            route_memory_prompt = version.system_prompt
            resolved_model = version.model_id or resolved_model
            if version.collection_ids:
                route_file_prompt, sources = await build_collection_context_prompt(session, version.collection_ids, str(payload.get("message", "")))

    return {
        "decision": decision,
        "memory_prompt": route_memory_prompt,
        "file_prompt": route_file_prompt,
        "resolved_agent_id": resolved_agent_id,
        "resolved_model": resolved_model,
        "sources": sources,
    }
