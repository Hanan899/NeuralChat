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


# This helper keeps user, session, and filename keys safe for blob paths.
def _safe_path_segment(raw_value: str) -> str:
    normalized_value = re.sub(r"[^a-zA-Z0-9._-]", "_", str(raw_value))
    return normalized_value or "unknown"


# This helper normalizes incoming filenames so path traversal cannot happen.
def _safe_filename(filename: str) -> str:
    leaf_name = Path(filename or "").name.strip()
    return _safe_path_segment(leaf_name)


# This helper builds raw upload blob path for a specific user/session/filename tuple.
def _uploads_blob_name(user_id: str, session_id: str, filename: str) -> str:
    return f"{_safe_path_segment(user_id)}/{_safe_path_segment(session_id)}/{_safe_filename(filename)}"


# This helper builds parsed blob path for a specific user/session/filename tuple.
def _parsed_blob_name(user_id: str, session_id: str, filename: str) -> str:
    return f"{_safe_path_segment(user_id)}/{_safe_path_segment(session_id)}/{_safe_filename(filename)}.json"


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
def upload_raw_file(user_id: str, session_id: str, filename: str, file_bytes: bytes) -> str:
    uploads_container = _get_uploads_container()
    blob_name = _uploads_blob_name(user_id, session_id, filename)
    blob_client = uploads_container.get_blob_client(blob=blob_name)

    # COST NOTE: Cool-tier blob upload writes are typically fractions of a cent per file.
    blob_client.upload_blob(file_bytes, overwrite=True)
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
def save_parsed_chunks(user_id: str, session_id: str, filename: str, chunks: list[str]) -> None:
    parsed_container = _get_parsed_container()
    blob_name = _parsed_blob_name(user_id, session_id, filename)
    blob_client = parsed_container.get_blob_client(blob=blob_name)

    payload = {
        "filename": _safe_filename(filename),
        "chunk_count": len(chunks),
        "chunks": chunks,
        "parsed_at": datetime.now(UTC).isoformat(),
    }

    # COST NOTE: Parsed JSON is saved once and reused to avoid repeated parse costs.
    blob_client.upload_blob(
        json.dumps(payload, ensure_ascii=True, indent=2),
        overwrite=True,
        content_type="application/json",
    )


# This function loads previously parsed chunks and returns None when no parsed blob exists.
def load_parsed_chunks(user_id: str, session_id: str, filename: str) -> list[str] | None:
    parsed_container = _get_parsed_container()
    blob_name = _parsed_blob_name(user_id, session_id, filename)
    blob_client = parsed_container.get_blob_client(blob=blob_name)

    try:
        raw_payload = blob_client.download_blob().readall().decode("utf-8")
    except ResourceNotFoundError:
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
def list_user_files(user_id: str, session_id: str) -> list[dict[str, str]]:
    uploads_container = _get_uploads_container()
    prefix = f"{_safe_path_segment(user_id)}/{_safe_path_segment(session_id)}/"

    listed_files: list[dict[str, str]] = []
    for blob_item in uploads_container.list_blobs(name_starts_with=prefix):
        blob_name = str(getattr(blob_item, "name", ""))
        if not blob_name:
            continue
        filename = blob_name.removeprefix(prefix)
        if not filename:
            continue
        uploaded_at_value = getattr(blob_item, "last_modified", None)
        uploaded_at = uploaded_at_value.isoformat() if uploaded_at_value else ""
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
def delete_user_file(user_id: str, session_id: str, filename: str) -> None:
    uploads_container = _get_uploads_container()
    parsed_container = _get_parsed_container()

    uploads_blob_name = _uploads_blob_name(user_id, session_id, filename)
    parsed_blob_name = _parsed_blob_name(user_id, session_id, filename)

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
