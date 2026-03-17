"""Conversation title helpers for clean, readable chat names.

These helpers support a hybrid strategy:
- fast local fallback logic for reliability
- optional GPT refinement for higher quality titles
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

from app.services.cost_tracker import TokenUsage, normalize_usage

AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"
TITLE_PROMPT_SYSTEM = (
    "Create a concise conversation title in 3 to 6 words. "
    "Use summary style, not question style. "
    "Avoid quotes, punctuation-heavy output, and filler phrases. "
    'Return JSON only: {"title":"..."}'
)
GENERIC_PREFIXES = (
    "can you ",
    "could you ",
    "would you ",
    "please ",
    "help me ",
    "tell me ",
    "explain ",
    "i want ",
    "i need ",
)
STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "do",
    "for",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "please",
    "tell",
    "that",
    "the",
    "this",
    "to",
    "what",
    "who",
    "with",
    "you",
}
UPPERCASE_WORDS = {"ai", "api", "gpt", "pdf", "ui", "ux"}


# This helper normalizes whitespace and strips noisy punctuation from raw text.
def _clean_text(raw_text: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(raw_text or "").strip())
    cleaned = cleaned.strip("\"'` ")
    return cleaned


# This helper removes polite opener phrases so titles start with the actual topic.
def _strip_generic_prefixes(prompt: str) -> str:
    lowered = prompt.lower()
    for prefix in GENERIC_PREFIXES:
        if lowered.startswith(prefix):
            return prompt[len(prefix) :].strip()
    return prompt


# This helper converts a compact list of words into a readable title-cased string.
def _format_title_words(words: list[str]) -> str:
    formatted_words: list[str] = []
    for word in words:
        if not word:
            continue
        if word.lower() in UPPERCASE_WORDS:
            formatted_words.append(word.upper())
        elif any(character.isdigit() for character in word):
            formatted_words.append(word.upper() if len(word) <= 4 else word.capitalize())
        else:
            formatted_words.append(word.capitalize())
    return " ".join(formatted_words).strip()


# This helper creates a deterministic local fallback title when GPT is unavailable or unnecessary.
def fallback_conversation_title(prompt: str, reply: str = "") -> str:
    normalized_prompt = _strip_generic_prefixes(_clean_text(prompt))
    normalized_reply = _clean_text(reply)

    if normalized_prompt.lower().find("document") >= 0 or normalized_prompt.lower().find("attached") >= 0:
        if "prd" in normalized_prompt.lower():
            return "PRD Document Review"
        return "Document Review"

    if "api latency" in normalized_prompt.lower():
        return "API Latency Debugging"

    if "readme" in normalized_prompt.lower():
        return "README Writing"

    source_text = normalized_prompt or normalized_reply
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9.+-]*", source_text)
    meaningful_words = [token for token in tokens if token.lower() not in STOP_WORDS]

    if len(meaningful_words) >= 3:
        return _format_title_words(meaningful_words[:5]) or "New chat"

    if tokens:
        return _format_title_words(tokens[:5]) or "New chat"

    return "New chat"


# This helper normalizes GPT output so titles stay short, clean, and readable.
def sanitize_conversation_title(raw_title: str, prompt: str, reply: str = "") -> str:
    cleaned = _clean_text(raw_title)
    cleaned = re.sub(r"^[#*:\-–—\s]+", "", cleaned)
    cleaned = cleaned[:80].strip(" .,:;!?-")

    if not cleaned:
        return fallback_conversation_title(prompt, reply)

    words = cleaned.split()
    if len(words) > 6:
        cleaned = " ".join(words[:6])

    return cleaned or fallback_conversation_title(prompt, reply)


# This helper asks Azure OpenAI for a short refined title and falls back safely on failure.
def generate_conversation_title_with_usage(prompt: str, reply: str = "") -> tuple[str, TokenUsage]:
    normalized_prompt = _clean_text(prompt)
    normalized_reply = _clean_text(reply)
    fallback_title = fallback_conversation_title(normalized_prompt, normalized_reply)

    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip().rstrip("/")
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
    if not endpoint or not api_key or not deployment_name:
        return fallback_title, {"input_tokens": 0, "output_tokens": 0}

    api_version = os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT)
    request_url = f"{endpoint}/openai/deployments/{deployment_name}/chat/completions"
    request_headers = {"api-key": api_key, "content-type": "application/json"}
    request_payload = {
        "messages": [
            {"role": "system", "content": TITLE_PROMPT_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"User prompt: {normalized_prompt}\n"
                    f"Assistant reply: {normalized_reply}\n"
                    "Create the best short title for this conversation."
                ),
            },
        ],
        "temperature": 0.2,
        "max_tokens": 40,
    }

    try:
        with httpx.Client(timeout=12.0) as http_client:
            response = http_client.post(
                request_url,
                params={"api-version": api_version},
                json=request_payload,
                headers=request_headers,
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return fallback_title, {"input_tokens": 0, "output_tokens": 0}

    usage = normalize_usage(payload.get("usage"))

    choices = payload.get("choices", [])
    if not choices:
        return fallback_title, usage

    message_object = choices[0].get("message", {})
    content = message_object.get("content", "")
    if isinstance(content, list):
        content = " ".join(
            item.get("text", "").strip()
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ).strip()
    if not isinstance(content, str) or not content.strip():
        return fallback_title, usage

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return fallback_title, usage

    if not isinstance(parsed, dict):
        return fallback_title, usage

    raw_title = str(parsed.get("title", "")).strip()
    return sanitize_conversation_title(raw_title, normalized_prompt, normalized_reply), usage


# This helper keeps the older title-only interface for call sites that do not need usage details.
def generate_conversation_title(prompt: str, reply: str = "") -> str:
    title, _usage = generate_conversation_title_with_usage(prompt, reply)
    return title
