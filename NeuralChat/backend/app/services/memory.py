"""Deep memory helpers for user profile facts stored in Azure Blob."""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

import httpx
from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContainerClient
from app.services.blob_paths import (
    blob_parts,
    read_blob_text,
    safe_identifier,
    segment_matches_id,
    user_segment,
    write_json_with_migration,
)
from app.services.cost_tracker import (
    TokenUsage,
    get_usage_status,
    log_usage,
    normalize_usage,
    resolve_daily_limit,
    resolve_monthly_limit,
)
from app.services.memory_blob import get_memory_blob_container

AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"
PROFILE_FIELDS = {"name", "job", "city", "preferences", "goals"}
HIDDEN_PROFILE_FIELDS = {"user_id", "display_name", "updated_at", "daily_limit_usd", "monthly_limit_usd", "name_verified"}
MEMORY_PROMPT_SYSTEM = (
    "Extract facts about the current user as JSON only. "
    "Use only explicit self-descriptions from the user's message as source of truth. "
    "Do not infer identity from the assistant reply. "
    "Ignore third-party people, names the user asks about, and guessed identities. "
    "Only set 'name' when the user explicitly states their own name or preferred name. "
    "Keys: name, job, city, preferences, goals. Return {} if nothing should be stored."
)

NAME_PATTERNS = (
    r"\bmy name is\s+(?P<name>[a-zA-Z][a-zA-Z\s'.-]{0,80})",
    r"\bi am\s+(?P<name>[a-zA-Z][a-zA-Z\s'.-]{0,80})",
    r"\bi'm\s+(?P<name>[a-zA-Z][a-zA-Z\s'.-]{0,80})",
    r"\bcall me\s+(?P<name>[a-zA-Z][a-zA-Z\s'.-]{0,80})",
)


# This helper opens the profile container using current runtime environment values.
def _get_profiles_container() -> ContainerClient:
    container_name = os.getenv("AZURE_BLOB_PROFILES_CONTAINER", "neurarchat-profiles").strip() or "neurarchat-profiles"
    if os.getenv("NEURALCHAT_STORAGE_MODE", "").strip().lower() == "memory":
        return get_memory_blob_container(container_name)  # type: ignore[return-value]

    connection_string = (
        os.getenv("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        or os.getenv("AzureWebJobsStorage", "").strip()
    )
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage is required.")
    blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    return blob_service_client.get_container_client(container_name)


# This helper builds the profile blob path for a user.
def _profile_blob_name(user_id: str, display_name: str | None = None) -> str:
    return f"profiles/{user_segment(user_id, display_name)}.json"


# This helper builds the legacy profile blob path used before readable naming.
def _legacy_profile_blob_name(user_id: str) -> str:
    return f"profiles/{safe_identifier(user_id)}.json"


# This helper finds an existing profile blob for a user in either old or new naming formats.
def _find_existing_profile_blob(profiles_container: ContainerClient, user_id: str) -> str | None:
    legacy_blob_name = _legacy_profile_blob_name(user_id)
    if read_blob_text(profiles_container, legacy_blob_name) is not None:
        return legacy_blob_name

    for blob_item in profiles_container.list_blobs(name_starts_with="profiles/"):
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if len(parts) != 2 or parts[0] != "profiles":
            continue
        blob_stem = parts[1].removesuffix(".json")
        if segment_matches_id(blob_stem, user_id):
            return blob_name
    return None


# This helper extracts plain text from Azure OpenAI message formats.
def _extract_message_text(message_object: dict[str, Any]) -> str:
    content = message_object.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_parts: list[str] = []
        for content_item in content:
            if isinstance(content_item, dict):
                text_value = content_item.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    text_parts.append(text_value.strip())
        return " ".join(text_parts).strip()
    return ""


def _normalize_whitespace(value: str) -> str:
    return " ".join(value.split()).strip()


def _normalize_name(value: Any) -> str:
    cleaned = re.sub(r"[^a-zA-Z\s'.-]", " ", str(value or ""))
    cleaned = _normalize_whitespace(cleaned)
    return cleaned


def _name_tokens(value: Any) -> list[str]:
    normalized = _normalize_name(value).lower()
    return [token for token in normalized.split(" ") if token]


def _message_explicit_name(message: str) -> str | None:
    normalized_message = _normalize_whitespace(str(message or ""))
    if not normalized_message:
        return None

    for pattern in NAME_PATTERNS:
        matched = re.search(pattern, normalized_message, flags=re.IGNORECASE)
        if not matched:
            continue
        candidate_name = _normalize_name(matched.group("name"))
        if candidate_name:
            return candidate_name
    return None


def _name_matches_display_name(name: str, display_name: str | None) -> bool:
    if not name or not display_name:
        return False
    name_token_set = set(_name_tokens(name))
    display_token_set = set(_name_tokens(display_name))
    if not name_token_set or not display_token_set:
        return False
    return name_token_set <= display_token_set or display_token_set <= name_token_set


def _sanitize_profile_name(
    candidate_name: Any,
    message: str,
    display_name: str | None,
    existing_profile: dict[str, Any] | None = None,
) -> tuple[str | None, bool]:
    normalized_name = _normalize_name(candidate_name)
    if not normalized_name:
        return None, False

    explicit_name = _message_explicit_name(message)
    if explicit_name and _normalize_name(explicit_name).lower() == normalized_name.lower():
        return normalized_name, True

    existing_name = _normalize_name((existing_profile or {}).get("name"))
    existing_name_verified = bool((existing_profile or {}).get("name_verified"))
    if existing_name_verified and existing_name and existing_name.lower() != normalized_name.lower():
        return None, False

    if _name_matches_display_name(normalized_name, display_name):
        return normalized_name, existing_name_verified or bool(existing_name and existing_name.lower() == normalized_name.lower())

    return None, False


def _sanitize_extracted_facts(
    extracted_facts: dict[str, Any],
    message: str,
    display_name: str | None,
    existing_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sanitized_facts: dict[str, Any] = {}
    for field_name in PROFILE_FIELDS:
        if field_name not in extracted_facts or extracted_facts[field_name] in (None, ""):
            continue
        if field_name == "name":
            trusted_name, name_verified = _sanitize_profile_name(
                extracted_facts[field_name],
                message,
                display_name,
                existing_profile,
            )
            if trusted_name:
                sanitized_facts["name"] = trusted_name
                if name_verified:
                    sanitized_facts["name_verified"] = True
            continue
        sanitized_facts[field_name] = extracted_facts[field_name]
    return sanitized_facts


def _should_include_profile_name(profile_data: dict[str, Any], display_name: str | None) -> bool:
    profile_name = _normalize_name(profile_data.get("name"))
    if not profile_name:
        return False
    if bool(profile_data.get("name_verified")):
        return True
    return _name_matches_display_name(profile_name, display_name)


# This helper writes a full profile object into blob storage and migrates old blob names lazily.
def _write_profile(user_id: str, profile_data: dict[str, Any], display_name: str | None = None) -> None:
    profiles_container = _get_profiles_container()
    canonical_blob_name = _profile_blob_name(user_id, display_name)
    existing_blob_name = _find_existing_profile_blob(profiles_container, user_id)
    write_json_with_migration(
        profiles_container,
        canonical_blob_name,
        profile_data,
        old_blob_name=existing_blob_name,
    )


# This function loads one user profile from blob and safely returns {} when missing/corrupt.
def load_profile(user_id: str, display_name: str | None = None) -> dict[str, Any]:
    profiles_container = _get_profiles_container()
    canonical_blob_name = _profile_blob_name(user_id, display_name)
    existing_blob_name = _find_existing_profile_blob(profiles_container, user_id)
    if existing_blob_name is None:
        return {}
    raw_profile = read_blob_text(profiles_container, existing_blob_name)
    if raw_profile is None:
        return {}

    try:
        parsed_profile = json.loads(raw_profile)
    except json.JSONDecodeError:
        return {}

    if isinstance(parsed_profile, dict):
        parsed_profile.setdefault("user_id", user_id)
        parsed_profile.setdefault("display_name", display_name or user_id)
        if "name" in parsed_profile and not _should_include_profile_name(parsed_profile, display_name):
            parsed_profile = dict(parsed_profile)
            parsed_profile.pop("name", None)
            parsed_profile.pop("name_verified", None)
        if existing_blob_name != canonical_blob_name:
            _write_profile(user_id, parsed_profile, display_name)
        return parsed_profile
    return {}


# This function merges existing facts with incoming facts and saves the merged profile back.
def save_profile(user_id: str, facts: dict, display_name: str | None = None) -> None:
    existing_profile = load_profile(user_id, display_name)
    merged_profile = dict(existing_profile)
    merged_profile.update(facts)
    if "name" not in facts and "name_verified" in merged_profile:
        merged_profile["name_verified"] = bool(existing_profile.get("name_verified"))
    merged_profile["user_id"] = user_id
    merged_profile["display_name"] = display_name or merged_profile.get("display_name") or user_id
    _write_profile(user_id, merged_profile, display_name)


# This function asks GPT-5 to extract profile facts from one user/assistant exchange and returns usage too.
def extract_facts_with_usage(message: str, reply: str) -> tuple[dict[str, Any], TokenUsage]:
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip().rstrip("/")
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
    if not endpoint or not api_key or not deployment_name:
        return {}, {"input_tokens": 0, "output_tokens": 0}

    api_version = os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT)
    request_url = f"{endpoint}/openai/deployments/{deployment_name}/chat/completions"
    query_params = {"api-version": api_version}
    request_headers = {"api-key": api_key, "content-type": "application/json"}
    request_payload = {
        "messages": [
            {"role": "system", "content": MEMORY_PROMPT_SYSTEM},
            {
                "role": "user",
                "content": (
                    "Conversation exchange:\n"
                    f"User message: {message}\n"
                    f"Assistant reply: {reply}\n"
                    "Return JSON only."
                ),
            },
        ],
        "temperature": 0,
        "max_tokens": 200,
    }

    try:
        with httpx.Client(timeout=12.0) as http_client:
            # COST NOTE: This GPT extraction call is intentionally short (max_tokens=200) to keep memory costs low.
            response = http_client.post(
                request_url,
                params=query_params,
                json=request_payload,
                headers=request_headers,
            )
            response.raise_for_status()
            response_data = response.json()
    except Exception:
        return {}, {"input_tokens": 0, "output_tokens": 0}

    usage = normalize_usage(response_data.get("usage"))

    choices = response_data.get("choices", [])
    if not choices:
        return {}, usage
    message_object = choices[0].get("message", {})
    response_text = _extract_message_text(message_object)
    if not response_text:
        return {}, usage

    try:
        parsed_facts = json.loads(response_text)
    except json.JSONDecodeError:
        return {}, usage

    if not isinstance(parsed_facts, dict):
        return {}, usage

    normalized_facts: dict[str, Any] = {}
    for field_name in PROFILE_FIELDS:
        if field_name in parsed_facts and parsed_facts[field_name] not in (None, ""):
            normalized_facts[field_name] = parsed_facts[field_name]
    return normalized_facts, usage


# This function keeps the older facts-only interface for call sites that do not need usage details.
def extract_facts(message: str, reply: str) -> dict[str, Any]:
    facts, _usage = extract_facts_with_usage(message, reply)
    return facts


# This function builds a compact memory sentence for prompt injection and returns "" when profile is empty.
def build_memory_prompt(user_id: str, display_name: str | None = None) -> str:
    profile_data = load_profile(user_id, display_name)
    prompt_lines: list[str] = []
    if display_name:
        prompt_lines.append(
            f"Authenticated user display name: {display_name}. "
            "Do not call the user by any other name unless they explicitly tell you to."
        )
    if not profile_data:
        return "\n".join(prompt_lines).strip()

    formatted_items: list[str] = []
    for field_name in sorted(profile_data.keys()):
        if field_name in HIDDEN_PROFILE_FIELDS:
            continue
        if field_name == "name" and not _should_include_profile_name(profile_data, display_name):
            continue
        field_value = profile_data.get(field_name)
        if field_value in (None, ""):
            continue
        formatted_items.append(f"{field_name}={field_value}")

    if formatted_items:
        prompt_lines.append(f"What I know about you: {', '.join(formatted_items)}")
    return "\n".join(prompt_lines).strip()


# This function updates one profile key and supports single-key deletion when value is empty.
def upsert_profile_key(user_id: str, key: str, value: str, display_name: str | None = None) -> dict[str, Any]:
    existing_profile = load_profile(user_id, display_name)
    updated_profile = dict(existing_profile)
    normalized_key = str(key or "").strip()

    if value.strip():
        updated_profile[normalized_key] = value
        if normalized_key == "name":
            updated_profile["name_verified"] = True
    else:
        updated_profile.pop(normalized_key, None)
        if normalized_key == "name":
            updated_profile.pop("name_verified", None)

    updated_profile["user_id"] = user_id
    updated_profile["display_name"] = display_name or updated_profile.get("display_name") or user_id
    _write_profile(user_id, updated_profile, display_name)
    return updated_profile


# This function deletes the entire profile blob for one user.
def clear_profile(user_id: str, display_name: str | None = None) -> None:
    profiles_container = _get_profiles_container()
    existing_blob_name = _find_existing_profile_blob(profiles_container, user_id)
    if not existing_blob_name:
        return
    profile_blob_client = profiles_container.get_blob_client(blob=existing_blob_name)
    try:
        profile_blob_client.delete_blob(delete_snapshots="include")
    except ResourceNotFoundError:
        return


# This async wrapper offloads extraction and save operations so chat streaming remains fast.
async def process_memory_update(user_id: str, message: str, reply: str, display_name: str | None = None) -> None:
    current_profile = await asyncio.to_thread(load_profile, user_id, display_name)
    usage_status = await asyncio.to_thread(
        get_usage_status,
        user_id,
        resolve_daily_limit(current_profile),
        resolve_monthly_limit(current_profile),
        "memory",
        display_name,
    )
    if usage_status["blocked"]:
        return

    extracted_facts, usage = await asyncio.to_thread(extract_facts_with_usage, message, reply)
    if usage["input_tokens"] or usage["output_tokens"]:
        await asyncio.to_thread(
            log_usage,
            user_id,
            "memory",
            usage["input_tokens"],
            usage["output_tokens"],
            display_name,
        )
    extracted_facts = _sanitize_extracted_facts(extracted_facts, message, display_name, current_profile)
    if not extracted_facts:
        return
    await asyncio.to_thread(save_profile, user_id, extracted_facts, display_name)
