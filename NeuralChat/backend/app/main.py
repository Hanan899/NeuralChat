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
from app.schemas import (
    build_chat_json_response,
    build_health_response,
    validate_agent_plan_request,
    validate_agent_run_request,
    validate_chat_request,
    validate_title_request,
)
from app.services.agent import (
    AGENT_TIMEOUT_SECONDS,
    AVAILABLE_AGENT_TOOLS,
    create_task_plan,
    delete_session_agent_artifacts,
    list_task_plans,
    load_execution_log,
    load_task_plan,
    save_execution_log,
    save_task_plan,
    stream_agent_execution,
)
from app.services.chat_service import (
    generate_reply,
    generate_reply_stream,
    save_assistant_message,
    save_user_message,
    stream_tokens,
    tokenize_text,
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
from app.services.search import cache_search_results, format_search_context, load_cached_results, search_web
from app.services.storage import delete_conversation_session, init_store
from app.services.titles import generate_conversation_title

APP_VERSION = "0.3.0"
BASE_DIR = Path(__file__).resolve().parents[1]
LOGGER = logging.getLogger(__name__)

load_local_settings_env(BASE_DIR)
STORE = init_store()

app = FastAPI(title="NeuralChat Backend", version=APP_VERSION)

raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/health")
def get_health() -> dict[str, str]:
    return build_health_response(timestamp=datetime.now(UTC).isoformat(), version=APP_VERSION)


@app.get("/api/search/status")
def get_search_status() -> dict[str, bool]:
    return {"search_enabled": bool(os.getenv("TAVILY_API_KEY", "").strip())}


@app.post("/api/conversations/title")
async def post_conversation_title(
    payload: dict[str, Any] = Body(...),
    _user_id: str = Depends(require_user_id),
) -> dict[str, str]:
    request = validate_title_request(payload)
    title = await asyncio.to_thread(generate_conversation_title, request["prompt"], request["reply"])
    return {"title": title}


@app.get("/api/me")
def get_me(
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    profile = load_profile(user_id=user_id, display_name=naming["display_name"])
    return {
        "user_id": user_id,
        "profile": profile,
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
    return {"user_id": user_id, "profile": updated_profile}


@app.delete("/api/me/memory")
def delete_memory(
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    clear_profile(user_id=user_id, display_name=naming["display_name"])
    return {"message": "Memory cleared"}


@app.post("/api/upload")
async def post_upload(
    session_id: str = Form(...),
    file: UploadFile = File(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    if not isinstance(session_id, str) or not session_id.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="session_id is required.")

    filename = file.filename or ""
    file_bytes = await file.read()
    file_size_bytes = len(file_bytes)

    try:
        validate_file(filename=filename, file_size_bytes=file_size_bytes)
    except ValueError as validation_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(validation_error)) from validation_error

    try:
        blob_path = await asyncio.to_thread(
            upload_raw_file,
            user_id,
            session_id,
            filename,
            file_bytes,
            naming["display_name"],
            naming["session_title"],
        )
        existing_chunks = await asyncio.to_thread(
            load_parsed_chunks,
            user_id,
            session_id,
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
                session_id,
                filename,
                parsed_chunks,
                naming["display_name"],
                naming["session_title"],
            )
            chunk_count = len(parsed_chunks)
    except HTTPException:
        raise
    except Exception as upload_error:
        LOGGER.exception("File upload failed for user=%s session=%s file=%s", user_id, session_id, filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"File upload failed: {upload_error}",
        ) from upload_error

    return {
        "filename": Path(filename).name,
        "blob_path": blob_path,
        "chunk_count": chunk_count,
        "message": "File uploaded successfully",
    }


@app.get("/api/files")
async def get_files(
    session_id: str = Query(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, list[dict[str, str]]]:
    if not isinstance(session_id, str) or not session_id.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="session_id is required.")

    try:
        files = await asyncio.to_thread(list_user_files, user_id, session_id, naming["display_name"], naming["session_title"])
    except Exception as list_error:
        LOGGER.exception("File list failed for user=%s session=%s", user_id, session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to list files: {list_error}",
        ) from list_error
    return {"files": files}


@app.delete("/api/files/{filename}")
async def delete_file(
    filename: str,
    session_id: str = Query(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, str]:
    if not isinstance(session_id, str) or not session_id.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="session_id is required.")

    try:
        await asyncio.to_thread(delete_user_file, user_id, session_id, filename, naming["display_name"], naming["session_title"])
    except ValueError as not_found_error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(not_found_error)) from not_found_error
    except Exception as delete_error:
        LOGGER.exception("File delete failed for user=%s session=%s file=%s", user_id, session_id, filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to delete file: {delete_error}",
        ) from delete_error

    safe_filename = Path(filename).name
    return {"message": f"{safe_filename} deleted successfully"}


@app.delete("/api/conversations/{session_id}")
async def delete_conversation(
    session_id: str,
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
) -> dict[str, Any]:
    if not isinstance(session_id, str) or not session_id.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="session_id is required.")

    try:
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
        LOGGER.exception("Session delete failed for user=%s session=%s", user_id, session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to delete conversation session: {delete_error}",
        ) from delete_error

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
    request = validate_agent_plan_request(payload)

    try:
        plan = await create_task_plan(request["goal"], AVAILABLE_AGENT_TOOLS)
        save_task_plan(
            user_id,
            plan,
            naming["display_name"],
            request["session_id"],
            naming["session_title"],
        )
    except Exception as plan_error:
        LOGGER.exception("Agent plan creation failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to create agent plan: {plan_error}",
        ) from plan_error

    return {"plan": plan}


@app.post("/api/agent/run/{plan_id}")
async def post_agent_run(
    plan_id: str,
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
):
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
    try:
        tasks = await asyncio.to_thread(list_task_plans, user_id)
    except Exception as history_error:
        LOGGER.exception("Agent history load failed for user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to load agent history: {history_error}",
        ) from history_error
    return {"tasks": tasks}


@app.get("/api/agent/history/{plan_id}")
async def get_agent_history_detail(plan_id: str, user_id: str = Depends(require_user_id)) -> dict[str, Any]:
    plan = await asyncio.to_thread(load_task_plan, user_id, plan_id)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent plan not found.")

    log = await asyncio.to_thread(load_execution_log, user_id, plan_id)
    return {"plan": plan, "log": log}


@app.post("/api/chat")
async def post_chat(
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
    naming: dict[str, str | None] = Depends(get_request_naming),
):
    request = validate_chat_request(payload)
    request_id = str(uuid.uuid4())
    start = time.perf_counter()

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
        if direct_reply is not None:
            reply = direct_reply
        else:
            reply = await generate_reply(
                request=request,
                store=STORE,
                user_id=user_id,
                display_name=naming["display_name"],
                session_title=naming["session_title"],
                memory_prompt=memory_prompt,
                search_prompt=search_prompt,
                file_prompt=file_prompt,
            )
        response_ms = int((time.perf_counter() - start) * 1000)
        tokens_emitted = len(tokenize_text(reply))
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
        asyncio.create_task(
            process_memory_update(
                user_id=user_id,
                message=request["message"],
                reply=reply,
                display_name=naming["display_name"],
            )
        )
        return JSONResponse(response_payload)

    async def stream() -> AsyncIterator[str]:
        assembled: list[str] = []
        tokens_emitted = 0
        first_token_ms: int | None = None
        stream_status = "interrupted"

        try:
            if direct_reply is not None:
                token_stream = stream_tokens(direct_reply)
            else:
                token_stream = generate_reply_stream(
                    request=request,
                    store=STORE,
                    user_id=user_id,
                    display_name=naming["display_name"],
                    session_title=naming["session_title"],
                    memory_prompt=memory_prompt,
                    search_prompt=search_prompt,
                    file_prompt=file_prompt,
                )

            async for token in token_stream:
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
                asyncio.create_task(
                    process_memory_update(
                        user_id=user_id,
                        message=request["message"],
                        reply=final_reply,
                        display_name=naming["display_name"],
                    )
                )

            if stream_status == "completed" or final_reply:
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
