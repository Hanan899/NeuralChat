"""LLM provider routing for Claude and GPT-4o.

Explain this code:
- These functions hide provider-specific HTTP details from the rest of the app.
- If API keys are missing, we return a mock response so beginners can still build locally.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from app.schemas import ChatModel

CLAUDE_MODEL = "claude-sonnet-4-5"
OPENAI_MODEL = "gpt-4o"


async def generate_reply(
    model: ChatModel,
    message: str,
    history: list[dict[str, Any]],
    timeout_seconds: float = 25.0,
) -> str:
    if model == "claude" and os.getenv("CLAUDE_API_KEY"):
        return await call_claude(message=message, history=history, timeout_seconds=timeout_seconds)

    if model == "gpt4o" and os.getenv("OPENAI_API_KEY"):
        return await call_openai(message=message, history=history, timeout_seconds=timeout_seconds)

    return mock_response(model=model, message=message)


async def call_claude(message: str, history: list[dict[str, Any]], timeout_seconds: float) -> str:
    api_key = os.environ["CLAUDE_API_KEY"]
    messages = build_messages(history=history, newest_message=message)

    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": 1000,
        "temperature": 0.4,
        "messages": messages,
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    parts = data.get("content", [])
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
    return text.strip() or "Claude returned an empty message."


async def call_openai(message: str, history: list[dict[str, Any]], timeout_seconds: float) -> str:
    api_key = os.environ["OPENAI_API_KEY"]
    messages = build_messages(history=history, newest_message=message)

    payload = {
        "model": OPENAI_MODEL,
        "temperature": 0.4,
        "messages": messages,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "content-type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices", [])
    if not choices:
        return "GPT-4o returned no choices."
    message_obj = choices[0].get("message", {})
    return str(message_obj.get("content", "")).strip() or "GPT-4o returned an empty message."


def build_messages(history: list[dict[str, Any]], newest_message: str) -> list[dict[str, str]]:
    filtered: list[dict[str, str]] = []
    for entry in history[-8:]:
        role = str(entry.get("role", "")).strip()
        content = str(entry.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            filtered.append({"role": role, "content": content})

    filtered.append({"role": "user", "content": newest_message})
    return filtered


def mock_response(model: ChatModel, message: str) -> str:
    return (
        f"[Mock {model}] I received your message: '{message}'. "
        "This is a local training response. Add API keys in backend/local.settings.json "
        "to use real models."
    )
