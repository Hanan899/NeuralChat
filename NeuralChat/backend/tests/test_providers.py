from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from app.services import providers


def test_gpt5_uses_azure_when_config_exists(monkeypatch: pytest.MonkeyPatch):
    async def fake_azure(
        message: str,
        history: list[dict],
        memory_prompt: str = "",
        search_prompt: str = "",
        timeout_seconds: float = 25.0,
    ):
        del message, history, timeout_seconds
        return f"azure-ok:{memory_prompt}:{search_prompt}"

    monkeypatch.setattr(providers, "call_azure_openai_chat", fake_azure)
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "key")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-chat")

    reply = asyncio.run(
        providers.generate_reply(
            model="gpt-5",
            message="hello",
            history=[],
            memory_prompt="name=Ali",
            search_prompt="Web search results:\\n1. [OpenAI](https://openai.com)",
        )
    )
    assert "azure-ok:name=Ali:Web search results" in reply


def test_gpt5_raises_503_when_azure_missing(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)
    monkeypatch.delenv("AZURE_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AZURE_OPENAI_DEPLOYMENT_NAME", raising=False)

    with pytest.raises(HTTPException) as exception_info:
        asyncio.run(providers.generate_reply(model="gpt-5", message="hello", history=[]))

    assert exception_info.value.status_code == 503
    assert "Azure OpenAI is not configured" in str(exception_info.value.detail)


def test_build_messages_injects_memory_prompt():
    payload = providers.build_messages(
        history=[{"role": "assistant", "content": "Hi"}],
        newest_message="Tell me more",
        memory_prompt="What I know about you: name=Ali",
        search_prompt="Web search results:\\n1. [OpenAI](https://openai.com)",
    )
    assert payload[0]["role"] == "system"
    assert "name=Ali" in payload[0]["content"]
    assert payload[1]["role"] == "system"
    assert "Web search results" in payload[1]["content"]
