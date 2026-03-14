"""File upload, parsing, chunking, and retrieval helpers for session-scoped file Q&A."""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
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

try:  # pragma: no cover - optional dependency in some dev environments
    import fitz  # type: ignore
except Exception:  # pragma: no cover - optional dependency in some dev environments
    fitz = None

try:  # pragma: no cover - optional dependency in some dev environments
    from docx import Document
except Exception:  # pragma: no cover - optional dependency in some dev environments
    Document = None

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".csv"}
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
UPLOADS_CONTAINER_ENV = "AZURE_BLOB_UPLOADS_CONTAINER"
PARSED_CONTAINER_ENV = "AZURE_BLOB_PARSED_CONTAINER"
DEFAULT_UPLOADS_CONTAINER = "neurarchat-uploads"
DEFAULT_PARSED_CONTAINER = "neurarchat-parsed"


# This helper builds a BlobServiceClient using configured Azure Storage credentials.
def _get_blob_service_client() -> BlobServiceClient:
    connection_string = (
        os.getenv("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        or os.getenv("AzureWebJobsStorage", "").strip()
    )
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage is required.")
    return BlobServiceClient.from_connection_string(connection_string)


# This helper returns a container client and creates the container if it does not exist.
def _get_container(container_name: str) -> ContainerClient:
    blob_service_client = _get_blob_service_client()
    container_client = blob_service_client.get_container_client(container_name)
    try:
        container_client.create_container()
    except ResourceExistsError:
        pass
    return container_client


# This helper returns the uploads container used for raw user files.
def _get_uploads_container() -> ContainerClient:
    container_name = os.getenv(UPLOADS_CONTAINER_ENV, DEFAULT_UPLOADS_CONTAINER).strip() or DEFAULT_UPLOADS_CONTAINER
    return _get_container(container_name)


# This helper returns the parsed container used for extracted chunk JSON payloads.
def _get_parsed_container() -> ContainerClient:
    container_name = os.getenv(PARSED_CONTAINER_ENV, DEFAULT_PARSED_CONTAINER).strip() or DEFAULT_PARSED_CONTAINER
    return _get_container(container_name)


# This helper normalizes incoming filenames so path traversal cannot happen.
def _safe_filename(filename: str) -> str:
    leaf_name = Path(filename or "").name.strip()
    return safe_identifier(leaf_name)


# This helper builds raw upload blob path for a specific user/session/filename tuple.
def _uploads_blob_name(
    user_id: str,
    session_id: str,
    filename: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> str:
    return f"{user_segment(user_id, display_name)}/{session_segment(session_id, session_title)}/{_safe_filename(filename)}"


# This helper builds parsed blob path for a specific user/session/filename tuple.
def _parsed_blob_name(
    user_id: str,
    session_id: str,
    filename: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> str:
    return f"{user_segment(user_id, display_name)}/{session_segment(session_id, session_title)}/{_safe_filename(filename)}.json"


# This helper builds the legacy user/session prefix used before readable naming.
def _legacy_session_prefix(user_id: str, session_id: str) -> str:
    return f"{safe_identifier(user_id)}/{safe_identifier(session_id)}/"


# This helper checks whether one blob belongs to a given user/session tuple.
def _matches_user_session_blob(blob_name: str, user_id: str, session_id: str) -> bool:
    parts = blob_parts(blob_name)
    if len(parts) < 3:
        return False
    return segment_matches_id(parts[0], user_id) and segment_matches_id(parts[1], session_id)


# This helper lists all blob names belonging to one user/session tuple.
def _list_matching_session_blobs(container: ContainerClient, user_id: str, session_id: str) -> list[str]:
    matching_names: list[str] = []
    for blob_item in container.list_blobs():
        blob_name = str(getattr(blob_item, "name", "")).strip()
        if blob_name and _matches_user_session_blob(blob_name, user_id, session_id):
            matching_names.append(blob_name)
    return matching_names


# This helper finds an existing raw upload blob for one file in either old or new naming formats.
def _find_existing_upload_blob(container: ContainerClient, user_id: str, session_id: str, filename: str) -> str | None:
    safe_name = _safe_filename(filename)
    for blob_name in _list_matching_session_blobs(container, user_id, session_id):
        parts = blob_parts(blob_name)
        if len(parts) >= 3 and parts[2] == safe_name:
            return blob_name
    return None


# This helper finds an existing parsed blob for one file in either old or new naming formats.
def _find_existing_parsed_blob(container: ContainerClient, user_id: str, session_id: str, filename: str) -> str | None:
    safe_name = f"{_safe_filename(filename)}.json"
    legacy_blob_name = f"{_legacy_session_prefix(user_id, session_id)}{safe_name}"
    if read_blob_text(container, legacy_blob_name) is not None:
        return legacy_blob_name

    for blob_name in _list_matching_session_blobs(container, user_id, session_id):
        parts = blob_parts(blob_name)
        if len(parts) >= 3 and parts[2] == safe_name:
            return blob_name
    return None


# This helper extracts lowercase keyword tokens for simple relevance matching.
def _keyword_tokens(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9]+", text.lower())


# This function validates file extension and size before upload/parse work begins.
def validate_file(filename: str, file_size_bytes: int) -> None:
    file_extension = Path(filename or "").suffix.lower()
    if file_extension not in ALLOWED_EXTENSIONS:
        allowed_text = ", ".join(sorted(extension.lstrip(".") for extension in ALLOWED_EXTENSIONS))
        raise ValueError(f"File type {file_extension or '(none)'} is not supported. Allowed: {allowed_text}")

    if file_size_bytes > MAX_FILE_SIZE_BYTES:
        raise ValueError("File size exceeds 25MB limit.")


# This function uploads raw file bytes into the uploads container and returns the blob path.
def upload_raw_file(
    user_id: str,
    session_id: str,
    filename: str,
    file_bytes: bytes,
    display_name: str | None = None,
    session_title: str | None = None,
) -> str:
    uploads_container = _get_uploads_container()
    blob_name = _uploads_blob_name(user_id, session_id, filename, display_name, session_title)
    old_blob_name = _find_existing_upload_blob(uploads_container, user_id, session_id, filename)

    # COST NOTE: Cool-tier blob upload writes are typically fractions of a cent per file.
    uploads_container.get_blob_client(blob=blob_name).upload_blob(file_bytes, overwrite=True)
    if old_blob_name and old_blob_name != blob_name:
        try:
            uploads_container.get_blob_client(blob=old_blob_name).delete_blob(delete_snapshots="include")
        except ResourceNotFoundError:
            pass
    return blob_name


# This function parses file bytes into one text string based on file extension rules.
def parse_file(filename: str, file_bytes: bytes) -> str:
    file_extension = Path(filename or "").suffix.lower()

    if file_extension == ".pdf":
        if fitz is None:
            raise RuntimeError("PyMuPDF is not installed. Add PyMuPDF to backend dependencies.")
        parsed_pages: list[str] = []
        with fitz.open(stream=file_bytes, filetype="pdf") as pdf_document:
            for page_index in range(pdf_document.page_count):
                parsed_pages.append(pdf_document.load_page(page_index).get_text("text") or "")
        return "\n".join(parsed_pages).strip()

    if file_extension == ".docx":
        if Document is None:
            raise RuntimeError("python-docx is not installed. Add python-docx to backend dependencies.")
        document = Document(BytesIO(file_bytes))
        paragraphs = [paragraph.text for paragraph in document.paragraphs if paragraph.text]
        return "\n".join(paragraphs).strip()

    if file_extension in {".txt", ".csv"}:
        return file_bytes.decode("utf-8", errors="ignore").strip()

    if file_extension in {".png", ".jpg", ".jpeg"}:
        return ""

    return ""


# This function splits long text into overlapping word chunks for efficient prompt context.
def chunk_text(full_text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    stripped_text = full_text.strip()
    if not stripped_text:
        return []

    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than 0.")

    if overlap < 0:
        raise ValueError("overlap must be 0 or greater.")

    if overlap >= chunk_size:
        overlap = max(0, chunk_size - 1)

    words = stripped_text.split()
    if not words:
        return []

    chunks: list[str] = []
    step = chunk_size - overlap
    start_index = 0

    while start_index < len(words):
        end_index = min(start_index + chunk_size, len(words))
        chunk_words = words[start_index:end_index]
        if chunk_words:
            chunks.append(" ".join(chunk_words))
        if end_index >= len(words):
            break
        start_index += step

    return chunks


# This function stores parsed chunk payload JSON for re-use so duplicate parsing is avoided.
def save_parsed_chunks(
    user_id: str,
    session_id: str,
    filename: str,
    chunks: list[str],
    display_name: str | None = None,
    session_title: str | None = None,
) -> None:
    parsed_container = _get_parsed_container()
    blob_name = _parsed_blob_name(user_id, session_id, filename, display_name, session_title)
    old_blob_name = _find_existing_parsed_blob(parsed_container, user_id, session_id, filename)

    payload = {
        "filename": _safe_filename(filename),
        "chunk_count": len(chunks),
        "chunks": chunks,
        "user_id": user_id,
        "display_name": display_name or user_id,
        "session_id": session_id,
        "session_title": session_title or session_id,
        "parsed_at": datetime.now(UTC).isoformat(),
    }

    # COST NOTE: Parsed JSON is saved once and reused to avoid repeated parse costs.
    write_json_with_migration(parsed_container, blob_name, payload, old_blob_name=old_blob_name)


# This function loads previously parsed chunks and returns None when no parsed blob exists.
def load_parsed_chunks(
    user_id: str,
    session_id: str,
    filename: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> list[str] | None:
    parsed_container = _get_parsed_container()
    canonical_blob_name = _parsed_blob_name(user_id, session_id, filename, display_name, session_title)
    existing_blob_name = _find_existing_parsed_blob(parsed_container, user_id, session_id, filename)
    if existing_blob_name is None:
        return None
    raw_payload = read_blob_text(parsed_container, existing_blob_name)
    if raw_payload is None:
        return None

    try:
        parsed_payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed_payload, dict):
        return None

    chunks = parsed_payload.get("chunks")
    if not isinstance(chunks, list):
        return None

    normalized_chunks = [str(chunk).strip() for chunk in chunks if str(chunk).strip()]
    if existing_blob_name != canonical_blob_name:
        parsed_payload["user_id"] = user_id
        parsed_payload["display_name"] = display_name or parsed_payload.get("display_name") or user_id
        parsed_payload["session_id"] = session_id
        parsed_payload["session_title"] = session_title or parsed_payload.get("session_title") or session_id
        write_json_with_migration(parsed_container, canonical_blob_name, parsed_payload, old_blob_name=existing_blob_name)
    return normalized_chunks


# This function ranks chunks by simple keyword overlap and returns only the top matches.
def get_relevant_chunks(chunks: list[str], user_question: str, max_chunks: int = 3) -> list[str]:
    if not chunks:
        return []

    if max_chunks <= 0:
        return []

    question_tokens = _keyword_tokens(user_question)
    if not question_tokens:
        return chunks[:max_chunks]

    question_token_set = set(question_tokens)
    scored_chunks: list[tuple[int, int, str]] = []

    for chunk_index, chunk_text_value in enumerate(chunks):
        chunk_tokens = set(_keyword_tokens(chunk_text_value))
        score = sum(1 for token in question_token_set if token in chunk_tokens)
        scored_chunks.append((score, -chunk_index, chunk_text_value))

    scored_chunks.sort(reverse=True)
    top_chunks = [chunk_text_value for score, _negative_index, chunk_text_value in scored_chunks if score > 0][:max_chunks]

    if top_chunks:
        return top_chunks

    # COST NOTE: This relevance ranking is pure Python and avoids paid LLM calls.
    return chunks[:max_chunks]


# This function lists all files uploaded by user for one session.
def list_user_files(
    user_id: str,
    session_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> list[dict[str, str]]:
    uploads_container = _get_uploads_container()
    canonical_prefix = f"{user_segment(user_id, display_name)}/{session_segment(session_id, session_title)}/"

    listed_files: list[dict[str, str]] = []
    for blob_item in uploads_container.list_blobs():
        blob_name = str(getattr(blob_item, "name", ""))
        if not blob_name or not _matches_user_session_blob(blob_name, user_id, session_id):
            continue
        parts = blob_parts(blob_name)
        if len(parts) < 3:
            continue
        filename = parts[2]
        if not filename:
            continue
        uploaded_at_value = getattr(blob_item, "last_modified", None)
        uploaded_at = uploaded_at_value.isoformat() if uploaded_at_value else ""
        canonical_blob_name = f"{canonical_prefix}{filename}"
        if blob_name != canonical_blob_name:
            payload_bytes = uploads_container.get_blob_client(blob=blob_name).download_blob().readall()
            uploads_container.get_blob_client(blob=canonical_blob_name).upload_blob(payload_bytes, overwrite=True)
            try:
                uploads_container.get_blob_client(blob=blob_name).delete_blob(delete_snapshots="include")
            except ResourceNotFoundError:
                pass
            blob_name = canonical_blob_name
        listed_files.append(
            {
                "filename": filename,
                "uploaded_at": uploaded_at,
                "blob_path": blob_name,
            }
        )

    listed_files.sort(key=lambda file_item: file_item.get("uploaded_at", ""), reverse=True)
    return listed_files


# This function deletes both raw and parsed blobs for one user/session filename.
def delete_user_file(
    user_id: str,
    session_id: str,
    filename: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> None:
    uploads_container = _get_uploads_container()
    parsed_container = _get_parsed_container()

    uploads_blob_name = _find_existing_upload_blob(uploads_container, user_id, session_id, filename) or _uploads_blob_name(
        user_id,
        session_id,
        filename,
        display_name,
        session_title,
    )
    parsed_blob_name = _find_existing_parsed_blob(parsed_container, user_id, session_id, filename) or _parsed_blob_name(
        user_id,
        session_id,
        filename,
        display_name,
        session_title,
    )

    uploads_blob_client = uploads_container.get_blob_client(blob=uploads_blob_name)
    parsed_blob_client = parsed_container.get_blob_client(blob=parsed_blob_name)

    raw_deleted = False
    try:
        uploads_blob_client.delete_blob(delete_snapshots="include")
        raw_deleted = True
    except ResourceNotFoundError:
        raw_deleted = False

    try:
        parsed_blob_client.delete_blob(delete_snapshots="include")
    except ResourceNotFoundError:
        pass

    if not raw_deleted:
        raise ValueError(f"File '{filename}' was not found.")


# This function deletes every raw and parsed file blob for one user/session pair.
def delete_session_files(
    user_id: str,
    session_id: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> dict[str, int]:
    uploads_container = _get_uploads_container()
    parsed_container = _get_parsed_container()
    deleted_uploads = 0
    deleted_parsed = 0
    deleted_blob_names: set[tuple[str, str]] = set()

    upload_blob_names = _list_matching_session_blobs(uploads_container, user_id, session_id)
    parsed_blob_names = _list_matching_session_blobs(parsed_container, user_id, session_id)

    canonical_prefix = f"{user_segment(user_id, display_name)}/{session_segment(session_id, session_title)}/"
    legacy_prefix = _legacy_session_prefix(user_id, session_id)

    for blob_name in upload_blob_names:
        if ("uploads", blob_name) in deleted_blob_names:
            continue
        try:
            uploads_container.get_blob_client(blob=blob_name).delete_blob(delete_snapshots="include")
            deleted_uploads += 1
            deleted_blob_names.add(("uploads", blob_name))
        except ResourceNotFoundError:
            continue

    for blob_name in parsed_blob_names:
        if ("parsed", blob_name) in deleted_blob_names:
            continue
        try:
            parsed_container.get_blob_client(blob=blob_name).delete_blob(delete_snapshots="include")
            deleted_parsed += 1
            deleted_blob_names.add(("parsed", blob_name))
        except ResourceNotFoundError:
            continue

    # Clean up any direct-prefix leftovers that may not have been enumerated via id-matching.
    for prefix, container, counter_name in (
        (canonical_prefix, uploads_container, "uploads"),
        (legacy_prefix, uploads_container, "uploads"),
        (canonical_prefix, parsed_container, "parsed"),
        (legacy_prefix, parsed_container, "parsed"),
    ):
        for blob_item in container.list_blobs(name_starts_with=prefix):
            blob_name = str(getattr(blob_item, "name", "")).strip()
            if not blob_name or (counter_name, blob_name) in deleted_blob_names:
                continue
            try:
                container.get_blob_client(blob=blob_name).delete_blob(delete_snapshots="include")
                if counter_name == "uploads":
                    deleted_uploads += 1
                else:
                    deleted_parsed += 1
                deleted_blob_names.add((counter_name, blob_name))
            except ResourceNotFoundError:
                continue

    return {"uploads_deleted": deleted_uploads, "parsed_deleted": deleted_parsed}
