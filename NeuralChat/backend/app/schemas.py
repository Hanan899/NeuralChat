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

    project_id = payload.get("project_id")
    if project_id is not None:
        if not isinstance(project_id, str) or not (1 <= len(project_id.strip()) <= 128):
            raise HTTPException(status_code=422, detail="project_id must be a non-empty string (max 128).")
        project_id = project_id.strip()

    return {
        "session_id": session_id,
        "message": message,
        "model": model,
        "stream": stream,
        "force_search": force_search,
        "project_id": project_id,
    }


def validate_agent_plan_request(payload: dict[str, Any]) -> dict[str, str]:
    """Validate and normalize POST /api/agent/plan payload."""
    session_id = payload.get("session_id", "")
    if not isinstance(session_id, str) or not (1 <= len(session_id) <= 128):
        raise HTTPException(status_code=422, detail="session_id must be a non-empty string (max 128).")

    goal = payload.get("goal", "")
    if not isinstance(goal, str) or not (1 <= len(goal) <= 12000):
        raise HTTPException(status_code=422, detail="goal must be a non-empty string (max 12000).")

    return {"session_id": session_id, "goal": goal}


def validate_agent_run_request(payload: dict[str, Any]) -> dict[str, str]:
    """Validate and normalize POST /api/agent/run/{plan_id} payload."""
    session_id = payload.get("session_id", "")
    if not isinstance(session_id, str) or not (1 <= len(session_id) <= 128):
        raise HTTPException(status_code=422, detail="session_id must be a non-empty string (max 128).")
    return {"session_id": session_id}


def validate_title_request(payload: dict[str, Any]) -> dict[str, str]:
    """Validate and normalize POST /api/conversations/title payload."""
    prompt = payload.get("prompt", "")
    if not isinstance(prompt, str) or not (1 <= len(prompt) <= 12000):
        raise HTTPException(status_code=422, detail="prompt must be a non-empty string (max 12000).")

    reply = payload.get("reply", "")
    if not isinstance(reply, str):
        raise HTTPException(status_code=422, detail="reply must be a string.")

    return {
        "prompt": prompt,
        "reply": reply,
    }


def validate_usage_limit_request(payload: dict[str, Any]) -> dict[str, float]:
    """Validate and normalize PATCH /api/usage/limit payload."""
    raw_limit = payload.get("daily_limit_usd")
    if isinstance(raw_limit, bool) or not isinstance(raw_limit, (int, float)):
        raise HTTPException(status_code=400, detail="daily_limit_usd must be a number greater than zero.")

    daily_limit_usd = float(raw_limit)
    if daily_limit_usd <= 0:
        raise HTTPException(status_code=400, detail="daily_limit_usd must be greater than zero.")

    return {"daily_limit_usd": round(daily_limit_usd, 2)}


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
