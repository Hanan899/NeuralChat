"""Storage helpers for user-scoped conversation persistence.

Production/default mode writes to Azure Blob Storage.
Test mode can use in-memory storage by setting NEURALCHAT_STORAGE_MODE=memory.
"""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContainerClient

_STORE_LOCK = Lock()
_MEMORY_STORE: dict[str, list[dict[str, Any]]] = {}
_MEMORY_PROFILES: dict[str, dict[str, Any]] = {}


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


def conversation_blob_name(user_id: str, session_id: str) -> str:
    safe_user = _safe_key(user_id)
    safe_session = _safe_key(session_id)
    return f"conversations/{safe_user}/{safe_session}.json"


def _safe_key(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]", "_", str(value))
    return normalized or "unknown"


def load_messages(store: dict[str, Any], user_id: str, session_id: str) -> list[dict[str, Any]]:
    if store["mode"] == "memory":
        key = conversation_blob_name(user_id, session_id)
        return list(_MEMORY_STORE.get(key, []))

    blob_name = conversation_blob_name(user_id, session_id)
    container: ContainerClient = store["memory_container"]
    blob_client = container.get_blob_client(blob=blob_name)

    try:
        payload = blob_client.download_blob().readall().decode("utf-8")
    except ResourceNotFoundError:
        return []

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return []

    if isinstance(data, list):
        return data
    return []


def append_message(store: dict[str, Any], user_id: str, session_id: str, message: dict[str, Any]) -> None:
    with _STORE_LOCK:
        messages = load_messages(store, user_id, session_id)
        messages.append(message)

        if store["mode"] == "memory":
            key = conversation_blob_name(user_id, session_id)
            _MEMORY_STORE[key] = messages
            return

        blob_name = conversation_blob_name(user_id, session_id)
        container: ContainerClient = store["memory_container"]
        blob_client = container.get_blob_client(blob=blob_name)
        blob_client.upload_blob(
            json.dumps(messages, ensure_ascii=True, indent=2),
            overwrite=True,
            content_type="application/json",
        )


def touch_profile(store: dict[str, Any], user_id: str) -> None:
    payload = {
        "user_id": user_id,
        "updated_at": datetime.now(UTC).isoformat(),
    }

    if store["mode"] == "memory":
        _MEMORY_PROFILES[_safe_key(user_id)] = payload
        return

    container: ContainerClient = store["profiles_container"]
    blob_name = f"profiles/{_safe_key(user_id)}.json"
    blob_client = container.get_blob_client(blob=blob_name)

    existing: dict[str, Any] = {}
    try:
        raw = blob_client.download_blob().readall().decode("utf-8")
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            existing = loaded
    except ResourceNotFoundError:
        pass
    except json.JSONDecodeError:
        existing = {}

    existing.update(payload)
    blob_client.upload_blob(
        json.dumps(existing, ensure_ascii=True, indent=2),
        overwrite=True,
        content_type="application/json",
    )


def load_profile(store: dict[str, Any], user_id: str) -> dict[str, Any]:
    safe_user = _safe_key(user_id)

    if store["mode"] == "memory":
        return dict(_MEMORY_PROFILES.get(safe_user, {}))

    container: ContainerClient = store["profiles_container"]
    blob_name = f"profiles/{safe_user}.json"
    blob_client = container.get_blob_client(blob=blob_name)

    try:
        raw = blob_client.download_blob().readall().decode("utf-8")
    except ResourceNotFoundError:
        return {}

    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    if isinstance(loaded, dict):
        return loaded
    return {}


def reset_memory_store() -> None:
    _MEMORY_STORE.clear()
    _MEMORY_PROFILES.clear()
