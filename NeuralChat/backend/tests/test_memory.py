from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest
from azure.core.exceptions import ResourceNotFoundError
from fastapi.testclient import TestClient

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import app
from app.services import chat_service
from app.services import memory


# This checks profile loading works when blob has valid JSON facts.
def test_load_profile_returns_dict_when_blob_exists():
    fake_blob_client = MagicMock()
    fake_blob_client.download_blob.return_value.readall.return_value = b'{"name": "Ali", "job": "Engineer"}'
    fake_container = MagicMock()
    fake_container.get_blob_client.return_value = fake_blob_client

    with patch("app.services.memory._get_profiles_container", return_value=fake_container):
        result = memory.load_profile("user_123")

    assert result == {"name": "Ali", "job": "Engineer"}


# This checks missing blob files do not crash and return an empty profile.
def test_load_profile_returns_empty_dict_when_blob_missing():
    fake_blob_client = MagicMock()
    fake_blob_client.download_blob.side_effect = ResourceNotFoundError("missing")
    fake_container = MagicMock()
    fake_container.get_blob_client.return_value = fake_blob_client

    with patch("app.services.memory._get_profiles_container", return_value=fake_container):
        result = memory.load_profile("user_123")

    assert result == {}


# This checks corrupted blob JSON is handled safely without exceptions.
def test_load_profile_returns_empty_dict_on_invalid_json():
    fake_blob_client = MagicMock()
    fake_blob_client.download_blob.return_value.readall.return_value = b"NOT_JSON{{{"
    fake_container = MagicMock()
    fake_container.get_blob_client.return_value = fake_blob_client

    with patch("app.services.memory._get_profiles_container", return_value=fake_container):
        result = memory.load_profile("user_123")

    assert result == {}


# This checks save merges new facts instead of replacing the whole profile.
def test_save_profile_merges_new_facts_with_existing():
    with patch("app.services.memory.load_profile", return_value={"name": "Ali"}), patch(
        "app.services.memory._write_profile"
    ) as write_profile_mock:
        memory.save_profile("user_123", {"job": "Engineer"})

    write_profile_mock.assert_called_once_with("user_123", {"name": "Ali", "job": "Engineer"})


# This checks new values overwrite existing values for the same key.
def test_save_profile_overwrites_existing_key():
    with patch("app.services.memory.load_profile", return_value={"name": "Ali"}), patch(
        "app.services.memory._write_profile"
    ) as write_profile_mock:
        memory.save_profile("user_123", {"name": "Bob"})

    write_profile_mock.assert_called_once_with("user_123", {"name": "Bob"})


# This checks save works when no previous profile exists.
def test_save_profile_handles_empty_existing_profile():
    with patch("app.services.memory.load_profile", return_value={}), patch(
        "app.services.memory._write_profile"
    ) as write_profile_mock:
        memory.save_profile("user_123", {"city": "Lahore"})

    write_profile_mock.assert_called_once_with("user_123", {"city": "Lahore"})


# This checks valid GPT JSON extraction returns structured facts.
def test_extract_facts_returns_dict_on_valid_gpt_response(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "key")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-chat")

    fake_response = MagicMock()
    fake_response.json.return_value = {
        "choices": [{"message": {"content": '{"name": "Ali", "job": "Engineer"}'}}]
    }
    fake_response.raise_for_status.return_value = None
    fake_client = MagicMock()
    fake_client.post.return_value = fake_response

    with patch("app.services.memory.httpx.Client") as client_class_mock:
        client_class_mock.return_value.__enter__.return_value = fake_client
        result = memory.extract_facts("hello", "hi")

    assert result == {"name": "Ali", "job": "Engineer"}


# This checks an empty GPT JSON object maps to empty profile updates.
def test_extract_facts_returns_empty_dict_when_gpt_returns_empty_json(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "key")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-chat")

    fake_response = MagicMock()
    fake_response.json.return_value = {"choices": [{"message": {"content": "{}"}}]}
    fake_response.raise_for_status.return_value = None
    fake_client = MagicMock()
    fake_client.post.return_value = fake_response

    with patch("app.services.memory.httpx.Client") as client_class_mock:
        client_class_mock.return_value.__enter__.return_value = fake_client
        result = memory.extract_facts("hello", "hi")

    assert result == {}


# This checks malformed non-JSON GPT output fails safely to empty facts.
def test_extract_facts_returns_empty_dict_on_malformed_gpt_response(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "key")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-chat")

    fake_response = MagicMock()
    fake_response.json.return_value = {"choices": [{"message": {"content": "Sure! Here are the facts..."}}]}
    fake_response.raise_for_status.return_value = None
    fake_client = MagicMock()
    fake_client.post.return_value = fake_response

    with patch("app.services.memory.httpx.Client") as client_class_mock:
        client_class_mock.return_value.__enter__.return_value = fake_client
        result = memory.extract_facts("hello", "hi")

    assert result == {}


# This checks memory prompt formatting includes known fact pairs.
def test_build_memory_prompt_returns_formatted_string():
    with patch("app.services.memory.load_profile", return_value={"name": "Ali", "job": "Engineer"}):
        result = memory.build_memory_prompt("user_123")

    assert "name=Ali" in result
    assert "job=Engineer" in result


# This checks empty profiles do not inject useless memory text.
def test_build_memory_prompt_returns_empty_string_when_profile_empty():
    with patch("app.services.memory.load_profile", return_value={}):
        result = memory.build_memory_prompt("user_123")

    assert result == ""


@pytest.fixture()
def api_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    app.dependency_overrides[require_user_id] = lambda: "user_123"

    async def fake_generate_model_reply(
        model: str,
        message: str,
        history: list[dict],
        memory_prompt: str = "",
        timeout_seconds: float = 25.0,
    ) -> str:
        del timeout_seconds
        return f"reply({model}): {message}; memory={memory_prompt}; history={len(history)}"

    monkeypatch.setattr(chat_service, "generate_model_reply", fake_generate_model_reply)

    async def fake_process_memory_update(user_id: str, message: str, reply: str) -> None:
        del user_id, message, reply
        return

    monkeypatch.setattr("app.main.process_memory_update", fake_process_memory_update)

    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


# This checks /api/me returns auth-derived user_id together with profile facts.
def test_get_me_returns_user_id_and_profile(api_client: TestClient):
    with patch("app.main.load_profile", return_value={"name": "Ali"}):
        response = api_client.get("/api/me")

    assert response.status_code == 200
    assert response.json() == {"user_id": "user_123", "profile": {"name": "Ali"}}


# This checks PATCH memory writes one key/value pair into profile storage.
def test_patch_memory_updates_one_fact(api_client: TestClient):
    with patch("app.main.save_profile") as save_profile_mock, patch("app.main.load_profile", return_value={"city": "Lahore"}):
        response = api_client.patch("/api/me/memory", json={"key": "city", "value": "Lahore"})

    assert response.status_code == 200
    save_profile_mock.assert_called_once_with(user_id="user_123", facts={"city": "Lahore"})


# This checks DELETE memory clears user profile storage and confirms success.
def test_delete_memory_clears_profile(api_client: TestClient):
    fake_blob_client = MagicMock()
    fake_container = MagicMock()
    fake_container.get_blob_client.return_value = fake_blob_client

    with patch("app.services.memory._get_profiles_container", return_value=fake_container):
        response = api_client.delete("/api/me/memory")

    assert response.status_code == 200
    assert response.json() == {"message": "Memory cleared"}
    fake_container.get_blob_client.assert_called_once_with(blob="profiles/user_123.json")
    fake_blob_client.delete_blob.assert_called_once()


# This checks chat provider receives the built memory prompt in the GPT system context path.
def test_chat_injects_memory_into_system_prompt(api_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    captured_prompt: dict[str, str] = {"value": ""}

    async def fake_generate_model_reply(
        model: str,
        message: str,
        history: list[dict],
        memory_prompt: str = "",
        timeout_seconds: float = 25.0,
    ) -> str:
        del model, message, history, timeout_seconds
        captured_prompt["value"] = memory_prompt
        return "memory-aware-reply"

    monkeypatch.setattr(chat_service, "generate_model_reply", fake_generate_model_reply)
    monkeypatch.setattr("app.main.build_memory_prompt", lambda user_id: "What I know about you: name=Ali")

    response = api_client.post(
        "/api/chat",
        json={"session_id": "session_1", "message": "hello", "model": "gpt-5", "stream": False},
    )

    assert response.status_code == 200
    assert "What I know about you: name=Ali" in captured_prompt["value"]
