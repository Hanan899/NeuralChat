from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.cost_tracker import TokenUsage, normalize_usage

from .crypto import load_secret_json
from .models import ModelProvider, ProviderCredential

AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"


class StreamEvent(dict):
    pass


@dataclass
class ProviderRuntime:
    provider: ModelProvider
    secrets: dict[str, Any]
    model_name: str

    @property
    def provider_key(self) -> str:
        return self.provider.provider_key


class ProviderAdapter(Protocol):
    async def chat(
        self,
        runtime: ProviderRuntime,
        messages: list[dict[str, str]],
        timeout_seconds: float,
    ) -> tuple[str, TokenUsage]: ...

    async def stream_chat(
        self,
        runtime: ProviderRuntime,
        messages: list[dict[str, str]],
        timeout_seconds: float,
    ) -> AsyncIterator[dict[str, Any]]: ...

    async def embed(
        self,
        runtime: ProviderRuntime,
        texts: list[str],
        timeout_seconds: float,
    ) -> tuple[list[list[float]], TokenUsage]: ...

    async def test_connection(self, runtime: ProviderRuntime, timeout_seconds: float) -> dict[str, Any]: ...

    def describe_models(self, runtime: ProviderRuntime) -> list[str]: ...


def build_messages(
    history: list[dict[str, Any]],
    newest_message: str,
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
) -> list[dict[str, str]]:
    filtered: list[dict[str, str]] = []
    if memory_prompt.strip():
        filtered.append({"role": "system", "content": memory_prompt.strip()})
    if search_prompt.strip():
        filtered.append({"role": "system", "content": search_prompt.strip()})
    if file_prompt.strip():
        filtered.append({"role": "system", "content": file_prompt.strip()})
    filtered.append({"role": "system", "content": "You are NeuralChat. Give accurate, concise, user-first answers."})
    for entry in history[-8:]:
        role = str(entry.get("role", "")).strip()
        content = str(entry.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            filtered.append({"role": role, "content": content})
    filtered.append({"role": "user", "content": newest_message})
    return filtered


def _extract_message_text(message_object: dict[str, Any]) -> str:
    content = message_object.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text:
                parts.append(text)
        return " ".join(parts).strip()
    return ""


def _extract_delta_text(delta_obj: dict[str, Any]) -> str:
    content = delta_obj.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text:
                parts.append(text)
        return "".join(parts)
    return ""


class AzureOpenAIAdapter:
    async def chat(
        self,
        runtime: ProviderRuntime,
        messages: list[dict[str, str]],
        timeout_seconds: float,
    ) -> tuple[str, TokenUsage]:
        endpoint = str(runtime.provider.base_url or runtime.secrets.get("endpoint") or "").rstrip("/")
        api_key = str(runtime.secrets.get("api_key") or "")
        deployment = str(runtime.secrets.get("deployment") or runtime.model_name or "")
        api_version = str(runtime.provider.api_version or runtime.secrets.get("api_version") or AZURE_OPENAI_API_VERSION_DEFAULT)
        if not endpoint or not api_key or not deployment:
            raise RuntimeError("Azure OpenAI provider is missing endpoint, api_key, or deployment.")

        url = f"{endpoint}/openai/deployments/{deployment}/chat/completions"
        payload = {"messages": messages, "temperature": 0.4}
        headers = {"api-key": api_key, "content-type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(url, params={"api-version": api_version}, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("Azure OpenAI returned no choices.")
        text = _extract_message_text(choices[0].get("message", {}))
        if not text:
            raise RuntimeError("Azure OpenAI returned an empty message.")
        return text, normalize_usage(data.get("usage"))

    async def stream_chat(
        self,
        runtime: ProviderRuntime,
        messages: list[dict[str, str]],
        timeout_seconds: float,
    ) -> AsyncIterator[dict[str, Any]]:
        endpoint = str(runtime.provider.base_url or runtime.secrets.get("endpoint") or "").rstrip("/")
        api_key = str(runtime.secrets.get("api_key") or "")
        deployment = str(runtime.secrets.get("deployment") or runtime.model_name or "")
        api_version = str(runtime.provider.api_version or runtime.secrets.get("api_version") or AZURE_OPENAI_API_VERSION_DEFAULT)
        if not endpoint or not api_key or not deployment:
            raise RuntimeError("Azure OpenAI provider is missing endpoint, api_key, or deployment.")

        url = f"{endpoint}/openai/deployments/{deployment}/chat/completions"
        payload = {
            "messages": messages,
            "temperature": 0.4,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        headers = {"api-key": api_key, "content-type": "application/json"}
        final_usage: TokenUsage = {"input_tokens": 0, "output_tokens": 0}
        timeout = httpx.Timeout(timeout_seconds, connect=15.0, read=timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, params={"api-version": api_version}, json=payload, headers=headers) as response:
                response.raise_for_status()
                async for raw_line in response.aiter_lines():
                    line = raw_line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line.removeprefix("data:").strip()
                    if not data:
                        continue
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    chunk_usage = normalize_usage(chunk.get("usage"))
                    if chunk_usage["input_tokens"] or chunk_usage["output_tokens"]:
                        final_usage = chunk_usage
                    for choice in chunk.get("choices", []):
                        if not isinstance(choice, dict):
                            continue
                        delta = choice.get("delta", {})
                        if not isinstance(delta, dict):
                            continue
                        token = _extract_delta_text(delta)
                        if token:
                            yield {"type": "token", "content": token}
        yield {"type": "usage", "usage": final_usage}

    async def embed(
        self,
        runtime: ProviderRuntime,
        texts: list[str],
        timeout_seconds: float,
    ) -> tuple[list[list[float]], TokenUsage]:
        endpoint = str(runtime.provider.base_url or runtime.secrets.get("endpoint") or "").rstrip("/")
        api_key = str(runtime.secrets.get("api_key") or "")
        deployment = str(runtime.secrets.get("embedding_deployment") or runtime.provider.default_embedding_model or runtime.model_name or "")
        api_version = str(runtime.provider.api_version or runtime.secrets.get("api_version") or AZURE_OPENAI_API_VERSION_DEFAULT)
        if not endpoint or not api_key or not deployment:
            raise RuntimeError("Azure OpenAI embedding provider is missing endpoint, api_key, or deployment.")
        url = f"{endpoint}/openai/deployments/{deployment}/embeddings"
        headers = {"api-key": api_key, "content-type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(url, params={"api-version": api_version}, json={"input": texts}, headers=headers)
            response.raise_for_status()
            data = response.json()
        embeddings: list[list[float]] = []
        for item in data.get("data", []):
            if isinstance(item, dict) and isinstance(item.get("embedding"), list):
                embeddings.append([float(value) for value in item["embedding"]])
        return embeddings, normalize_usage(data.get("usage"))

    async def test_connection(self, runtime: ProviderRuntime, timeout_seconds: float) -> dict[str, Any]:
        text, usage = await self.chat(runtime, [{"role": "user", "content": "Reply with the single word: ok"}], timeout_seconds)
        return {"ok": True, "response": text, "usage": usage}

    def describe_models(self, runtime: ProviderRuntime) -> list[str]:
        return runtime.provider.allowed_models or [runtime.provider.default_chat_model or runtime.model_name]


class UnsupportedProviderAdapter:
    def __init__(self, provider_name: str):
        self.provider_name = provider_name

    async def chat(self, runtime: ProviderRuntime, messages: list[dict[str, str]], timeout_seconds: float) -> tuple[str, TokenUsage]:
        raise RuntimeError(f"{self.provider_name} chat support is scaffolded but not yet enabled in this build.")

    async def stream_chat(self, runtime: ProviderRuntime, messages: list[dict[str, str]], timeout_seconds: float) -> AsyncIterator[dict[str, Any]]:
        raise RuntimeError(f"{self.provider_name} streaming support is scaffolded but not yet enabled in this build.")
        yield {}

    async def embed(self, runtime: ProviderRuntime, texts: list[str], timeout_seconds: float) -> tuple[list[list[float]], TokenUsage]:
        raise RuntimeError(f"{self.provider_name} embedding support is scaffolded but not yet enabled in this build.")

    async def test_connection(self, runtime: ProviderRuntime, timeout_seconds: float) -> dict[str, Any]:
        return {"ok": False, "detail": f"{self.provider_name} is registered but not yet enabled for live calls."}

    def describe_models(self, runtime: ProviderRuntime) -> list[str]:
        return runtime.provider.allowed_models or [runtime.provider.default_chat_model or runtime.model_name]


def get_provider_adapter(provider_key: str) -> ProviderAdapter:
    normalized = provider_key.strip().lower()
    if normalized == "azure_openai":
        return AzureOpenAIAdapter()
    if normalized in {"openai", "anthropic", "gemini", "grok"}:
        return UnsupportedProviderAdapter(normalized)
    raise RuntimeError(f"Unsupported provider '{provider_key}'.")


def _parse_model_id(model_id: str | None) -> tuple[str | None, str | None]:
    clean = str(model_id or "").strip()
    if not clean:
        return None, None
    if ":" not in clean:
        return None, clean
    provider_key, model_name = clean.split(":", 1)
    return provider_key.strip() or None, model_name.strip() or None


def _load_provider_runtime(session: Session, model_id: str | None, *, embeddings: bool = False) -> ProviderRuntime:
    provider_key, explicit_model_name = _parse_model_id(model_id)
    statement = select(ModelProvider).where(ModelProvider.enabled.is_(True))
    if provider_key:
        statement = statement.where(ModelProvider.provider_key == provider_key)
    else:
        default_field = ModelProvider.is_default_embeddings if embeddings else ModelProvider.is_default_chat
        statement = statement.where(default_field.is_(True))

    provider = session.execute(statement.order_by(ModelProvider.created_at.desc())).scalar_one_or_none()
    if provider is None:
        raise RuntimeError("No enabled provider is configured for the requested model.")
    credential = session.execute(
        select(ProviderCredential).where(ProviderCredential.provider_id == provider.id).order_by(ProviderCredential.created_at.desc())
    ).scalar_one_or_none()
    secrets = load_secret_json(credential.secret_payload if credential else "")
    model_name = explicit_model_name or (provider.default_embedding_model if embeddings else provider.default_chat_model) or ""
    if provider.allowed_models and model_name and model_name not in provider.allowed_models:
        raise RuntimeError(f"Model '{model_name}' is not allowed for provider '{provider.provider_key}'.")
    return ProviderRuntime(provider=provider, secrets=secrets, model_name=model_name)


async def chat_with_model(
    session: Session,
    model_id: str | None,
    messages: list[dict[str, str]],
    timeout_seconds: float = 25.0,
) -> tuple[str, TokenUsage, ProviderRuntime]:
    runtime = _load_provider_runtime(session, model_id, embeddings=False)
    adapter = get_provider_adapter(runtime.provider_key)
    text, usage = await adapter.chat(runtime, messages, timeout_seconds)
    return text, usage, runtime


async def stream_chat_with_model(
    session: Session,
    model_id: str | None,
    messages: list[dict[str, str]],
    timeout_seconds: float = 60.0,
) -> AsyncIterator[tuple[dict[str, Any], ProviderRuntime]]:
    runtime = _load_provider_runtime(session, model_id, embeddings=False)
    adapter = get_provider_adapter(runtime.provider_key)
    async for event in adapter.stream_chat(runtime, messages, timeout_seconds):
        yield event, runtime


async def embed_texts(
    session: Session,
    texts: list[str],
    model_id: str | None = None,
    timeout_seconds: float = 60.0,
) -> tuple[list[list[float]], TokenUsage, ProviderRuntime]:
    runtime = _load_provider_runtime(session, model_id, embeddings=True)
    adapter = get_provider_adapter(runtime.provider_key)
    embeddings, usage = await adapter.embed(runtime, texts, timeout_seconds)
    return embeddings, usage, runtime


async def test_provider_connection(session: Session, provider_id: str, timeout_seconds: float = 20.0) -> dict[str, Any]:
    provider = session.get(ModelProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found.")
    credential = session.execute(
        select(ProviderCredential).where(ProviderCredential.provider_id == provider.id).order_by(ProviderCredential.created_at.desc())
    ).scalar_one_or_none()
    runtime = ProviderRuntime(
        provider=provider,
        secrets=load_secret_json(credential.secret_payload if credential else ""),
        model_name=provider.default_chat_model or "",
    )
    adapter = get_provider_adapter(provider.provider_key)
    return await adapter.test_connection(runtime, timeout_seconds)
