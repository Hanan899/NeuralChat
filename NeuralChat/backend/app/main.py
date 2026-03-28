"""FastAPI surface for NeuralChat backend.

Explain this code:
- `/api/health` proves backend is alive.
- `/api/chat` validates input, enforces auth, and returns NDJSON token stream.
- `/api/agent/*` adds plan-first autonomous execution with streaming progress.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from app.auth import require_user_id
from app.env_loader import load_local_settings_env
from app.rbac import AuthContext, Permission, require_permission
from app.routers.members import members_router
from app.schemas import (
    build_chat_json_response,
    build_health_response,
    validate_agent_plan_request,
    validate_project_chat_title_request,
    validate_agent_run_request,
    validate_chat_request,
    validate_project_memory_update_request,
    validate_title_request,
    validate_usage_limit_request,
)
from app.services.agent import (
    AGENT_TIMEOUT_SECONDS,
    AVAILABLE_AGENT_TOOLS,
    create_task_plan,
    create_task_plan_with_usage,
    delete_session_agent_artifacts,
    list_task_plans,
    load_execution_log,
    load_task_plan,
    save_execution_log,
    save_task_plan,
    stream_agent_execution,
)
from app.services.cache import api_cache
from app.services.chat_service import (
    generate_reply,
    generate_reply_stream,
    generate_reply_stream_with_usage,
    generate_reply_with_usage,
    save_assistant_message,
    save_user_message,
    stream_tokens,
    tokenize_text,
)
from app.services.cost_tracker import (
    check_daily_limit,
    current_utc_date_text,
    get_daily_usage,
    get_usage_status,
    get_usage_summary,
    log_usage,
    resolve_daily_limit,
    resolve_monthly_limit,
)
from app.services.file_handler import (
    chunk_text,
    delete_session_files,
    delete_user_file,
    get_relevant_chunks,
    list_user_files,
    load_parsed_chunks,
    parse_file,
    save_parsed_chunks,
    upload_raw_file,
    validate_file,
)
from app.services.memory import build_memory_prompt, clear_profile, load_profile, process_memory_update, save_profile, upsert_profile_key
from app.services.projects import (
    append_project_chat_message,
    build_project_system_prompt,
    clear_project_memory,
    create_project,
    create_project_chat,
    delete_all_project_files,
    delete_project,
    delete_project_chat,
    delete_project_file,
    get_all_projects,
    get_brain_log,
    get_memory_completeness,
    get_project,
    get_project_chats,
    get_project_file_context_chunks,
    get_template_memory_keys,
    get_project_templates,
    list_project_files,
    load_project_chat_messages,
    load_project_memory,
    extract_project_facts_with_usage,
    log_brain_extraction,
    process_project_upload,
    save_project_memory,
    update_project_chat_title,
    update_project,
)
from app.services.search import cache_search_results, format_search_context, load_cached_results, search_web
from app.services.storage import delete_conversation_session, init_store
from app.services.titles import generate_conversation_title, generate_conversation_title_with_usage

APP_VERSION = "0.3.0"
BASE_DIR = Path(__file__).resolve().parents[1]
LOGGER = logging.getLogger(__name__)
READ_CACHE_TTL_SECONDS = 300
HOT_CACHE_TTL_SECONDS = 30

load_local_settings_env(BASE_DIR)
STORE = init_store()

app = FastAPI(title="NeuralChat Backend", version=APP_VERSION)

raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173,neuralchat-adgueyh0gucffsbp.eastus-01.azurewebsites.net")
allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(members_router)


def get_request_naming(
    user_display_name: str | None = Header(default=None, alias="X-User-Display-Name"),
    session_title: str | None = Header(default=None, alias="X-Session-Title"),
) -> dict[str, str | None]:
    normalized_display_name = user_display_name.strip() if isinstance(user_display_name, str) else None
    normalized_session_title = session_title.strip() if isinstance(session_title, str) else None
    return {
        "display_name": normalized_display_name or None,
        "session_title": normalized_session_title or None,
    }


def _visible_project_memory_payload(project: dict[str, Any], memory: dict[str, Any]) -> dict[str, str]:
    visible_memory: dict[str, str] = {}
    for memory_key in get_template_memory_keys(str(project.get("template", "custom"))):
        raw_value = memory.get(memory_key)
        if raw_value in (None, ""):
            continue
        text_value = str(raw_value).strip()
        if text_value:
            visible_memory[memory_key] = text_value
    return visible_memory


def _cache_key(*parts: object) -> str:
    normalized_parts = [str(part).strip() for part in parts]
    return "::".join(normalized_parts)


def _cached_json_response(cache_key: str, payload: object, ttl_seconds: int) -> JSONResponse:
    api_cache.set(cache_key, payload, ttl_seconds)
    return JSONResponse(payload, headers={"X-Cache": "MISS"})


def _read_cached_json_response(cache_key: str) -> JSONResponse | None:
    cached_payload = api_cache.get(cache_key)
    if cached_payload is None:
        return None
    return JSONResponse(cached_payload, headers={"X-Cache": "HIT"})


def _invalidate_cache_prefixes(*prefixes: str) -> None:
    for prefix in prefixes:
        api_cache.invalidate_prefix(prefix)


def _build_usage_limits_payload(profile: dict[str, Any] | None) -> dict[str, float]:
    return {
        "daily_limit_usd": resolve_daily_limit(profile),
        "monthly_limit_usd": resolve_monthly_limit(profile),
    }


def _get_usage_status_for_feature(
    user_id: str,
    feature: str,
    display_name: str | None = None,
) -> dict[str, Any]:
    profile = load_profile(user_id, display_name)
    limits_payload = _build_usage_limits_payload(profile)
    return get_usage_status(
        user_id,
        limits_payload["daily_limit_usd"],
        limits_payload["monthly_limit_usd"],
        feature,
        display_name,
    )


def _enforce_usage_limit_for_feature(
    user_id: str,
    feature: str,
    display_name: str | None = None,
) -> dict[str, Any]:
    usage_status = _get_usage_status_for_feature(user_id, feature, display_name)
    if usage_status["blocked"]:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=usage_status["blocking_message"])
    return usage_status


async def run_project_brain(
    user_id: str,
    project_id: str,
    session_id: str,
    user_message: str,
    assistant_reply: str,
    template: str,
    display_name: str | None = None,
) -> None:
    try:
        usage_status = await asyncio.to_thread(_get_usage_status_for_feature, user_id, "memory", display_name)
        if usage_status["blocked"]:
            return
        existing_memory = await asyncio.to_thread(load_project_memory, user_id, project_id, display_name)
        extracted_facts, usage = await asyncio.to_thread(
            extract_project_facts_with_usage,
            user_message,
            assistant_reply,
            template,
            existing_memory,
        )
        if usage["input_tokens"] or usage["output_tokens"]:
            await asyncio.to_thread(log_usage, user_id, "memory", usage["input_tokens"], usage["output_tokens"], display_name)
        if not extracted_facts:
            return
        await asyncio.to_thread(save_project_memory, user_id, project_id, extracted_facts, display_name)
        await asyncio.to_thread(
            log_brain_extraction,
            user_id,
            project_id,
            session_id,
            extracted_facts,
            usage["input_tokens"] + usage["output_tokens"],
            display_name,
        )
        await asyncio.to_thread(
            _invalidate_cache_prefixes,
            _cache_key("projects", user_id, display_name or "", project_id, "memory"),
            _cache_key("projects", user_id, display_name or "", project_id, "brain-log"),
            _cache_key("usage", user_id, display_name or ""),
        )
    except Exception:
        LOGGER.exception("Project Brain update failed for user=%s project=%s session=%s", user_id, project_id, session_id)


@app.get("/api/health")
def get_health() -> dict[str, str]:
    cache_key = _cache_key("public", "health")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    return _cached_json_response(
        cache_key,
        build_health_response(timestamp=datetime.now(UTC).isoformat(), version=APP_VERSION),
        HOT_CACHE_TTL_SECONDS,
    )


@app.get("/api/keep-warm")
def get_keep_warm() -> dict[str, Any]:
    return {"status": "warm", "timestamp": int(time.time() * 1000)}


@app.get("/api/search/status")
def get_search_status() -> dict[str, bool]:
    cache_key = _cache_key("public", "search-status")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    return _cached_json_response(
        cache_key,
        {"search_enabled": bool(os.getenv("TAVILY_API_KEY", "").strip())},
        READ_CACHE_TTL_SECONDS,
    )


@app.get("/api/projects/templates")
def get_project_templates_endpoint() -> dict[str, Any]:
    cache_key = _cache_key("public", "project-templates")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    return _cached_json_response(cache_key, get_project_templates(), READ_CACHE_TTL_SECONDS)


@app.get("/api/projects")
async def get_projects_endpoint(
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, list[dict[str, Any]]]:
    cache_key = _cache_key("projects", user_id, naming["display_name"] or "", "index")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    try:
        projects = await asyncio.to_thread(get_all_projects, user_id, naming["display_name"])
    except Exception as project_error:
        LOGGER.exception("Project list load failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to load projects: {project_error}",
        ) from project_error
    return _cached_json_response(cache_key, {"projects": projects}, READ_CACHE_TTL_SECONDS)


@app.post("/api/projects")
async def post_project(
    payload: dict[str, Any] = Body(...),
    auth_context: AuthContext = Depends(require_permission(Permission.PROJECT_CREATE)),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    user_id = auth_context.user_id
    project_name = payload.get("name", "")
    template = payload.get("template", "")
    if not isinstance(project_name, str) or not project_name.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name is required.")
    if not isinstance(template, str) or not template.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="template is required.")

    try:
        project = await asyncio.to_thread(
            create_project,
            user_id,
            project_name,
            template,
            payload.get("description", ""),
            payload.get("emoji", ""),
            payload.get("color", ""),
            payload.get("custom_system_prompt", ""),
            naming["display_name"],
        )
    except ValueError as validation_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(validation_error)) from validation_error
    except Exception as project_error:
        LOGGER.exception("Project creation failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to create project: {project_error}",
        ) from project_error
    _invalidate_cache_prefixes(_cache_key("projects", user_id))
    return project


@app.get("/api/projects/{project_id}")
async def get_project_endpoint(
    project_id: str,
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    cache_key = _cache_key("projects", user_id, naming["display_name"] or "", project_id, "meta")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return _cached_json_response(cache_key, project, READ_CACHE_TTL_SECONDS)


@app.get("/api/projects/{project_id}/memory")
async def get_project_memory_endpoint(
    project_id: str,
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    cache_key = _cache_key("projects", user_id, naming["display_name"] or "", project_id, "memory")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    memory = await asyncio.to_thread(load_project_memory, user_id, project_id, naming["display_name"])
    visible_memory = _visible_project_memory_payload(project, memory)
    completeness = await asyncio.to_thread(get_memory_completeness, memory, str(project.get("template", "custom")))
    return _cached_json_response(
        cache_key,
        {"memory": visible_memory, "completeness": completeness},
        READ_CACHE_TTL_SECONDS,
    )


@app.patch("/api/projects/{project_id}/memory")
async def patch_project_memory_endpoint(
    project_id: str,
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    normalized_payload = validate_project_memory_update_request(payload)
    allowed_memory_keys = get_template_memory_keys(str(project.get("template", "custom")))
    if normalized_payload["key"] not in allowed_memory_keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="key must match one of this project's template memory fields.")

    await asyncio.to_thread(
        save_project_memory,
        user_id,
        project_id,
        {normalized_payload["key"]: normalized_payload["value"]},
        naming["display_name"],
    )
    updated_memory = await asyncio.to_thread(load_project_memory, user_id, project_id, naming["display_name"])
    _invalidate_cache_prefixes(
        _cache_key("projects", user_id, naming["display_name"] or "", project_id, "memory"),
        _cache_key("projects", user_id, naming["display_name"] or "", project_id, "brain-log"),
    )
    return {
        "message": "Memory updated",
        "memory": _visible_project_memory_payload(project, updated_memory),
    }


@app.delete("/api/projects/{project_id}/memory")
async def delete_project_memory_endpoint(
    project_id: str,
    auth_context: AuthContext = Depends(require_permission(Permission.PROJECT_DELETE)),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    user_id = auth_context.user_id
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    await asyncio.to_thread(clear_project_memory, user_id, project_id, naming["display_name"])
    _invalidate_cache_prefixes(
        _cache_key("projects", user_id, naming["display_name"] or "", project_id, "memory"),
        _cache_key("projects", user_id, naming["display_name"] or "", project_id, "brain-log"),
    )
    return {"message": "Project Brain reset"}


@app.get("/api/projects/{project_id}/brain-log")
async def get_project_brain_log_endpoint(
    project_id: str,
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, list[dict[str, Any]]]:
    cache_key = _cache_key("projects", user_id, naming["display_name"] or "", project_id, "brain-log")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    brain_log = await asyncio.to_thread(get_brain_log, user_id, project_id, naming["display_name"])
    return _cached_json_response(cache_key, {"log": brain_log[-20:][::-1]}, HOT_CACHE_TTL_SECONDS)


@app.patch("/api/projects/{project_id}")
async def patch_project(
    project_id: str,
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    try:
        project = await asyncio.to_thread(update_project, user_id, project_id, payload, naming["display_name"])
    except ValueError as validation_error:
        status_code = status.HTTP_404_NOT_FOUND if "not found" in str(validation_error).lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=str(validation_error)) from validation_error
    except Exception as project_error:
        LOGGER.exception("Project update failed for user=%s project=%s", user_id, project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to update project: {project_error}",
        ) from project_error
    _invalidate_cache_prefixes(
        _cache_key("projects", user_id),
    )
    return project


@app.delete("/api/projects/{project_id}")
async def delete_project_endpoint(
    project_id: str,
    auth_context: AuthContext = Depends(require_permission(Permission.PROJECT_DELETE)),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    user_id = auth_context.user_id
    try:
        await asyncio.to_thread(delete_project, user_id, project_id, naming["display_name"])
    except ValueError as validation_error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(validation_error)) from validation_error
    except Exception as project_error:
        LOGGER.exception("Project delete failed for user=%s project=%s", user_id, project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to delete project: {project_error}",
        ) from project_error
    _invalidate_cache_prefixes(_cache_key("projects", user_id))
    return {"message": "Project deleted"}


@app.get("/api/projects/{project_id}/chats")
async def get_project_chats_endpoint(
    project_id: str,
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, list[dict[str, Any]]]:
    cache_key = _cache_key("projects", user_id, naming["display_name"] or "", project_id, "chats")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    chats = await asyncio.to_thread(get_project_chats, user_id, project_id, naming["display_name"])
    return _cached_json_response(cache_key, {"chats": chats}, HOT_CACHE_TTL_SECONDS)


@app.get("/api/projects/{project_id}/chats/{session_id}")
async def get_project_chat_endpoint(
    project_id: str,
    session_id: str,
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, list[dict[str, Any]]]:
    cache_key = _cache_key("projects", user_id, naming["display_name"] or "", project_id, "chat", session_id)
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    messages = await asyncio.to_thread(
        load_project_chat_messages,
        user_id,
        project_id,
        session_id,
        naming["display_name"],
        naming["session_title"],
    )
    return _cached_json_response(cache_key, {"messages": messages}, HOT_CACHE_TTL_SECONDS)


@app.post("/api/projects/{project_id}/chats")
async def post_project_chat(
    project_id: str,
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    try:
        session_id = await asyncio.to_thread(create_project_chat, user_id, project_id, naming["display_name"])
    except ValueError as validation_error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(validation_error)) from validation_error
    except Exception as project_error:
        LOGGER.exception("Project chat creation failed for user=%s project=%s", user_id, project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to create project chat: {project_error}",
        ) from project_error
    _invalidate_cache_prefixes(_cache_key("projects", user_id, naming["display_name"] or "", project_id, "chats"))
    return {"session_id": session_id}


@app.patch("/api/projects/{project_id}/chats/{session_id}")
async def patch_project_chat_title_endpoint(
    project_id: str,
    session_id: str,
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    request = validate_project_chat_title_request(payload)
    try:
        title = await asyncio.to_thread(
            update_project_chat_title,
            user_id,
            project_id,
            session_id,
            request["title"],
            naming["display_name"],
        )
    except ValueError as validation_error:
        status_code = status.HTTP_404_NOT_FOUND if "not found" in str(validation_error).lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=str(validation_error)) from validation_error
    _invalidate_cache_prefixes(
        _cache_key("projects", user_id, naming["display_name"] or "", project_id, "chats"),
        _cache_key("projects", user_id, naming["display_name"] or "", project_id, "chat", session_id),
    )
    return {"message": "Project chat title updated", "title": title}


@app.delete("/api/projects/{project_id}/chats/{session_id}")
async def delete_project_chat_endpoint(
    project_id: str,
    session_id: str,
    auth_context: AuthContext = Depends(require_permission(Permission.PROJECT_DELETE)),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    user_id = auth_context.user_id
    project = await asyncio.to_thread(get_project, user_id, project_id, naming["display_name"])
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    try:
        deleted = await asyncio.to_thread(delete_project_chat, user_id, project_id, session_id, naming["display_name"])
        agent_delete_counts = await asyncio.to_thread(delete_session_agent_artifacts, user_id, session_id)
    except Exception as delete_error:
        LOGGER.exception("Project chat delete failed for user=%s project=%s session=%s", user_id, project_id, session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to delete project chat: {delete_error}",
        ) from delete_error
    _invalidate_cache_prefixes(
        _cache_key("projects", user_id, naming["display_name"] or "", project_id, "chats"),
        _cache_key("projects", user_id, naming["display_name"] or "", project_id, "chat", session_id),
    )
    return {"message": "Project chat deleted successfully", "conversation_deleted": deleted, **agent_delete_counts}


@app.post("/api/conversations/title")
async def post_conversation_title(
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    await asyncio.to_thread(_enforce_usage_limit_for_feature, user_id, "title_generation", naming["display_name"])
    request = validate_title_request(payload)
    title, usage = await asyncio.to_thread(generate_conversation_title_with_usage, request["prompt"], request["reply"])
    if usage["input_tokens"] or usage["output_tokens"]:
        asyncio.create_task(
            asyncio.to_thread(
                log_usage,
                user_id,
                "title_generation",
                usage["input_tokens"],
                usage["output_tokens"],
                naming["display_name"],
            )
        )
    _invalidate_cache_prefixes(_cache_key("usage", user_id, naming["display_name"] or ""))
    return {"title": title}


@app.get("/api/me")
def get_me(
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    cache_key = _cache_key("profile", user_id, naming["display_name"] or "", "me")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    profile = load_profile(user_id=user_id, display_name=naming["display_name"])
    return _cached_json_response(cache_key, {
        "user_id": user_id,
        "profile": profile,
    }, READ_CACHE_TTL_SECONDS)


@app.get("/api/usage/summary")
async def get_usage_summary_endpoint(
    days: int = Query(30, ge=1, le=365),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    cache_key = _cache_key("usage", user_id, naming["display_name"] or "", "summary", days)
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    try:
        summary = await asyncio.to_thread(get_usage_summary, user_id, days, naming["display_name"])
    except Exception as usage_error:
        LOGGER.exception("Usage summary load failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to load usage summary: {usage_error}",
        ) from usage_error
    return _cached_json_response(cache_key, summary, HOT_CACHE_TTL_SECONDS)


@app.get("/api/usage/today")
async def get_usage_today(
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    cache_key = _cache_key("usage", user_id, naming["display_name"] or "", "today")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    try:
        profile = await asyncio.to_thread(load_profile, user_id, naming["display_name"])
        limits_payload = _build_usage_limits_payload(profile)
        today_records = await asyncio.to_thread(get_daily_usage, user_id, current_utc_date_text(), naming["display_name"])
        today_summary = await asyncio.to_thread(check_daily_limit, user_id, limits_payload["daily_limit_usd"], naming["display_name"])
    except Exception as usage_error:
        LOGGER.exception("Today's usage load failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to load today's usage: {usage_error}",
        ) from usage_error

    return _cached_json_response(cache_key, {"records": today_records, "summary": today_summary}, HOT_CACHE_TTL_SECONDS)


@app.get("/api/usage/status")
async def get_usage_status_endpoint(
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    cache_key = _cache_key("usage", user_id, naming["display_name"] or "", "status")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    try:
        usage_status = await asyncio.to_thread(_get_usage_status_for_feature, user_id, "chat", naming["display_name"])
    except Exception as usage_error:
        LOGGER.exception("Usage status load failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to load usage status: {usage_error}",
        ) from usage_error
    return _cached_json_response(cache_key, usage_status, HOT_CACHE_TTL_SECONDS)


@app.get("/api/usage/limit")
async def get_usage_limit(
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, float]:
    cache_key = _cache_key("usage", user_id, naming["display_name"] or "", "limit")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    profile = await asyncio.to_thread(load_profile, user_id, naming["display_name"])
    return _cached_json_response(cache_key, _build_usage_limits_payload(profile), READ_CACHE_TTL_SECONDS)


@app.patch("/api/usage/limit")
async def patch_usage_limit(
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    request = validate_usage_limit_request(payload)
    try:
        await asyncio.to_thread(
            save_profile,
            user_id,
            request,
            naming["display_name"],
        )
    except Exception as usage_error:
        LOGGER.exception("Usage limit update failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to update usage limits: {usage_error}",
        ) from usage_error

    updated_profile = await asyncio.to_thread(load_profile, user_id, naming["display_name"])
    limits_payload = _build_usage_limits_payload(updated_profile)
    updated_fields = sorted(request.keys())
    if updated_fields == ["daily_limit_usd"]:
        message = f"Daily limit updated to ${request['daily_limit_usd']:.2f}"
    elif updated_fields == ["monthly_limit_usd"]:
        message = f"Monthly limit updated to ${request['monthly_limit_usd']:.2f}"
    else:
        message = "Usage limits updated"
    _invalidate_cache_prefixes(
        _cache_key("usage", user_id, naming["display_name"] or ""),
        _cache_key("profile", user_id, naming["display_name"] or "", "me"),
    )

    return {
        "message": message,
        **limits_payload,
    }


@app.patch("/api/me/memory")
def patch_memory(
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    key = payload.get("key", "")
    value = payload.get("value", "")

    if not isinstance(key, str) or not key.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="key must be a non-empty string.")
    if not isinstance(value, str):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="value must be a string.")

    clean_key = key.strip()
    if value.strip():
        save_profile(user_id=user_id, facts={clean_key: value}, display_name=naming["display_name"])
    else:
        upsert_profile_key(user_id=user_id, key=clean_key, value=value, display_name=naming["display_name"])
    updated_profile = load_profile(user_id=user_id, display_name=naming["display_name"])
    _invalidate_cache_prefixes(
        _cache_key("profile", user_id, naming["display_name"] or ""),
        _cache_key("usage", user_id, naming["display_name"] or ""),
    )
    return {"user_id": user_id, "profile": updated_profile}


@app.delete("/api/me/memory")
def delete_memory(
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    clear_profile(user_id=user_id, display_name=naming["display_name"])
    _invalidate_cache_prefixes(
        _cache_key("profile", user_id, naming["display_name"] or ""),
        _cache_key("usage", user_id, naming["display_name"] or ""),
    )
    return {"message": "Memory cleared"}


@app.post("/api/upload")
async def post_upload(
    session_id: str | None = Form(default=None),
    project_id: str | None = Form(default=None),
    file: UploadFile = File(...),
    auth_context: AuthContext = Depends(require_permission(Permission.FILE_UPLOAD)),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    user_id = auth_context.user_id
    clean_session_id = session_id.strip() if isinstance(session_id, str) and session_id.strip() else None
    clean_project_id = project_id.strip() if isinstance(project_id, str) and project_id.strip() else None
    if not clean_session_id and not clean_project_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="session_id or project_id is required.")

    filename = file.filename or ""
    file_bytes = await file.read()
    file_size_bytes = len(file_bytes)

    try:
        validate_file(filename=filename, file_size_bytes=file_size_bytes)
    except ValueError as validation_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(validation_error)) from validation_error

    try:
        if clean_project_id:
            upload_result = await asyncio.to_thread(
                process_project_upload,
                user_id,
                clean_project_id,
                filename,
                file_bytes,
                naming["display_name"],
            )
        else:
            blob_path = await asyncio.to_thread(
                upload_raw_file,
                user_id,
                clean_session_id,
                filename,
                file_bytes,
                naming["display_name"],
                naming["session_title"],
            )
            existing_chunks = await asyncio.to_thread(
                load_parsed_chunks,
                user_id,
                clean_session_id,
                filename,
                naming["display_name"],
                naming["session_title"],
            )
            if existing_chunks is not None:
                chunk_count = len(existing_chunks)
            else:
                parsed_text = await asyncio.to_thread(parse_file, filename, file_bytes)
                parsed_chunks = await asyncio.to_thread(chunk_text, parsed_text)
                await asyncio.to_thread(
                    save_parsed_chunks,
                    user_id,
                    clean_session_id,
                    filename,
                    parsed_chunks,
                    naming["display_name"],
                    naming["session_title"],
                )
                chunk_count = len(parsed_chunks)
            upload_result = {
                "filename": Path(filename).name,
                "blob_path": blob_path,
                "chunk_count": chunk_count,
                "message": "File uploaded successfully",
            }
    except HTTPException:
        raise
    except ValueError as validation_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(validation_error)) from validation_error
    except Exception as upload_error:
        LOGGER.exception("File upload failed for user=%s session=%s project=%s file=%s", user_id, clean_session_id, clean_project_id, filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"File upload failed: {upload_error}",
        ) from upload_error
    if clean_project_id:
        _invalidate_cache_prefixes(
            _cache_key("projects", user_id, naming["display_name"] or "", clean_project_id, "files"),
            _cache_key("projects", user_id, naming["display_name"] or "", clean_project_id, "meta"),
        )
    else:
        _invalidate_cache_prefixes(
            _cache_key("files", user_id, naming["display_name"] or "", clean_session_id or ""),
        )
    return upload_result


@app.get("/api/files")
async def get_files(
    session_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, list[dict[str, str]]]:
    clean_session_id = session_id.strip() if isinstance(session_id, str) and session_id.strip() else None
    clean_project_id = project_id.strip() if isinstance(project_id, str) and project_id.strip() else None
    if not clean_session_id and not clean_project_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="session_id or project_id is required.")
    cache_key = _cache_key(
        "projects" if clean_project_id else "files",
        user_id,
        naming["display_name"] or "",
        clean_project_id or clean_session_id or "",
        "files",
    )
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response

    try:
        if clean_project_id:
            files = await asyncio.to_thread(list_project_files, user_id, clean_project_id, naming["display_name"])
        else:
            files = await asyncio.to_thread(list_user_files, user_id, clean_session_id, naming["display_name"], naming["session_title"])
    except Exception as list_error:
        LOGGER.exception("File list failed for user=%s session=%s project=%s", user_id, clean_session_id, clean_project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to list files: {list_error}",
        ) from list_error
    return _cached_json_response(cache_key, {"files": files}, HOT_CACHE_TTL_SECONDS)


@app.delete("/api/files/{filename}")
async def delete_file(
    filename: str,
    session_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    clean_session_id = session_id.strip() if isinstance(session_id, str) and session_id.strip() else None
    clean_project_id = project_id.strip() if isinstance(project_id, str) and project_id.strip() else None
    if not clean_session_id and not clean_project_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="session_id or project_id is required.")

    try:
        if clean_project_id:
            await asyncio.to_thread(delete_project_file, user_id, clean_project_id, filename, naming["display_name"])
        else:
            await asyncio.to_thread(delete_user_file, user_id, clean_session_id, filename, naming["display_name"], naming["session_title"])
    except ValueError as not_found_error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(not_found_error)) from not_found_error
    except Exception as delete_error:
        LOGGER.exception("File delete failed for user=%s session=%s project=%s file=%s", user_id, clean_session_id, clean_project_id, filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to delete file: {delete_error}",
        ) from delete_error
    if clean_project_id:
        _invalidate_cache_prefixes(_cache_key("projects", user_id, naming["display_name"] or "", clean_project_id, "files"))
    else:
        _invalidate_cache_prefixes(_cache_key("files", user_id, naming["display_name"] or "", clean_session_id or ""))

    safe_filename = Path(filename).name
    return {"message": f"{safe_filename} deleted successfully"}


@app.delete("/api/conversations/{session_id}")
async def delete_conversation(
    session_id: str,
    project_id: str | None = Query(default=None),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    if not isinstance(session_id, str) or not session_id.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="session_id is required.")
    clean_project_id = project_id.strip() if isinstance(project_id, str) and project_id.strip() else None

    try:
        if clean_project_id:
            conversation_deleted = await asyncio.to_thread(delete_project_chat, user_id, clean_project_id, session_id, naming["display_name"])
            file_delete_counts = {"uploads_deleted": 0, "parsed_deleted": 0}
        else:
            conversation_deleted = await asyncio.to_thread(
                delete_conversation_session,
                STORE,
                user_id,
                session_id,
                naming["display_name"],
                naming["session_title"],
            )
            file_delete_counts = await asyncio.to_thread(
                delete_session_files,
                user_id,
                session_id,
                naming["display_name"],
                naming["session_title"],
            )
        agent_delete_counts = await asyncio.to_thread(
            delete_session_agent_artifacts,
            user_id,
            session_id,
        )
    except Exception as delete_error:
        LOGGER.exception("Session delete failed for user=%s session=%s project=%s", user_id, session_id, clean_project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to delete conversation session: {delete_error}",
        ) from delete_error
    if clean_project_id:
        _invalidate_cache_prefixes(
            _cache_key("projects", user_id, naming["display_name"] or "", clean_project_id, "chats"),
            _cache_key("projects", user_id, naming["display_name"] or "", clean_project_id, "chat", session_id),
        )
    else:
        _invalidate_cache_prefixes(_cache_key("files", user_id, naming["display_name"] or "", session_id))

    return {
        "message": "Conversation deleted successfully",
        "conversation_deleted": conversation_deleted,
        **file_delete_counts,
        **agent_delete_counts,
    }


@app.post("/api/agent/plan")
async def post_agent_plan(
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    await asyncio.to_thread(_enforce_usage_limit_for_feature, user_id, "agent_plan", naming["display_name"])
    request = validate_agent_plan_request(payload)

    try:
        plan, usage = await create_task_plan_with_usage(request["goal"], AVAILABLE_AGENT_TOOLS)
        save_task_plan(
            user_id,
            plan,
            naming["display_name"],
            request["session_id"],
            naming["session_title"],
        )
        if usage["input_tokens"] or usage["output_tokens"]:
            asyncio.create_task(
                asyncio.to_thread(
                    log_usage,
                    user_id,
                    "agent_plan",
                    usage["input_tokens"],
                    usage["output_tokens"],
                    naming["display_name"],
                )
            )
    except Exception as plan_error:
        LOGGER.exception("Agent plan creation failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to create agent plan: {plan_error}",
        ) from plan_error
    _invalidate_cache_prefixes(
        _cache_key("agent", user_id, "history"),
        _cache_key("usage", user_id, naming["display_name"] or ""),
    )
    return {"plan": plan}


@app.post("/api/agent/run/{plan_id}")
async def post_agent_run(
    plan_id: str,
    payload: dict[str, Any] = Body(...),
    auth_context: AuthContext = Depends(require_permission(Permission.AGENT_RUN)),
    naming: dict[str, str | None] = Depends(get_request_naming),
):
    user_id = auth_context.user_id
    await asyncio.to_thread(_enforce_usage_limit_for_feature, user_id, "agent_step", naming["display_name"])
    _invalidate_cache_prefixes(
        _cache_key("agent", user_id, "history"),
        _cache_key("usage", user_id, naming["display_name"] or ""),
    )
    request = validate_agent_run_request(payload)
    plan = await asyncio.to_thread(
        load_task_plan,
        user_id,
        plan_id,
        naming["display_name"],
        request["session_id"],
        naming["session_title"],
    )
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent plan not found.")

    async def stream() -> AsyncIterator[str]:
        execution_log: list[dict[str, Any]] = []
        warning_message: str | None = None

        yield json.dumps({"type": "plan", "plan": plan}, ensure_ascii=True) + "\n"

        try:
            async with asyncio.timeout(AGENT_TIMEOUT_SECONDS):
                async for event in stream_agent_execution(
                    plan,
                    user_id,
                    request["session_id"],
                    naming["display_name"],
                    naming["session_title"],
                ):
                    event_type = str(event.get("type", "")).strip()
                    if event_type == "final_state":
                        execution_log = list(event.get("execution_log", []))
                        warning_message = event.get("warning_message") if isinstance(event.get("warning_message"), str) else warning_message
                        await asyncio.to_thread(
                            save_execution_log,
                            user_id,
                            plan_id,
                            execution_log,
                            naming["display_name"],
                            request["session_id"],
                            naming["session_title"],
                        )
                        summary_text = str(event.get("summary", "")).strip()
                        summary_usage = event.get("summary_usage", {"input_tokens": 0, "output_tokens": 0})
                        if isinstance(summary_usage, dict):
                            summary_input_tokens = int(summary_usage.get("input_tokens", 0) or 0)
                            summary_output_tokens = int(summary_usage.get("output_tokens", 0) or 0)
                            if summary_input_tokens or summary_output_tokens:
                                asyncio.create_task(
                                    asyncio.to_thread(
                                        log_usage,
                                        user_id,
                                        "agent_summary",
                                        summary_input_tokens,
                                        summary_output_tokens,
                                        naming["display_name"],
                                    )
                                )
                        for token in tokenize_text(summary_text):
                            yield json.dumps({"type": "summary", "content": token}, ensure_ascii=True) + "\n"
                        yield (
                            json.dumps(
                                {
                                    "type": "done",
                                    "plan_id": plan_id,
                                    "steps_completed": len(execution_log),
                                    "warning": warning_message,
                                },
                                ensure_ascii=True,
                            )
                            + "\n"
                        )
                        return

                    if event_type == "step_done":
                        step_usage = event.get("usage", {"input_tokens": 0, "output_tokens": 0})
                        if isinstance(step_usage, dict):
                            step_input_tokens = int(step_usage.get("input_tokens", 0) or 0)
                            step_output_tokens = int(step_usage.get("output_tokens", 0) or 0)
                            if step_input_tokens or step_output_tokens:
                                asyncio.create_task(
                                    asyncio.to_thread(
                                        log_usage,
                                        user_id,
                                        "agent_step",
                                        step_input_tokens,
                                        step_output_tokens,
                                        naming["display_name"],
                                    )
                                )
                        execution_log.append(
                            {
                                "step_number": event.get("step_number"),
                                "description": next(
                                    (
                                        step.get("description")
                                        for step in plan.get("steps", [])
                                        if step.get("step_number") == event.get("step_number")
                                    ),
                                    "",
                                ),
                                "tool": next(
                                    (
                                        step.get("tool")
                                        for step in plan.get("steps", [])
                                        if step.get("step_number") == event.get("step_number")
                                    ),
                                    None,
                                ),
                                "tool_input": next(
                                    (
                                        step.get("tool_input")
                                        for step in plan.get("steps", [])
                                        if step.get("step_number") == event.get("step_number")
                                    ),
                                    None,
                                ),
                                "result": event.get("result", ""),
                                "status": event.get("status", "failed"),
                                "error": event.get("error"),
                            }
                        )

                    if event_type == "warning":
                        warning_message = str(event.get("message", "")).strip() or warning_message

                    yield json.dumps(event, ensure_ascii=True) + "\n"
        except TimeoutError:
            warning_message = f"Agent timed out after {int(AGENT_TIMEOUT_SECONDS)} seconds."
            await asyncio.to_thread(
                save_execution_log,
                user_id,
                plan_id,
                execution_log,
                naming["display_name"],
                request["session_id"],
                naming["session_title"],
            )
            yield json.dumps({"type": "warning", "message": warning_message}, ensure_ascii=True) + "\n"
            yield json.dumps({"type": "summary", "content": warning_message}, ensure_ascii=True) + "\n"
            yield json.dumps({"type": "done", "plan_id": plan_id, "steps_completed": len(execution_log)}, ensure_ascii=True) + "\n"
        except Exception as agent_error:
            await asyncio.to_thread(
                save_execution_log,
                user_id,
                plan_id,
                execution_log,
                naming["display_name"],
                request["session_id"],
                naming["session_title"],
            )
            LOGGER.exception("Agent run failed for user=%s plan=%s", user_id, plan_id)
            yield json.dumps({"type": "error", "message": f"Agent run failed: {agent_error}"}, ensure_ascii=True) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.get("/api/agent/history")
async def get_agent_history(user_id: str = Depends(require_user_id)) -> dict[str, list[dict[str, Any]]]:
    cache_key = _cache_key("agent", user_id, "history")
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    try:
        tasks = await asyncio.to_thread(list_task_plans, user_id)
    except Exception as history_error:
        LOGGER.exception("Agent history load failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to load agent history: {history_error}",
        ) from history_error
    return _cached_json_response(cache_key, {"tasks": tasks}, HOT_CACHE_TTL_SECONDS)


@app.get("/api/agent/history/{plan_id}")
async def get_agent_history_detail(plan_id: str, user_id: str = Depends(require_user_id)) -> dict[str, Any]:
    cache_key = _cache_key("agent", user_id, "history", plan_id)
    cached_response = _read_cached_json_response(cache_key)
    if cached_response is not None:
        return cached_response
    plan = await asyncio.to_thread(load_task_plan, user_id, plan_id)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent plan not found.")

    log = await asyncio.to_thread(load_execution_log, user_id, plan_id)
    return _cached_json_response(cache_key, {"plan": plan, "log": log}, HOT_CACHE_TTL_SECONDS)


@app.post("/api/chat")
async def post_chat(
    payload: dict[str, Any] = Body(...),
    auth_context: AuthContext = Depends(require_permission(Permission.CHAT_CREATE)),
    naming: dict[str, str | None] = Depends(get_request_naming),
):
    user_id = auth_context.user_id
    request = validate_chat_request(payload)
    request_id = str(uuid.uuid4())
    start = time.perf_counter()
    project_data: dict[str, Any] | None = None
    history_override: list[dict[str, Any]] | None = None

    if request["project_id"]:
        project_data = await asyncio.to_thread(get_project, user_id, request["project_id"], naming["display_name"])
        if not project_data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    await asyncio.to_thread(_enforce_usage_limit_for_feature, user_id, "chat", naming["display_name"])
    _invalidate_cache_prefixes(_cache_key("usage", user_id, naming["display_name"] or ""))

    if request["project_id"]:
        _invalidate_cache_prefixes(
            _cache_key("projects", user_id, naming["display_name"] or "", request["project_id"], "chats"),
            _cache_key("projects", user_id, naming["display_name"] or "", request["project_id"], "chat", request["session_id"]),
            _cache_key("projects", user_id, naming["display_name"] or "", request["project_id"], "brain-log"),
            _cache_key("projects", user_id, naming["display_name"] or "", request["project_id"], "memory"),
        )
        history_override = await asyncio.to_thread(
            load_project_chat_messages,
            user_id,
            request["project_id"],
            request["session_id"],
            naming["display_name"],
            naming["session_title"],
        )
        await asyncio.to_thread(
            append_project_chat_message,
            user_id,
            request["project_id"],
            request["session_id"],
            {
                "role": "user",
                "content": request["message"],
                "model": request["model"],
                "request_id": request_id,
                "user_id": user_id,
                "display_name": naming["display_name"] or user_id,
                "session_id": request["session_id"],
                "session_title": naming["session_title"] or request["session_id"],
                "project_id": request["project_id"],
                "project_name": project_data.get("name"),
                "created_at": datetime.now(UTC).isoformat(),
            },
            naming["display_name"],
            naming["session_title"],
        )
        memory_prompt = await asyncio.to_thread(build_project_system_prompt, user_id, request["project_id"], naming["display_name"])
    else:
        save_user_message(
            request=request,
            request_id=request_id,
            store=STORE,
            user_id=user_id,
            display_name=naming["display_name"],
            session_title=naming["session_title"],
        )
        memory_prompt = build_memory_prompt(user_id=user_id, display_name=naming["display_name"])

    search_used = False
    sources: list[dict[str, str]] = []
    search_prompt = ""
    file_context_used = False
    file_prompt = ""
    search_error_message: str | None = None

    search_needed = request["force_search"]
    if search_needed:
        cached_results: list[dict[str, str]] | None = None
        try:
            cached_results = await asyncio.to_thread(load_cached_results, request["message"])
        except Exception as cache_load_error:
            LOGGER.warning("Search cache read failed: %s", cache_load_error)

        if cached_results is not None:
            sources = cached_results
        else:
            try:
                sources = await asyncio.to_thread(search_web, request["message"])
                try:
                    await asyncio.to_thread(cache_search_results, request["message"], sources)
                except Exception as cache_write_error:
                    LOGGER.warning("Search cache write failed: %s", cache_write_error)
            except Exception as search_error:
                LOGGER.warning("Web search failed; continuing without search context: %s", search_error)
                search_error_message = "Web search provider is currently unavailable."
                sources = []

        if sources:
            search_used = True
            search_prompt = format_search_context(sources)

    try:
        if request["project_id"]:
            relevant_chunks = await asyncio.to_thread(
                get_project_file_context_chunks,
                user_id,
                request["project_id"],
                request["message"],
                naming["display_name"],
            )
        else:
            all_session_chunks: list[str] = []
            session_files = await asyncio.to_thread(
                list_user_files,
                user_id,
                request["session_id"],
                naming["display_name"],
                naming["session_title"],
            )
            for session_file in session_files:
                file_name = str(session_file.get("filename", "")).strip()
                if not file_name:
                    continue
                parsed_chunks = await asyncio.to_thread(
                    load_parsed_chunks,
                    user_id,
                    request["session_id"],
                    file_name,
                    naming["display_name"],
                    naming["session_title"],
                )
                if parsed_chunks:
                    all_session_chunks.extend(parsed_chunks)
            relevant_chunks = await asyncio.to_thread(get_relevant_chunks, all_session_chunks, request["message"], 3)
        if relevant_chunks:
            file_context_used = True
            file_prompt = "Relevant content from uploaded files:\n" + "\n\n".join(relevant_chunks)
    except Exception as file_context_error:
        LOGGER.warning("File context retrieval failed; continuing without file context: %s", file_context_error)

    direct_reply: str | None = None
    if request["force_search"] and not sources:
        if search_error_message:
            direct_reply = (
                "Web search is enabled, but the search provider is unavailable right now. "
                "Please try again in a moment."
            )
        else:
            direct_reply = (
                "Web search is enabled, but no reliable public results were found for this query. "
                "Try a more specific query with full name, company website, or location."
            )

    if not request["stream"]:
        usage = {"input_tokens": 0, "output_tokens": 0}
        if direct_reply is not None:
            reply = direct_reply
        else:
            reply, usage = await generate_reply_with_usage(
                request=request,
                store=STORE,
                user_id=user_id,
                display_name=naming["display_name"],
                session_title=naming["session_title"],
                memory_prompt=memory_prompt,
                search_prompt=search_prompt,
                file_prompt=file_prompt,
                history_override=history_override,
            )
        response_ms = int((time.perf_counter() - start) * 1000)
        tokens_emitted = len(tokenize_text(reply))
        if request["project_id"]:
            await asyncio.to_thread(
                append_project_chat_message,
                user_id,
                request["project_id"],
                request["session_id"],
                {
                    "role": "assistant",
                    "content": reply,
                    "model": request["model"],
                    "request_id": request_id,
                    "status": "completed",
                    "user_id": user_id,
                    "display_name": naming["display_name"] or user_id,
                    "session_id": request["session_id"],
                    "session_title": naming["session_title"] or request["session_id"],
                    "project_id": request["project_id"],
                    "project_name": project_data.get("name") if project_data else None,
                    "created_at": datetime.now(UTC).isoformat(),
                    "response_ms": response_ms,
                    "first_token_ms": response_ms,
                    "tokens_emitted": tokens_emitted,
                    "search_used": search_used,
                    "file_context_used": file_context_used,
                    "sources": sources,
                },
                naming["display_name"],
                naming["session_title"],
            )
        else:
            save_assistant_message(
                session_id=request["session_id"],
                model=request["model"],
                request_id=request_id,
                reply=reply,
                store=STORE,
                user_id=user_id,
                display_name=naming["display_name"],
                session_title=naming["session_title"],
                status="completed",
                response_ms=response_ms,
                first_token_ms=response_ms,
                tokens_emitted=tokens_emitted,
                search_used=search_used,
                file_context_used=file_context_used,
                sources=sources,
            )
        response_payload = build_chat_json_response(
            request_id=request_id,
            reply=reply,
            model=request["model"],
            response_ms=response_ms,
            search_used=search_used,
            file_context_used=file_context_used,
            sources=sources,
        )
        if request["project_id"] and project_data:
            asyncio.create_task(
                run_project_brain(
                    user_id=user_id,
                    project_id=request["project_id"],
                    session_id=request["session_id"],
                    user_message=request["message"],
                    assistant_reply=reply,
                    template=str(project_data.get("template", "custom")),
                    display_name=naming["display_name"],
                )
            )
        else:
            asyncio.create_task(
                process_memory_update(
                    user_id=user_id,
                    message=request["message"],
                    reply=reply,
                    display_name=naming["display_name"],
                )
            )
        if usage["input_tokens"] or usage["output_tokens"]:
            asyncio.create_task(
                asyncio.to_thread(
                    log_usage,
                    user_id,
                    "chat",
                    usage["input_tokens"],
                    usage["output_tokens"],
                    naming["display_name"],
                )
            )
        return JSONResponse(response_payload)

    async def stream() -> AsyncIterator[str]:
        assembled: list[str] = []
        tokens_emitted = 0
        first_token_ms: int | None = None
        stream_status = "interrupted"
        chat_usage = {"input_tokens": 0, "output_tokens": 0}

        try:
            if direct_reply is not None:
                async for token in stream_tokens(direct_reply):
                    if first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - start) * 1000)
                    tokens_emitted += 1
                    assembled.append(token)
                    yield json.dumps({"type": "token", "content": token}, ensure_ascii=True) + "\n"
            else:
                token_stream = generate_reply_stream_with_usage(
                    request=request,
                    store=STORE,
                    user_id=user_id,
                    display_name=naming["display_name"],
                    session_title=naming["session_title"],
                    memory_prompt=memory_prompt,
                    search_prompt=search_prompt,
                    file_prompt=file_prompt,
                    history_override=history_override,
                )
                async for event in token_stream:
                    event_type = str(event.get("type", "")).strip()
                    if event_type == "usage":
                        usage_payload = event.get("usage", {"input_tokens": 0, "output_tokens": 0})
                        if isinstance(usage_payload, dict):
                            chat_usage = {
                                "input_tokens": int(usage_payload.get("input_tokens", 0) or 0),
                                "output_tokens": int(usage_payload.get("output_tokens", 0) or 0),
                            }
                        continue
                    token = str(event.get("content", ""))
                    if not token:
                        continue
                    if first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - start) * 1000)
                    tokens_emitted += 1
                    assembled.append(token)
                    yield json.dumps({"type": "token", "content": token}, ensure_ascii=True) + "\n"

            response_ms = int((time.perf_counter() - start) * 1000)
            stream_status = "completed"
            resolved_first_token_ms = first_token_ms if first_token_ms is not None else response_ms

            yield (
                json.dumps(
                    {
                        "type": "done",
                        "content": "",
                        "request_id": request_id,
                        "response_ms": response_ms,
                        "first_token_ms": resolved_first_token_ms,
                        "tokens_emitted": tokens_emitted,
                        "status": stream_status,
                        "search_used": search_used,
                        "file_context_used": file_context_used,
                        "sources": sources,
                    },
                    ensure_ascii=True,
                )
                + "\n"
            )
        except asyncio.CancelledError:
            stream_status = "interrupted"
            raise
        except Exception as stream_error:
            stream_status = "interrupted"
            error_text = getattr(stream_error, "detail", None) or str(stream_error)
            yield (
                json.dumps(
                    {
                        "type": "error",
                        "content": f"Streaming interrupted: {error_text}",
                        "request_id": request_id,
                    },
                    ensure_ascii=True,
                )
                + "\n"
            )
        finally:
            final_reply = "".join(assembled).strip()
            response_ms_final = int((time.perf_counter() - start) * 1000)
            resolved_first_token_ms = first_token_ms if first_token_ms is not None else response_ms_final

            if final_reply:
                if request["project_id"] and project_data:
                    asyncio.create_task(
                        run_project_brain(
                            user_id=user_id,
                            project_id=request["project_id"],
                            session_id=request["session_id"],
                            user_message=request["message"],
                            assistant_reply=final_reply,
                            template=str(project_data.get("template", "custom")),
                            display_name=naming["display_name"],
                        )
                    )
                else:
                    asyncio.create_task(
                        process_memory_update(
                            user_id=user_id,
                            message=request["message"],
                            reply=final_reply,
                            display_name=naming["display_name"],
                        )
                    )
            if chat_usage["input_tokens"] or chat_usage["output_tokens"]:
                asyncio.create_task(
                    asyncio.to_thread(
                        log_usage,
                        user_id,
                        "chat",
                        chat_usage["input_tokens"],
                        chat_usage["output_tokens"],
                        naming["display_name"],
                    )
                )

            if stream_status == "completed" or final_reply:
                if request["project_id"]:
                    await asyncio.to_thread(
                        append_project_chat_message,
                        user_id,
                        request["project_id"],
                        request["session_id"],
                        {
                            "role": "assistant",
                            "content": final_reply,
                            "model": request["model"],
                            "request_id": request_id,
                            "status": stream_status,
                            "user_id": user_id,
                            "display_name": naming["display_name"] or user_id,
                            "session_id": request["session_id"],
                            "session_title": naming["session_title"] or request["session_id"],
                            "project_id": request["project_id"],
                            "project_name": project_data.get("name") if project_data else None,
                            "created_at": datetime.now(UTC).isoformat(),
                            "response_ms": response_ms_final,
                            "first_token_ms": resolved_first_token_ms,
                            "tokens_emitted": tokens_emitted,
                            "search_used": search_used,
                            "file_context_used": file_context_used,
                            "sources": sources,
                        },
                        naming["display_name"],
                        naming["session_title"],
                    )
                else:
                    save_assistant_message(
                        session_id=request["session_id"],
                        model=request["model"],
                        request_id=request_id,
                        reply=final_reply,
                        store=STORE,
                        user_id=user_id,
                        display_name=naming["display_name"],
                        session_title=naming["session_title"],
                        status=stream_status,
                        response_ms=response_ms_final,
                        first_token_ms=resolved_first_token_ms,
                        tokens_emitted=tokens_emitted,
                        search_used=search_used,
                        file_context_used=file_context_used,
                        sources=sources,
                    )

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={"x-request-id": request_id},
    )
