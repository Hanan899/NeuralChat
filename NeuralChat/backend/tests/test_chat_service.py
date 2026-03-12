from __future__ import annotations

import asyncio
import os
from typing import Any

import pytest

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.services import chat_service
from app.services.chat_service import tokenize_text
from app.services.storage import init_store, load_messages, reset_memory_store


def test_tokenize_text_order():
    tokens = tokenize_text("Hello world, NeuralChat!")
    assert tokens == ["Hello ", "world, ", "NeuralChat!"]


def test_generate_and_persist_messages(monkeypatch: pytest.MonkeyPatch):
    store = init_store()
    reset_memory_store()

    request: dict[str, Any] = {
        "session_id": "session-1",
        "message": "How are you?",
        "model": "gpt-5",
        "stream": False,
    }

    async def fake_generate_reply(
        model: str,
        message: str,
        history: list[dict[str, Any]],
        memory_prompt: str = "",
        timeout_seconds: float = 25.0,
    ) -> str:
        del timeout_seconds
        return f"reply({model}): {message}; history={len(history)}; memory={memory_prompt}"

    monkeypatch.setattr(chat_service, "generate_model_reply", fake_generate_reply)

    chat_service.save_user_message(request, request_id="req-1", store=store, user_id="user-1")
    reply = asyncio.run(chat_service.generate_reply(request, store=store, user_id="user-1", memory_prompt="name=Ali"))

    chat_service.save_assistant_message(
        session_id=request["session_id"],
        model=request["model"],
        request_id="req-1",
        reply=reply,
        store=store,
        user_id="user-1",
    )

    saved = load_messages(store, "user-1", "session-1")
    assert saved[0]["role"] == "user"
    assert saved[1]["role"] == "assistant"
    assert "reply(gpt-5)" in saved[1]["content"]
    assert saved[1]["status"] == "completed"
