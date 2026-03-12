"""LLM provider routing for Azure OpenAI GPT-5.

Explain this code:
- These functions hide provider-specific HTTP details from the rest of the app.
- Missing provider config returns clear API errors instead of mock replies.
"""

from __future__ import annotations

import json
import os
from typing import Any
from typing import AsyncIterator

import httpx
from fastapi import HTTPException, status

from app.schemas import ChatModel
from app.services.search import BASE_INSTRUCTIONS

AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"


async def generate_reply(
    model: ChatModel,
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 25.0,
) -> str:
    del model
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


async def generate_reply_stream(
    model: ChatModel,
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 60.0,
) -> AsyncIterator[str]:
    del model
    if not has_azure_openai_config():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, "
                "AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT_NAME."
            ),
        )
    async for token in stream_azure_openai_chat(
        message=message,
        history=history,
        memory_prompt=memory_prompt,
        search_prompt=search_prompt,
        file_prompt=file_prompt,
        timeout_seconds=timeout_seconds,
    ):
        yield token


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


def has_azure_openai_config() -> bool:
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
    return bool(endpoint and api_key and deployment)


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


async def call_azure_openai_chat(
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 25.0,
) -> str:
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
            # COST NOTE: This Azure OpenAI request is billed by prompt + completion tokens.
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
    return text


async def stream_azure_openai_chat(
    message: str,
    history: list[dict[str, Any]],
    memory_prompt: str = "",
    search_prompt: str = "",
    file_prompt: str = "",
    timeout_seconds: float = 60.0,
) -> AsyncIterator[str]:
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
    }
    headers = {
        "api-key": api_key,
        "content-type": "application/json",
    }

    try:
        timeout = httpx.Timeout(timeout_seconds, connect=15.0, read=timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            # COST NOTE: This Azure OpenAI streaming request is billed by prompt + completion tokens.
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
                    for choice in chunk.get("choices", []):
                        if not isinstance(choice, dict):
                            continue
                        delta = choice.get("delta", {})
                        if not isinstance(delta, dict):
                            continue
                        token = extract_delta_text(delta)
                        if token:
                            yield token
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


def extract_message_text(message_obj: dict[str, Any]) -> str:
    content = message_obj.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return " ".join(parts).strip()
    return ""
