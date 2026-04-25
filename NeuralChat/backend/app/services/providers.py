"""LLM provider routing for Azure OpenAI GPT-5.

These helpers hide provider-specific HTTP details from the rest of the app and
return a consistent text + usage shape for every billed GPT call.
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator, TypedDict

import httpx
from fastapi import HTTPException, status

from app.schemas import ChatModel
from app.services.cost_tracker import TokenUsage, normalize_usage
from app.services.search import BASE_INSTRUCTIONS

AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"


class ChatCompletionResult(TypedDict):
    text: str
    usage: TokenUsage


class StreamEvent(TypedDict, total=False):
    type: str
    content: str
    usage: TokenUsage


# This function returns the chat reply text only for older call sites that do not need usage details.
async def generate_reply(
    model: ChatModel,
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 25.0,
) -> str:
    result = await generate_reply_with_usage(
        model=model,
        message=message,
        history=history,
        memory_prompt=memory_prompt,
        search_prompt=search_prompt,
        file_prompt=file_prompt,
        timeout_seconds=timeout_seconds,
    )
    return result["text"]


# This function returns reply text together with input/output token usage for cost tracking.
async def generate_reply_with_usage(
    model: ChatModel,
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 25.0,
) -> ChatCompletionResult:
    if str(model).strip() != "gpt-5":
        return await _generate_reply_with_platform_registry(
            model=str(model),
            message=message,
            history=history,
            memory_prompt=memory_prompt,
            search_prompt=search_prompt,
            file_prompt=file_prompt,
            timeout_seconds=timeout_seconds,
        )
    if not has_azure_openai_config():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, "
                "AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT_NAME."
            ),
        )
    return await call_azure_openai_chat(
        message=message,
        history=history,
        memory_prompt=memory_prompt,
        search_prompt=search_prompt,
        file_prompt=file_prompt,
        timeout_seconds=timeout_seconds,
    )


# This function yields token-only events for older call sites that do not need usage details.
async def generate_reply_stream(
    model: ChatModel,
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 60.0,
) -> AsyncIterator[str]:
    async for event in generate_reply_stream_with_usage(
        model=model,
        message=message,
        history=history,
        memory_prompt=memory_prompt,
        search_prompt=search_prompt,
        file_prompt=file_prompt,
        timeout_seconds=timeout_seconds,
    ):
        if event["type"] == "token":
            yield event["content"]


# This function streams token events and ends with one usage event for cost tracking.
async def generate_reply_stream_with_usage(
    model: ChatModel,
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 60.0,
) -> AsyncIterator[StreamEvent]:
    if str(model).strip() != "gpt-5":
        async for event in _generate_reply_stream_with_platform_registry(
            model=str(model),
            message=message,
            history=history,
            memory_prompt=memory_prompt,
            search_prompt=search_prompt,
            file_prompt=file_prompt,
            timeout_seconds=timeout_seconds,
        ):
            yield event
        return
    if not has_azure_openai_config():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, "
                "AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT_NAME."
            ),
        )
    async for event in stream_azure_openai_chat(
        message=message,
        history=history,
        memory_prompt=memory_prompt,
        search_prompt=search_prompt,
        file_prompt=file_prompt,
        timeout_seconds=timeout_seconds,
    ):
        yield event


async def _generate_reply_with_platform_registry(
    model: str,
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 25.0,
) -> ChatCompletionResult:
    try:
        from app.platform.db import get_platform_session_factory
        from app.platform.providers import build_messages as build_platform_messages, chat_with_model
    except Exception as error:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Platform provider registry is unavailable: {error}",
        ) from error

    session_factory = get_platform_session_factory()
    with session_factory() as session:
        text, usage, _runtime = await chat_with_model(
            session,
            model,
            build_platform_messages(
                history=history,
                newest_message=message,
                memory_prompt=memory_prompt,
                search_prompt=search_prompt,
                file_prompt=file_prompt,
            ),
            timeout_seconds=timeout_seconds,
        )
    return {"text": text, "usage": usage}


async def _generate_reply_stream_with_platform_registry(
    model: str,
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 60.0,
) -> AsyncIterator[StreamEvent]:
    try:
        from app.platform.db import get_platform_session_factory
        from app.platform.providers import build_messages as build_platform_messages, stream_chat_with_model
    except Exception as error:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Platform provider registry is unavailable: {error}",
        ) from error

    session_factory = get_platform_session_factory()
    with session_factory() as session:
        async for event, _runtime in stream_chat_with_model(
            session,
            model,
            build_platform_messages(
                history=history,
                newest_message=message,
                memory_prompt=memory_prompt,
                search_prompt=search_prompt,
                file_prompt=file_prompt,
            ),
            timeout_seconds=timeout_seconds,
        ):
            yield event


# This helper builds the provider message list from memory, search, file context, history, and newest input.
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
    filtered.append({"role": "system", "content": BASE_INSTRUCTIONS})
    for entry in history[-8:]:
        role = str(entry.get("role", "")).strip()
        content = str(entry.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            filtered.append({"role": role, "content": content})

    filtered.append({"role": "user", "content": newest_message})
    return filtered


# This helper checks whether the Azure OpenAI environment is ready for a real GPT request.
def has_azure_openai_config() -> bool:
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
    return bool(endpoint and api_key and deployment)


# This helper extracts delta text from one Azure streaming chunk choice.
def extract_delta_text(delta_obj: dict[str, Any]) -> str:
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


# This helper extracts plain message text from a non-stream Azure OpenAI response message object.
def extract_message_text(message_object: dict[str, Any]) -> str:
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


# This function performs one Azure OpenAI chat completion request and returns text plus usage.
async def call_azure_openai_chat(
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 25.0,
) -> ChatCompletionResult:
    endpoint = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/")
    api_key = os.environ["AZURE_OPENAI_API_KEY"]
    deployment = os.environ["AZURE_OPENAI_DEPLOYMENT_NAME"]
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT)

    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions"
    params = {"api-version": api_version}
    payload = {
        "messages": build_messages(
            history=history,
            newest_message=message,
            memory_prompt=memory_prompt,
            search_prompt=search_prompt,
            file_prompt=file_prompt,
        ),
        "temperature": 0.4,
    }
    headers = {
        "api-key": api_key,
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(url, params=params, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Azure OpenAI request failed: {error.response.status_code}.",
        ) from error
    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Azure OpenAI request failed: {error}.",
        ) from error

    choices = data.get("choices", [])
    if not choices:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Azure OpenAI returned no choices.",
        )
    message_obj = choices[0].get("message", {})
    text = extract_message_text(message_obj)
    if not text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Azure OpenAI returned an empty message.",
        )
    return {"text": text, "usage": normalize_usage(data.get("usage"))}


# This function streams Azure OpenAI tokens and yields a final usage event when available.
async def stream_azure_openai_chat(
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 60.0,
) -> AsyncIterator[StreamEvent]:
    endpoint = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/")
    api_key = os.environ["AZURE_OPENAI_API_KEY"]
    deployment = os.environ["AZURE_OPENAI_DEPLOYMENT_NAME"]
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT)

    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions"
    params = {"api-version": api_version}
    payload = {
        "messages": build_messages(
            history=history,
            newest_message=message,
            memory_prompt=memory_prompt,
            search_prompt=search_prompt,
            file_prompt=file_prompt,
        ),
        "temperature": 0.4,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    headers = {
        "api-key": api_key,
        "content-type": "application/json",
    }
    final_usage: TokenUsage = {"input_tokens": 0, "output_tokens": 0}

    try:
        timeout = httpx.Timeout(timeout_seconds, connect=15.0, read=timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, params=params, json=payload, headers=headers) as response:
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
                        token = extract_delta_text(delta)
                        if token:
                            yield {"type": "token", "content": token}
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Azure OpenAI streaming request failed: {error.response.status_code}.",
        ) from error
    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Azure OpenAI streaming request failed: {error}.",
        ) from error

    yield {"type": "usage", "usage": final_usage}
