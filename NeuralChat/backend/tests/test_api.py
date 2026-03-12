from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import STORE, app
from app.services import chat_service
from app.services.storage import load_messages, reset_memory_store


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    reset_memory_store()
    app.dependency_overrides[require_user_id] = lambda: "user-test"

    async def fake_generate_model_reply(
        model: str,
        message: str,
        history: list[dict[str, Any]],
        memory_prompt: str = "",
        timeout_seconds: float = 25.0,
    ) -> str:
        del timeout_seconds
        return f"reply({model}): {message}; history={len(history)}; memory={memory_prompt}"

    monkeypatch.setattr(chat_service, "generate_model_reply", fake_generate_model_reply)
    monkeypatch.setattr("app.main.build_memory_prompt", lambda user_id: "")

    async def fake_process_memory_update(user_id: str, message: str, reply: str) -> None:
        del user_id, message, reply
        await asyncio.sleep(0)

    monkeypatch.setattr("app.main.process_memory_update", fake_process_memory_update)

    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()


def test_health_returns_expected_shape(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert "timestamp" in payload
    assert "version" in payload


def test_chat_requires_auth_without_token(client: TestClient):
    del client
    app.dependency_overrides.pop(require_user_id, None)
    response = TestClient(app).post(
        "/api/chat",
        json={"session_id": "s-1", "message": "hello", "model": "gpt-5", "stream": False},
    )
    assert response.status_code == 401


def test_chat_rejects_invalid_model(client: TestClient):
    for model in ["invalid-model", "gpt4o", "claude"]:
        response = client.post(
            "/api/chat",
            json={"session_id": "s-1", "message": "hello", "model": model, "stream": False},
        )
        assert response.status_code == 422


def test_chat_stream_emits_token_then_done(client: TestClient):
    session_id = f"s-{uuid.uuid4()}"
    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "message": "test stream", "model": "gpt-5", "stream": True},
    )
    assert response.status_code == 200
    chunks = [json.loads(line) for line in response.text.splitlines() if line.strip()]
    assert len(chunks) >= 2
    assert chunks[0]["type"] == "token"
    assert chunks[-1]["type"] == "done"
    stored = load_messages(STORE, "user-test", session_id)
    assert len(stored) == 2


def test_chat_options_preflight_allowed(client: TestClient):
    response = client.options(
        "/api/chat",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
