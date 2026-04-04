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


def validate_agent_plan_request(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize POST /api/agent/plan payload."""
    session_id = payload.get("session_id", "")
    if not isinstance(session_id, str) or not (1 <= len(session_id) <= 128):
        raise HTTPException(status_code=422, detail="session_id must be a non-empty string (max 128).")

    goal = payload.get("goal", "")
    if not isinstance(goal, str) or not (1 <= len(goal) <= 12000):
        raise HTTPException(status_code=422, detail="goal must be a non-empty string (max 12000).")

    session_mode = payload.get("session_mode")
    if session_mode is not None and (not isinstance(session_mode, str) or len(session_mode.strip()) > 64):
        raise HTTPException(status_code=422, detail="session_mode must be a string (max 64).")

    project_id = payload.get("project_id")
    if project_id is not None and (not isinstance(project_id, str) or not (1 <= len(project_id.strip()) <= 128)):
        raise HTTPException(status_code=422, detail="project_id must be a non-empty string (max 128).")

    recent_context = payload.get("recent_context", [])
    if recent_context is None:
        recent_context = []
    if not isinstance(recent_context, list):
        raise HTTPException(status_code=422, detail="recent_context must be an array.")
    if len(recent_context) > 12:
        raise HTTPException(status_code=422, detail="recent_context must contain 12 items or fewer.")

    normalized_context: list[dict[str, str]] = []
    for item in recent_context:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="recent_context entries must be objects.")
        role = item.get("role", "")
        if role is not None and not isinstance(role, str):
            raise HTTPException(status_code=422, detail="recent_context.role must be a string.")
        content = item.get("content", "")
        if content is not None and not isinstance(content, str):
            raise HTTPException(status_code=422, detail="recent_context.content must be a string.")
        summary = item.get("summary", "")
        if summary is not None and not isinstance(summary, str):
            raise HTTPException(status_code=422, detail="recent_context.summary must be a string.")
        source = item.get("source", "")
        if source is not None and not isinstance(source, str):
            raise HTTPException(status_code=422, detail="recent_context.source must be a string.")
        normalized_context.append(
            {
                "role": (role or "").strip(),
                "content": (content or "").strip(),
                "summary": (summary or "").strip(),
                "source": (source or "").strip(),
            }
        )

    return {
        "session_id": session_id,
        "goal": goal,
        "session_mode": session_mode.strip() if isinstance(session_mode, str) and session_mode.strip() else None,
        "project_id": project_id.strip() if isinstance(project_id, str) and project_id.strip() else None,
        "recent_context": normalized_context,
    }


def validate_agent_run_request(payload: dict[str, Any]) -> dict[str, str]:
    """Validate and normalize POST /api/agent/run/{plan_id} payload."""
    session_id = payload.get("session_id", "")
    if not isinstance(session_id, str) or not (1 <= len(session_id) <= 128):
        raise HTTPException(status_code=422, detail="session_id must be a non-empty string (max 128).")
    return {"session_id": session_id}


def validate_agent_confirm_request(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize POST /api/agent/confirm/{plan_id} payload."""
    session_id = payload.get("session_id", "")
    if not isinstance(session_id, str) or not (1 <= len(session_id) <= 128):
        raise HTTPException(status_code=422, detail="session_id must be a non-empty string (max 128).")

    step_number = payload.get("step_number")
    if isinstance(step_number, bool) or not isinstance(step_number, int) or step_number <= 0:
        raise HTTPException(status_code=422, detail="step_number must be a positive integer.")

    approved = payload.get("approved")
    if not isinstance(approved, bool):
        raise HTTPException(status_code=422, detail="approved must be boolean true/false.")

    return {
        "session_id": session_id,
        "step_number": step_number,
        "approved": approved,
    }


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
    normalized_limits: dict[str, float] = {}
    for field_name in ("daily_limit_usd", "monthly_limit_usd"):
        if field_name not in payload:
            continue
        raw_limit = payload.get(field_name)
        if isinstance(raw_limit, bool) or not isinstance(raw_limit, (int, float)):
            raise HTTPException(status_code=400, detail=f"{field_name} must be a number greater than zero.")

        parsed_limit = float(raw_limit)
        if parsed_limit <= 0:
            raise HTTPException(status_code=400, detail=f"{field_name} must be greater than zero.")

        normalized_limits[field_name] = round(parsed_limit, 2)

    if not normalized_limits:
        raise HTTPException(status_code=400, detail="daily_limit_usd or monthly_limit_usd is required.")

    return normalized_limits


def validate_project_memory_update_request(payload: dict[str, Any]) -> dict[str, str]:
    """Validate and normalize PATCH /api/projects/{project_id}/memory payload."""
    key = payload.get("key", "")
    if not isinstance(key, str) or not key.strip():
        raise HTTPException(status_code=400, detail="key must be a non-empty string.")

    value = payload.get("value", "")
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=400, detail="value must be a non-empty string.")

    return {"key": key.strip(), "value": value.strip()}


def validate_project_chat_title_request(payload: dict[str, Any]) -> dict[str, str]:
    """Validate and normalize PATCH /api/projects/{project_id}/chats/{session_id} payload."""
    title = payload.get("title", "")
    if not isinstance(title, str) or not title.strip():
        raise HTTPException(status_code=400, detail="title must be a non-empty string.")

    normalized_title = title.strip()
    if len(normalized_title) > 80:
        raise HTTPException(status_code=400, detail="title must be 80 characters or fewer.")

    return {"title": normalized_title}


def build_health_response(timestamp: str, version: str) -> dict[str, str]:
    return {"status": "ok", "timestamp": timestamp, "version": version}


def build_chat_json_response(
    request_id: str,
    reply: str,
    model: ChatModel,
    response_ms: int,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    total_tokens: int | None = None,
    context_window_tokens: int | None = None,
    context_percentage_used: float | None = None,
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
    if input_tokens is not None:
        payload["input_tokens"] = input_tokens
    if output_tokens is not None:
        payload["output_tokens"] = output_tokens
    if total_tokens is not None:
        payload["total_tokens"] = total_tokens
    if context_window_tokens is not None:
        payload["context_window_tokens"] = context_window_tokens
    if context_percentage_used is not None:
        payload["context_percentage_used"] = context_percentage_used
    return payload
