"""Core chat orchestration.

These helpers combine storage and provider routing so API handlers can stay thin.
"""

from __future__ import annotations

import asyncio
import os
import re
from datetime import UTC, datetime
from typing import Any, AsyncIterator

from app.schemas import ChatModel
from app.services.cost_tracker import TokenUsage
from app.services.providers import generate_reply as generate_model_reply
from app.services.providers import generate_reply_stream as generate_model_reply_stream
from app.services.providers import generate_reply_stream_with_usage as generate_model_reply_stream_with_usage
from app.services.providers import generate_reply_with_usage as generate_model_reply_with_usage
from app.services.storage import append_message, load_messages


# This function returns assistant text only for older call sites that do not need usage details.
async def generate_reply(
    request: dict[str, Any],
    store: dict[str, Any],
    user_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
) -> str:
    history = load_messages(store, user_id, request["session_id"], display_name, session_title)
    model_kwargs: dict[str, Any] = {
        "model": request["model"],
        "message": request["message"],
        "history": history,
        "memory_prompt": memory_prompt,
        "search_prompt": search_prompt,
    }
    if file_prompt.strip():
        model_kwargs["file_prompt"] = file_prompt
    return await generate_model_reply(**model_kwargs)


# This function returns assistant text together with token usage for the completed chat call.
async def generate_reply_with_usage(
    request: dict[str, Any],
    store: dict[str, Any],
    user_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
) -> tuple[str, TokenUsage]:
    history = load_messages(store, user_id, request["session_id"], display_name, session_title)
    model_kwargs: dict[str, Any] = {
        "model": request["model"],
        "message": request["message"],
        "history": history,
        "memory_prompt": memory_prompt,
        "search_prompt": search_prompt,
    }
    if file_prompt.strip():
        model_kwargs["file_prompt"] = file_prompt
    result = await generate_model_reply_with_usage(**model_kwargs)
    return result["text"], result["usage"]


# This function yields token text only for older call sites that do not need usage details.
async def generate_reply_stream(
    request: dict[str, Any],
    store: dict[str, Any],
    user_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
) -> AsyncIterator[str]:
    history = load_messages(store, user_id, request["session_id"], display_name, session_title)
    model_kwargs: dict[str, Any] = {
        "model": request["model"],
        "message": request["message"],
        "history": history,
        "memory_prompt": memory_prompt,
        "search_prompt": search_prompt,
    }
    if file_prompt.strip():
        model_kwargs["file_prompt"] = file_prompt
    async for token in generate_model_reply_stream(**model_kwargs):
        yield token


# This function streams provider events so the API layer can forward tokens and capture final usage.
async def generate_reply_stream_with_usage(
    request: dict[str, Any],
    store: dict[str, Any],
    user_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
) -> AsyncIterator[dict[str, Any]]:
    history = load_messages(store, user_id, request["session_id"], display_name, session_title)
    model_kwargs: dict[str, Any] = {
        "model": request["model"],
        "message": request["message"],
        "history": history,
        "memory_prompt": memory_prompt,
        "search_prompt": search_prompt,
    }
    if file_prompt.strip():
        model_kwargs["file_prompt"] = file_prompt
    async for event in generate_model_reply_stream_with_usage(**model_kwargs):
        yield event


# This function stores the user message in the conversation history blob.
def save_user_message(
    request: dict[str, Any],
    request_id: str,
    store: dict[str, Any],
    user_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> None:
    append_message(
        store,
        user_id,
        request["session_id"],
        {
            "role": "user",
            "content": request["message"],
            "model": request["model"],
            "request_id": request_id,
            "user_id": user_id,
            "display_name": display_name or user_id,
            "session_id": request["session_id"],
            "session_title": session_title or request["session_id"],
            "created_at": datetime.now(UTC).isoformat(),
        },
        display_name=display_name,
        session_title=session_title,
    )


# This function stores the assistant message and its metadata in the conversation history blob.
def save_assistant_message(
    session_id: str,
    model: ChatModel,
    request_id: str,
    reply: str,
    store: dict[str, Any],
    user_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
    status: str = "completed",
    response_ms: int | None = None,
    first_token_ms: int | None = None,
    tokens_emitted: int | None = None,
    search_used: bool | None = None,
    file_context_used: bool | None = None,
    sources: list[dict[str, str]] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "role": "assistant",
        "content": reply,
        "model": model,
        "request_id": request_id,
        "status": status,
        "user_id": user_id,
        "display_name": display_name or user_id,
        "session_id": session_id,
        "session_title": session_title or session_id,
        "created_at": datetime.now(UTC).isoformat(),
    }
    if response_ms is not None:
        payload["response_ms"] = response_ms
    if first_token_ms is not None:
        payload["first_token_ms"] = first_token_ms
    if tokens_emitted is not None:
        payload["tokens_emitted"] = tokens_emitted
    if search_used is not None:
        payload["search_used"] = search_used
    if file_context_used is not None:
        payload["file_context_used"] = file_context_used
    if sources is not None:
        payload["sources"] = sources

    append_message(
        store,
        user_id,
        session_id,
        payload,
        display_name=display_name,
        session_title=session_title,
    )


# This function creates a synthetic token stream from a finished string reply for consistent UI behavior.
async def stream_tokens(full_text: str) -> AsyncIterator[str]:
    delay_ms = int(os.getenv("MOCK_STREAM_DELAY_MS", "0"))
    for token in tokenize_text(full_text):
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000)
        yield token


# This helper splits text into natural-looking whitespace-preserving token slices.
def tokenize_text(text: str) -> list[str]:
    return re.findall(r"\S+\s*", text)
