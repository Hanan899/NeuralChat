"""Core chat orchestration.

Explain this code:
- These helper functions combine storage + provider routing.
- API handlers stay thin while business logic lives here.
"""

from __future__ import annotations

import asyncio
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from typing import AsyncIterator

from app.schemas import ChatModel
from app.services.providers import generate_reply as generate_model_reply
from app.services.storage import append_message, load_messages


async def generate_reply(request: dict[str, Any], store_path: Path) -> str:
    history = load_messages(store_path, request["session_id"])
    return await generate_model_reply(model=request["model"], message=request["message"], history=history)


def save_user_message(request: dict[str, Any], request_id: str, store_path: Path) -> None:
    append_message(
        store_path,
        request["session_id"],
        {
            "role": "user",
            "content": request["message"],
            "model": request["model"],
            "request_id": request_id,
            "created_at": datetime.now(UTC).isoformat(),
        },
    )


def save_assistant_message(
    session_id: str,
    model: ChatModel,
    request_id: str,
    reply: str,
    store_path: Path,
    status: str = "completed",
    response_ms: int | None = None,
    first_token_ms: int | None = None,
    tokens_emitted: int | None = None,
) -> None:
    payload: dict[str, Any] = {
        "role": "assistant",
        "content": reply,
        "model": model,
        "request_id": request_id,
        "status": status,
        "created_at": datetime.now(UTC).isoformat(),
    }
    if response_ms is not None:
        payload["response_ms"] = response_ms
    if first_token_ms is not None:
        payload["first_token_ms"] = first_token_ms
    if tokens_emitted is not None:
        payload["tokens_emitted"] = tokens_emitted

    append_message(
        store_path,
        session_id,
        payload,
    )


async def stream_tokens(full_text: str) -> AsyncIterator[str]:
    delay_ms = int(os.getenv("MOCK_STREAM_DELAY_MS", "0"))
    for token in tokenize_text(full_text):
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000)
        yield token


def tokenize_text(text: str) -> list[str]:
    # Keep punctuation attached to words so UI output looks natural.
    return re.findall(r"\S+\s*", text)
