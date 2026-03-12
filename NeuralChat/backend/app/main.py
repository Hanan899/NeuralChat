"""FastAPI surface for NeuralChat backend.

Explain this code:
- `/api/health` proves backend is alive.
- `/api/chat` validates input, enforces auth, and returns NDJSON token stream.
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
from typing import Any
from typing import AsyncIterator

from fastapi import Body, Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from app.auth import require_user_id
from app.env_loader import load_local_settings_env
from app.schemas import build_chat_json_response, build_health_response, validate_chat_request
from app.services.chat_service import (
    generate_reply,
    generate_reply_stream,
    save_assistant_message,
    save_user_message,
    stream_tokens,
    tokenize_text,
)
from app.services.memory import build_memory_prompt, clear_profile, load_profile, process_memory_update, save_profile, upsert_profile_key
from app.services.search import cache_search_results, format_search_context, load_cached_results, search_web, should_search
from app.services.storage import init_store

APP_VERSION = "0.2.0"
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


@app.get("/api/health")
def get_health() -> dict[str, str]:
    return build_health_response(timestamp=datetime.now(UTC).isoformat(), version=APP_VERSION)


@app.get("/api/search/status")
def get_search_status() -> dict[str, bool]:
    return {"search_enabled": bool(os.getenv("TAVILY_API_KEY", "").strip())}


@app.get("/api/me")
def get_me(user_id: str = Depends(require_user_id)) -> dict[str, Any]:
    profile = load_profile(user_id=user_id)
    return {
        "user_id": user_id,
        "profile": profile,
    }


@app.patch("/api/me/memory")
def patch_memory(
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
) -> dict[str, Any]:
    key = payload.get("key", "")
    value = payload.get("value", "")

    if not isinstance(key, str) or not key.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="key must be a non-empty string.")
    if not isinstance(value, str):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="value must be a string.")

    clean_key = key.strip()
    if value.strip():
        save_profile(user_id=user_id, facts={clean_key: value})
    else:
        upsert_profile_key(user_id=user_id, key=clean_key, value=value)
    updated_profile = load_profile(user_id=user_id)
    return {"user_id": user_id, "profile": updated_profile}


@app.delete("/api/me/memory")
def delete_memory(user_id: str = Depends(require_user_id)) -> dict[str, str]:
    clear_profile(user_id=user_id)
    return {"message": "Memory cleared"}


@app.post("/api/chat")
async def post_chat(
    payload: dict[str, Any] = Body(...),
    user_id: str = Depends(require_user_id),
):
    request = validate_chat_request(payload)
    request_id = str(uuid.uuid4())
    start = time.perf_counter()

    save_user_message(request=request, request_id=request_id, store=STORE, user_id=user_id)
    memory_prompt = build_memory_prompt(user_id=user_id)
    search_used = False
    sources: list[dict[str, str]] = []
    search_prompt = ""
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
                memory_prompt=memory_prompt,
                search_prompt=search_prompt,
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
            status="completed",
            response_ms=response_ms,
            first_token_ms=response_ms,
            tokens_emitted=tokens_emitted,
            search_used=search_used,
            sources=sources,
        )
        response_payload = build_chat_json_response(
            request_id=request_id,
            reply=reply,
            model=request["model"],
            response_ms=response_ms,
            search_used=search_used,
            sources=sources,
        )
        asyncio.create_task(
            process_memory_update(
                user_id=user_id,
                message=request["message"],
                reply=reply,
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
                    memory_prompt=memory_prompt,
                    search_prompt=search_prompt,
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
                    status=stream_status,
                    response_ms=response_ms_final,
                    first_token_ms=resolved_first_token_ms,
                    tokens_emitted=tokens_emitted,
                    search_used=search_used,
                    sources=sources,
                )

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={"x-request-id": request_id},
    )
