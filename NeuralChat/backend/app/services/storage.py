"""Storage helpers for user-scoped conversation persistence.

Production/default mode writes to Azure Blob Storage.
Test mode can use in-memory storage by setting NEURALCHAT_STORAGE_MODE=memory.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContainerClient
from app.services.blob_paths import (
    blob_parts,
    read_blob_text,
    safe_identifier,
    segment_matches_id,
    session_segment,
    user_segment,
    write_json_with_migration,
)
from app.services.titles import fallback_conversation_title

_STORE_LOCK = Lock()
_MEMORY_STORE: dict[str, list[dict[str, Any]]] = {}
_MEMORY_PROFILES: dict[str, dict[str, Any]] = {}


def _extract_stable_id_from_segment(segment_value: str) -> str:
    normalized = str(segment_value or "").strip()
    if "__" in normalized:
        return normalized.rsplit("__", 1)[-1]
    return normalized.removesuffix(".json")


def _build_conversation_summary(session_id: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_messages = [message for message in messages if isinstance(message, dict)]
    latest_message = normalized_messages[-1] if normalized_messages else {}
    first_user_message = next(
        (
            message
            for message in normalized_messages
            if str(message.get("role", "")).strip() == "user" and str(message.get("content", "")).strip()
        ),
        {},
    )
    title_candidate = str(latest_message.get("session_title", "") or "").strip() or str(first_user_message.get("session_title", "") or "").strip()
    prompt_for_title = str(first_user_message.get("content", "") or "").strip()
    preview_source = next(
        (
            str(message.get("content", "") or "").strip()
            for message in reversed(normalized_messages)
            if str(message.get("content", "") or "").strip()
        ),
        "",
    )
    preview = preview_source[:200]
    updated_at = str(latest_message.get("created_at", "") or "").strip() or ""
    title = title_candidate or fallback_conversation_title(prompt_for_title, preview_source)

    return {
        "id": session_id,
        "title": title or "New chat",
        "preview": preview,
        "updatedAt": updated_at,
        "archived": False,
    }


def list_conversation_summaries(
    store: dict[str, Any],
    user_id: str,
    display_name: str | None = None,
) -> list[dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}

    if store["mode"] == "memory":
        for blob_name, messages in _MEMORY_STORE.items():
            parts = blob_parts(blob_name)
            if len(parts) != 3 or parts[0] != "conversations":
                continue
            if not segment_matches_id(parts[1], user_id):
                continue
            session_id = _extract_stable_id_from_segment(parts[2].removesuffix(".json"))
            summaries[session_id] = _build_conversation_summary(session_id, list(messages))
    else:
        container: ContainerClient = store["memory_container"]
        for blob_item in container.list_blobs(name_starts_with="conversations/"):
            blob_name = str(getattr(blob_item, "name", "")).strip()
            parts = blob_parts(blob_name)
            if len(parts) != 3 or parts[0] != "conversations":
                continue
            if not segment_matches_id(parts[1], user_id):
                continue
            payload = read_blob_text(container, blob_name)
            if payload is None:
                continue
            try:
                messages = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if not isinstance(messages, list):
                continue
            session_id = _extract_stable_id_from_segment(parts[2].removesuffix(".json"))
            summaries[session_id] = _build_conversation_summary(session_id, messages)

    ordered_summaries = sorted(
        summaries.values(),
        key=lambda item: str(item.get("updatedAt", "") or ""),
        reverse=True,
    )
    return ordered_summaries


def init_store() -> dict[str, Any]:
    mode = os.getenv("NEURALCHAT_STORAGE_MODE", "blob").strip().lower()
    if mode == "memory":
        return {"mode": "memory"}

    connection_string = (
        os.getenv("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        or os.getenv("AzureWebJobsStorage", "").strip()
    )
    if not connection_string:
        raise RuntimeError("Azure Blob storage is required. Set AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage.")

    memory_container_name = os.getenv("AZURE_BLOB_MEMORY_CONTAINER", "neurarchat-memory").strip() or "neurarchat-memory"
    profiles_container_name = os.getenv("AZURE_BLOB_PROFILES_CONTAINER", "neurarchat-profiles").strip() or "neurarchat-profiles"

    blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    memory_container = _ensure_container(blob_service_client, memory_container_name)
    profiles_container = _ensure_container(blob_service_client, profiles_container_name)

    return {
        "mode": "blob",
        "memory_container": memory_container,
        "profiles_container": profiles_container,
    }


def _ensure_container(blob_service_client: BlobServiceClient, container_name: str) -> ContainerClient:
    container = blob_service_client.get_container_client(container_name)
    try:
        container.create_container()
    except ResourceExistsError:
        pass
    return container


def conversation_blob_name(
    user_id: str,
    session_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> str:
    return f"conversations/{user_segment(user_id, display_name)}/{session_segment(session_id, session_title)}.json"


def _legacy_conversation_blob_name(user_id: str, session_id: str) -> str:
    return f"conversations/{safe_identifier(user_id)}/{safe_identifier(session_id)}.json"


def _find_existing_conversation_blob(container: ContainerClient, user_id: str, session_id: str) -> str | None:
    legacy_blob_name = _legacy_conversation_blob_name(user_id, session_id)
    if read_blob_text(container, legacy_blob_name) is not None:
        return legacy_blob_name

    for blob_item in container.list_blobs(name_starts_with="conversations/"):
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if len(parts) != 3 or parts[0] != "conversations":
            continue
        if not segment_matches_id(parts[1], user_id):
            continue
        session_stem = parts[2].removesuffix(".json")
        if segment_matches_id(session_stem, session_id):
            return blob_name
    return None


def load_messages(
    store: dict[str, Any],
    user_id: str,
    session_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> list[dict[str, Any]]:
    canonical_blob_name = conversation_blob_name(user_id, session_id, display_name, session_title)
    if store["mode"] == "memory":
        memory_messages = _MEMORY_STORE.get(canonical_blob_name)
        if memory_messages is not None:
            return list(memory_messages)
        legacy_messages = _MEMORY_STORE.get(_legacy_conversation_blob_name(user_id, session_id))
        if legacy_messages is None:
            return []
        _MEMORY_STORE[canonical_blob_name] = list(legacy_messages)
        del _MEMORY_STORE[_legacy_conversation_blob_name(user_id, session_id)]
        return list(legacy_messages)

    container: ContainerClient = store["memory_container"]
    existing_blob_name = _find_existing_conversation_blob(container, user_id, session_id)
    if existing_blob_name is None:
        return []

    payload = read_blob_text(container, existing_blob_name)
    if payload is None:
        return []

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return []

    if isinstance(data, list):
        if existing_blob_name != canonical_blob_name:
            write_json_with_migration(
                container,
                canonical_blob_name,
                data,
                old_blob_name=existing_blob_name,
            )
        return data
    return []


def append_message(
    store: dict[str, Any],
    user_id: str,
    session_id: str,
    message: dict[str, Any],
    display_name: str | None = None,
    session_title: str | None = None,
) -> None:
    with _STORE_LOCK:
        messages = load_messages(store, user_id, session_id, display_name, session_title)
        messages.append(message)
        canonical_blob_name = conversation_blob_name(user_id, session_id, display_name, session_title)

        if store["mode"] == "memory":
            _MEMORY_STORE[canonical_blob_name] = messages
            legacy_blob_name = _legacy_conversation_blob_name(user_id, session_id)
            if legacy_blob_name in _MEMORY_STORE and legacy_blob_name != canonical_blob_name:
                del _MEMORY_STORE[legacy_blob_name]
            return

        container: ContainerClient = store["memory_container"]
        existing_blob_name = _find_existing_conversation_blob(container, user_id, session_id)
        write_json_with_migration(
            container,
            canonical_blob_name,
            messages,
            old_blob_name=existing_blob_name,
        )


def delete_conversation_session(
    store: dict[str, Any],
    user_id: str,
    session_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> bool:
    with _STORE_LOCK:
        canonical_blob_name = conversation_blob_name(user_id, session_id, display_name, session_title)

        if store["mode"] == "memory":
            deleted = False
            if canonical_blob_name in _MEMORY_STORE:
                del _MEMORY_STORE[canonical_blob_name]
                deleted = True
            legacy_blob_name = _legacy_conversation_blob_name(user_id, session_id)
            if legacy_blob_name in _MEMORY_STORE:
                del _MEMORY_STORE[legacy_blob_name]
                deleted = True
            return deleted

        container: ContainerClient = store["memory_container"]
        existing_blob_name = _find_existing_conversation_blob(container, user_id, session_id)
        if not existing_blob_name:
            return False

        try:
            container.get_blob_client(blob=existing_blob_name).delete_blob(delete_snapshots="include")
        except ResourceNotFoundError:
            return False
        return True


def touch_profile(store: dict[str, Any], user_id: str, display_name: str | None = None) -> None:
    canonical_blob_name = f"profiles/{user_segment(user_id, display_name)}.json"
    payload = {
        "user_id": user_id,
        "display_name": display_name or user_id,
        "updated_at": datetime.now(UTC).isoformat(),
    }

    if store["mode"] == "memory":
        _MEMORY_PROFILES[canonical_blob_name] = payload
        legacy_blob_name = _legacy_profile_blob_name(user_id)
        if legacy_blob_name in _MEMORY_PROFILES and legacy_blob_name != canonical_blob_name:
            del _MEMORY_PROFILES[legacy_blob_name]
        return

    container: ContainerClient = store["profiles_container"]
    existing = load_profile(store, user_id, display_name)
    existing.update(payload)
    write_json_with_migration(
        container,
        canonical_blob_name,
        existing,
        old_blob_name=_find_existing_profile_blob(container, user_id),
    )


def _legacy_profile_blob_name(user_id: str) -> str:
    return f"profiles/{safe_identifier(user_id)}.json"


def _find_existing_profile_blob(container: ContainerClient, user_id: str) -> str | None:
    legacy_blob_name = _legacy_profile_blob_name(user_id)
    if read_blob_text(container, legacy_blob_name) is not None:
        return legacy_blob_name

    for blob_item in container.list_blobs(name_starts_with="profiles/"):
        blob_name = str(getattr(blob_item, "name", "")).strip()
        parts = blob_parts(blob_name)
        if len(parts) != 2 or parts[0] != "profiles":
            continue
        blob_stem = parts[1].removesuffix(".json")
        if segment_matches_id(blob_stem, user_id):
            return blob_name
    return None


def load_profile(store: dict[str, Any], user_id: str, display_name: str | None = None) -> dict[str, Any]:
    canonical_blob_name = f"profiles/{user_segment(user_id, display_name)}.json"

    if store["mode"] == "memory":
        profile = _MEMORY_PROFILES.get(canonical_blob_name)
        if profile is not None:
            return dict(profile)
        legacy_profile = _MEMORY_PROFILES.get(_legacy_profile_blob_name(user_id))
        if legacy_profile is None:
            return {}
        _MEMORY_PROFILES[canonical_blob_name] = dict(legacy_profile)
        del _MEMORY_PROFILES[_legacy_profile_blob_name(user_id)]
        return dict(legacy_profile)

    container: ContainerClient = store["profiles_container"]
    existing_blob_name = _find_existing_profile_blob(container, user_id)
    if existing_blob_name is None:
        return {}
    raw = read_blob_text(container, existing_blob_name)
    if raw is None:
        return {}

    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    if isinstance(loaded, dict):
        if existing_blob_name != canonical_blob_name:
            loaded.setdefault("user_id", user_id)
            loaded.setdefault("display_name", display_name or user_id)
            write_json_with_migration(container, canonical_blob_name, loaded, old_blob_name=existing_blob_name)
        return loaded
    return {}


def reset_memory_store() -> None:
    _MEMORY_STORE.clear()
    _MEMORY_PROFILES.clear()
