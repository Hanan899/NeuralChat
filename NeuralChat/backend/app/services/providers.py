"""LLM provider routing for Azure OpenAI GPT-5.

Explain this code:
- These functions hide provider-specific HTTP details from the rest of the app.
- Missing provider config returns clear API errors instead of mock replies.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.schemas import ChatModel

AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"


async def generate_reply(
    model: ChatModel,
    message: str,
    history: list[dict[str, Any]],
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
    return await call_azure_openai_chat(message=message, history=history, timeout_seconds=timeout_seconds)

def build_messages(history: list[dict[str, Any]], newest_message: str) -> list[dict[str, str]]:
    filtered: list[dict[str, str]] = []
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


async def call_azure_openai_chat(message: str, history: list[dict[str, Any]], timeout_seconds: float) -> str:
    endpoint = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/")
    api_key = os.environ["AZURE_OPENAI_API_KEY"]
    deployment = os.environ["AZURE_OPENAI_DEPLOYMENT_NAME"]
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT)

    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions"
    params = {"api-version": api_version}
    payload = {
        "messages": build_messages(history=history, newest_message=message),
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
    return text


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
