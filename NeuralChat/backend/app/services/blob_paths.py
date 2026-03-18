"""Shared blob path helpers for readable user and session naming.

These helpers keep stable ids in every path while adding readable labels for Azure portal visibility.
"""

from __future__ import annotations

import json
import re
from pathlib import PurePosixPath
from typing import Any

from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import ContainerClient


# This helper converts stable ids into safe path segments.
def safe_identifier(raw_value: str) -> str:
    normalized_value = re.sub(r"[^a-zA-Z0-9._-]", "_", str(raw_value or "").strip())
    return normalized_value or "unknown"


# This helper converts readable labels into safe readable path fragments.
def safe_readable_label(raw_value: str | None, fallback_label: str) -> str:
    candidate = str(raw_value or "").strip().lower()
    candidate = re.sub(r"\s+", "-", candidate)
    candidate = re.sub(r"[^a-z0-9._-]", "-", candidate)
    candidate = re.sub(r"-+", "-", candidate).strip("-._")
    return candidate or fallback_label


# This helper builds one readable segment that still contains the stable id.
def named_segment(readable_value: str | None, stable_id: str, fallback_label: str) -> str:
    return f"{safe_readable_label(readable_value, fallback_label)}__{safe_identifier(stable_id)}"


# This helper builds the canonical user folder segment.
def user_segment(user_id: str, display_name: str | None = None) -> str:
    return named_segment(display_name, user_id, "user")


# This helper builds the canonical session folder or file segment.
def session_segment(session_id: str, session_title: str | None = None) -> str:
    return named_segment(session_title, session_id, "chat")


# This helper builds the canonical project folder segment.
def project_segment(project_id: str, project_name: str | None = None) -> str:
    return named_segment(project_name, project_id, "project")


# This helper checks whether a segment matches a stable id in either old or new naming formats.
def segment_matches_id(segment_value: str, stable_id: str) -> bool:
    safe_stable_id = safe_identifier(stable_id)
    return segment_value == safe_stable_id or segment_value.endswith(f"__{safe_stable_id}")


# This helper reads a blob as text and returns None when it does not exist.
def read_blob_text(container: ContainerClient, blob_name: str) -> str | None:
    blob_client = container.get_blob_client(blob=blob_name)
    try:
        return blob_client.download_blob().readall().decode("utf-8")
    except ResourceNotFoundError:
        return None


# This helper writes blob text into the requested path.
def write_blob_text(container: ContainerClient, blob_name: str, payload_text: str, content_type: str) -> None:
    container.get_blob_client(blob=blob_name).upload_blob(
        payload_text,
        overwrite=True,
        content_type=content_type,
    )


# This helper copies a blob into a new canonical name and removes the old blob.
def move_blob_text(container: ContainerClient, old_blob_name: str, new_blob_name: str, content_type: str) -> str | None:
    if old_blob_name == new_blob_name:
        return read_blob_text(container, old_blob_name)

    payload_text = read_blob_text(container, old_blob_name)
    if payload_text is None:
        return None

    write_blob_text(container, new_blob_name, payload_text, content_type)
    container.get_blob_client(blob=old_blob_name).delete_blob(delete_snapshots="include")
    return payload_text


# This helper writes JSON and removes an old blob after successful canonical write.
def write_json_with_migration(
    container: ContainerClient,
    canonical_blob_name: str,
    payload: dict[str, Any] | list[Any],
    old_blob_name: str | None = None,
) -> None:
    payload_text = json.dumps(payload, ensure_ascii=True, indent=2)
    write_blob_text(container, canonical_blob_name, payload_text, "application/json")
    if old_blob_name and old_blob_name != canonical_blob_name:
        try:
            container.get_blob_client(blob=old_blob_name).delete_blob(delete_snapshots="include")
        except ResourceNotFoundError:
            pass


# This helper normalizes blob names into path parts for matching logic.
def blob_parts(blob_name: str) -> list[str]:
    return [part for part in PurePosixPath(blob_name).parts if part not in {"", "/"}]
