"""Backend request/response validation helpers (function-based, no classes)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import HTTPException

ChatModel = Literal["gpt-5"]


def validate_chat_request(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize POST /api/chat payload."""
    session_id = payload.get("session_id", "")
    if not isinstance(session_id, str) or not (1 <= len(session_id) <= 128):
        raise HTTPException(status_code=422, detail="session_id must be a non-empty string (max 128).")

    message = payload.get("message", "")
    if not isinstance(message, str) or not (1 <= len(message) <= 12000):
        raise HTTPException(status_code=422, detail="message must be a non-empty string (max 12000).")

    model = payload.get("model", "gpt-5")
    if model != "gpt-5":
        raise HTTPException(status_code=422, detail="model must be 'gpt-5'.")

    stream = payload.get("stream", True)
    if not isinstance(stream, bool):
        raise HTTPException(status_code=422, detail="stream must be boolean true/false.")

    force_search = payload.get("force_search", False)
    if not isinstance(force_search, bool):
        raise HTTPException(status_code=422, detail="force_search must be boolean true/false.")

    return {
        "session_id": session_id,
        "message": message,
        "model": model,
        "stream": stream,
        "force_search": force_search,
    }


def build_health_response(timestamp: str, version: str) -> dict[str, str]:
    return {"status": "ok", "timestamp": timestamp, "version": version}


def build_chat_json_response(
    request_id: str,
    reply: str,
    model: ChatModel,
    response_ms: int,
    search_used: bool = False,
    file_context_used: bool = False,
    sources: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "request_id": request_id,
        "reply": reply,
        "model": model,
        "response_ms": response_ms,
        "search_used": search_used,
        "file_context_used": file_context_used,
        "sources": sources or [],
    }
    return payload
