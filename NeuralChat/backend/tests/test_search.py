from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from azure.core.exceptions import ResourceNotFoundError
from fastapi.testclient import TestClient

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.auth import require_user_id
from app.main import app
from app.services import chat_service
from app.services import search


@pytest.fixture()
def chat_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    app.dependency_overrides[require_user_id] = lambda: "user_123"

    async def fake_generate_model_reply(
        model: str,
        message: str,
        history: list[dict],
        memory_prompt: str = "",
        search_prompt: str = "",
        timeout_seconds: float = 25.0,
    ) -> str:
        del timeout_seconds, memory_prompt
        return f"reply({model}): {message}; search={search_prompt}; history={len(history)}"

    monkeypatch.setattr(chat_service, "generate_model_reply", fake_generate_model_reply)
    monkeypatch.setattr("app.main.build_memory_prompt", lambda user_id: "")

    async def fake_process_memory_update(user_id: str, message: str, reply: str) -> None:
        del user_id, message, reply
        return

    monkeypatch.setattr("app.main.process_memory_update", fake_process_memory_update)

    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


# This checks decision logic returns True when GPT explicitly says search is needed.
def test_should_search_returns_true_for_current_events_question(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "key")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-chat")

    fake_response = MagicMock()
    fake_response.raise_for_status.return_value = None
    fake_response.json.return_value = {"choices": [{"message": {"content": '{"needs_search": true}'}}]}
    fake_client = MagicMock()
    fake_client.post.return_value = fake_response

    with patch("app.services.search.httpx.Client") as client_class_mock:
        client_class_mock.return_value.__enter__.return_value = fake_client
        result = search.should_search("What is the latest iPhone model?")

    assert result is True


# This checks decision logic returns False when GPT says web search is not needed.
def test_should_search_returns_false_for_general_knowledge(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "key")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-chat")

    fake_response = MagicMock()
    fake_response.raise_for_status.return_value = None
    fake_response.json.return_value = {"choices": [{"message": {"content": '{"needs_search": false}'}}]}
    fake_client = MagicMock()
    fake_client.post.return_value = fake_response

    with patch("app.services.search.httpx.Client") as client_class_mock:
        client_class_mock.return_value.__enter__.return_value = fake_client
        result = search.should_search("Explain what a for loop is")

    assert result is False


# This checks malformed GPT output is handled safely and defaults to no-search.
def test_should_search_returns_false_on_malformed_gpt_response(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "key")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-chat")

    fake_response = MagicMock()
    fake_response.raise_for_status.return_value = None
    fake_response.json.return_value = {"choices": [{"message": {"content": "Yes definitely search"}}]}
    fake_client = MagicMock()
    fake_client.post.return_value = fake_response

    with patch("app.services.search.httpx.Client") as client_class_mock:
        client_class_mock.return_value.__enter__.return_value = fake_client
        result = search.should_search("latest tech updates")

    assert result is False


# This checks Tavily response normalization returns the expected list of result objects.
def test_search_web_returns_list_of_results(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TAVILY_API_KEY", "test-key")

    fake_response = MagicMock()
    fake_response.raise_for_status.return_value = None
    fake_response.json.return_value = {
        "results": [
            {"title": "A", "url": "https://a.test", "content": "A summary"},
            {"title": "B", "url": "https://b.test", "content": "B summary"},
            {"title": "C", "url": "https://c.test", "content": "C summary"},
            {"title": "D", "url": "https://d.test", "content": "D summary"},
            {"title": "E", "url": "https://e.test", "content": "E summary"},
        ]
    }
    fake_client = MagicMock()
    fake_client.post.return_value = fake_response

    with patch("app.services.search.httpx.Client") as client_class_mock:
        client_class_mock.return_value.__enter__.return_value = fake_client
        results = search.search_web("best python tips")

    assert isinstance(results, list)
    assert len(results) == 5
    for result_item in results:
        assert set(result_item.keys()) == {"title", "url", "snippet"}


# This checks missing Tavily key fails with a clear configuration error message.
def test_search_web_raises_clear_error_when_api_key_missing(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    with pytest.raises(ValueError) as exception_info:
        search.search_web("best python tips")

    assert "TAVILY_API_KEY" in str(exception_info.value)


# This checks Tavily normalization enforces a hard maximum of 5 returned results.
def test_search_web_returns_max_5_results(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TAVILY_API_KEY", "test-key")

    fake_response = MagicMock()
    fake_response.raise_for_status.return_value = None
    fake_response.json.return_value = {
        "results": [
            {"title": f"Title {index}", "url": f"https://{index}.test", "content": "snippet"}
            for index in range(10)
        ]
    }
    fake_client = MagicMock()
    fake_client.post.return_value = fake_response

    with patch("app.services.search.httpx.Client") as client_class_mock:
        client_class_mock.return_value.__enter__.return_value = fake_client
        results = search.search_web("python")

    assert len(results) == 5


# This checks cache writes include both result payload and timestamp metadata.
def test_cache_saves_results_with_timestamp():
    fake_blob_client = MagicMock()
    fake_container = MagicMock()
    fake_container.get_blob_client.return_value = fake_blob_client

    with patch("app.services.search._get_memory_container", return_value=fake_container):
        search.cache_search_results("best python tips", [{"title": "A", "url": "https://a", "snippet": "one"}])

    upload_payload = fake_blob_client.upload_blob.call_args.args[0]
    parsed_payload = json.loads(upload_payload)
    assert "timestamp" in parsed_payload
    assert "results" in parsed_payload


# This checks fresh cached data is returned when cache age is under 24 hours.
def test_load_cached_results_returns_results_when_fresh():
    one_hour_ago = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    fake_blob_client = MagicMock()
    fake_blob_client.download_blob.return_value.readall.return_value = json.dumps(
        {
            "query": "best python tips",
            "timestamp": one_hour_ago,
            "results": [{"title": "A", "url": "https://a", "snippet": "one"}],
        }
    ).encode("utf-8")
    fake_container = MagicMock()
    fake_container.get_blob_client.return_value = fake_blob_client

    with patch("app.services.search._get_memory_container", return_value=fake_container):
        results = search.load_cached_results("best python tips")

    assert results == [{"title": "A", "url": "https://a", "snippet": "one"}]


# This checks stale cached data older than 24 hours is treated as expired.
def test_load_cached_results_returns_none_when_expired():
    twenty_five_hours_ago = (datetime.now(UTC) - timedelta(hours=25)).isoformat()
    fake_blob_client = MagicMock()
    fake_blob_client.download_blob.return_value.readall.return_value = json.dumps(
        {
            "query": "best python tips",
            "timestamp": twenty_five_hours_ago,
            "results": [{"title": "A", "url": "https://a", "snippet": "one"}],
        }
    ).encode("utf-8")
    fake_container = MagicMock()
    fake_container.get_blob_client.return_value = fake_blob_client

    with patch("app.services.search._get_memory_container", return_value=fake_container):
        results = search.load_cached_results("best python tips")

    assert results is None


# This checks cache read gracefully returns None when blob does not exist.
def test_load_cached_results_returns_none_when_blob_missing():
    fake_blob_client = MagicMock()
    fake_blob_client.download_blob.side_effect = ResourceNotFoundError("missing")
    fake_container = MagicMock()
    fake_container.get_blob_client.return_value = fake_blob_client

    with patch("app.services.search._get_memory_container", return_value=fake_container):
        results = search.load_cached_results("best python tips")

    assert results is None


# This checks formatting creates a numbered list that includes title and URL.
def test_format_search_context_returns_numbered_list():
    context = search.format_search_context(
        [{"title": "OpenAI", "url": "https://openai.com", "snippet": "AI company"}]
    )

    assert "1." in context
    assert "OpenAI" in context
    assert "https://openai.com" in context


# This checks empty results produce empty prompt context instead of useless text.
def test_format_search_context_returns_empty_string_for_empty_results():
    assert search.format_search_context([]) == ""


# This checks chat includes web search context in model prompt when search is required.
def test_chat_injects_search_results_when_search_needed(chat_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    captured_search_prompt: dict[str, str] = {"value": ""}

    async def fake_generate_model_reply(
        model: str,
        message: str,
        history: list[dict],
        memory_prompt: str = "",
        search_prompt: str = "",
        timeout_seconds: float = 25.0,
    ) -> str:
        del model, message, history, memory_prompt, timeout_seconds
        captured_search_prompt["value"] = search_prompt
        return "search-aware-reply"

    monkeypatch.setattr(chat_service, "generate_model_reply", fake_generate_model_reply)
    monkeypatch.setattr("app.main.should_search", lambda message: True)
    monkeypatch.setattr("app.main.load_cached_results", lambda query: None)
    monkeypatch.setattr("app.main.search_web", lambda query: [{"title": "X", "url": "Y", "snippet": "Z"}])
    monkeypatch.setattr("app.main.cache_search_results", lambda query, results: None)

    response = chat_client.post(
        "/api/chat",
        json={"session_id": "session_1", "message": "latest market updates", "model": "gpt-5", "stream": False},
    )

    assert response.status_code == 200
    assert "Web search results" in captured_search_prompt["value"]


# This checks chat uses fresh cache and skips calling Tavily for duplicate queries.
def test_chat_uses_cache_instead_of_calling_tavily(chat_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    search_web_mock = MagicMock(return_value=[{"title": "X", "url": "Y", "snippet": "Z"}])

    monkeypatch.setattr("app.main.should_search", lambda message: True)
    monkeypatch.setattr("app.main.load_cached_results", lambda query: [{"title": "Cached", "url": "https://cached", "snippet": "hit"}])
    monkeypatch.setattr("app.main.search_web", search_web_mock)

    response = chat_client.post(
        "/api/chat",
        json={"session_id": "session_2", "message": "latest cloud pricing", "model": "gpt-5", "stream": False},
    )

    assert response.status_code == 200
    search_web_mock.assert_not_called()


# This checks chat stays successful when Tavily fails and falls back to normal generation.
def test_chat_continues_without_search_when_tavily_fails(chat_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.main.should_search", lambda message: True)
    monkeypatch.setattr("app.main.load_cached_results", lambda query: None)

    def raise_tavily_error(query: str) -> list[dict[str, str]]:
        raise Exception("Tavily down")

    monkeypatch.setattr("app.main.search_web", raise_tavily_error)

    response = chat_client.post(
        "/api/chat",
        json={"session_id": "session_3", "message": "latest startup news", "model": "gpt-5", "stream": False},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["search_used"] is False


# This checks the stream done chunk includes search metadata for UI badges and sources.
def test_done_chunk_includes_search_metadata(chat_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.main.should_search", lambda message: True)
    monkeypatch.setattr("app.main.load_cached_results", lambda query: None)
    monkeypatch.setattr("app.main.search_web", lambda query: [{"title": "X", "url": "Y", "snippet": "Z"}])
    monkeypatch.setattr("app.main.cache_search_results", lambda query, results: None)

    response = chat_client.post(
        "/api/chat",
        json={"session_id": "session_4", "message": "latest ai policy", "model": "gpt-5", "stream": True},
    )

    assert response.status_code == 200
    chunks = [json.loads(line) for line in response.text.splitlines() if line.strip()]
    done_chunk = chunks[-1]
    assert done_chunk["type"] == "done"
    assert done_chunk["search_used"] is True
    assert isinstance(done_chunk["sources"], list)
