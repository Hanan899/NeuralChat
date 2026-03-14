"""Deep memory helpers for user profile facts stored in Azure Blob."""

from __future__ import annotations

import asyncio
import json
import os
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

AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"
PROFILE_FIELDS = {"name", "job", "city", "preferences", "goals"}
MEMORY_PROMPT_SYSTEM = (
    "Extract facts about the user as JSON only. "
    "Keys: name, job, city, preferences, goals. Return {} if nothing found."
)


# This helper opens the profile container using current runtime environment values.
def _get_profiles_container() -> ContainerClient:
    connection_string = (
        os.getenv("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        or os.getenv("AzureWebJobsStorage", "").strip()
    )
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage is required.")
    container_name = os.getenv("AZURE_BLOB_PROFILES_CONTAINER", "neurarchat-profiles").strip() or "neurarchat-profiles"
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
        if existing_blob_name != canonical_blob_name:
            _write_profile(user_id, parsed_profile, display_name)
        return parsed_profile
    return {}


# This function merges existing facts with incoming facts and saves the merged profile back.
def save_profile(user_id: str, facts: dict, display_name: str | None = None) -> None:
    existing_profile = load_profile(user_id, display_name)
    merged_profile = dict(existing_profile)
    merged_profile.update(facts)
    merged_profile["user_id"] = user_id
    merged_profile["display_name"] = display_name or merged_profile.get("display_name") or user_id
    _write_profile(user_id, merged_profile, display_name)


# This function asks GPT-5 to extract profile facts from one user/assistant exchange.
def extract_facts(message: str, reply: str) -> dict[str, Any]:
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip().rstrip("/")
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
    if not endpoint or not api_key or not deployment_name:
        return {}

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
        return {}

    choices = response_data.get("choices", [])
    if not choices:
        return {}
    message_object = choices[0].get("message", {})
    response_text = _extract_message_text(message_object)
    if not response_text:
        return {}

    try:
        parsed_facts = json.loads(response_text)
    except json.JSONDecodeError:
        return {}

    if not isinstance(parsed_facts, dict):
        return {}

    normalized_facts: dict[str, Any] = {}
    for field_name in PROFILE_FIELDS:
        if field_name in parsed_facts and parsed_facts[field_name] not in (None, ""):
            normalized_facts[field_name] = parsed_facts[field_name]
    return normalized_facts


# This function builds a compact memory sentence for prompt injection and returns "" when profile is empty.
def build_memory_prompt(user_id: str, display_name: str | None = None) -> str:
    profile_data = load_profile(user_id, display_name)
    if not profile_data:
        return ""

    formatted_items: list[str] = []
    for field_name in sorted(profile_data.keys()):
        if field_name in {"user_id", "display_name", "updated_at"}:
            continue
        field_value = profile_data.get(field_name)
        if field_value in (None, ""):
            continue
        formatted_items.append(f"{field_name}={field_value}")

    if not formatted_items:
        return ""
    return f"What I know about you: {', '.join(formatted_items)}"


# This function updates one profile key and supports single-key deletion when value is empty.
def upsert_profile_key(user_id: str, key: str, value: str, display_name: str | None = None) -> dict[str, Any]:
    existing_profile = load_profile(user_id, display_name)
    updated_profile = dict(existing_profile)

    if value.strip():
        updated_profile[key] = value
    else:
        updated_profile.pop(key, None)

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
    extracted_facts = await asyncio.to_thread(extract_facts, message, reply)
    if not extracted_facts:
        return
    await asyncio.to_thread(save_profile, user_id, extracted_facts, display_name)
