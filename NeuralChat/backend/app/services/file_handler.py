"""File upload, parsing, chunking, and retrieval helpers for session-scoped file Q&A."""

from __future__ import annotations

import base64
import json
import logging
import math
import os
import re
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
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
from app.services.memory_blob import get_memory_blob_container

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
AZURE_OPENAI_API_VERSION_DEFAULT = "2025-01-01-preview"
IMAGE_PARSE_MAX_BYTES = 6 * 1024 * 1024

LOGGER = logging.getLogger(__name__)


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
    if os.getenv("NEURALCHAT_STORAGE_MODE", "").strip().lower() == "memory":
        return get_memory_blob_container(container_name)  # type: ignore[return-value]

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


def _image_mime_type(filename: str) -> str:
    file_extension = Path(filename or "").suffix.lower()
    if file_extension == ".png":
        return "image/png"
    if file_extension in {".jpg", ".jpeg"}:
        return "image/jpeg"
    return "application/octet-stream"


def _resolve_embedding_deployment() -> str:
    for env_key in (
        "AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME",
        "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
        "AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT_NAME",
    ):
        value = os.getenv(env_key, "").strip()
        if value:
            return value
    return ""


def _resolve_vision_deployment() -> str:
    return (
        os.getenv("AZURE_OPENAI_VISION_DEPLOYMENT_NAME", "").strip()
        or os.getenv("AZURE_OPENAI_VISION_DEPLOYMENT", "").strip()
        or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "").strip()
    )


def _azure_openai_base_config() -> tuple[str, str, str]:
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip().rstrip("/")
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    api_version = os.getenv("AZURE_OPENAI_API_VERSION", AZURE_OPENAI_API_VERSION_DEFAULT).strip()
    return endpoint, api_key, api_version


def _embed_texts(texts: list[str]) -> list[list[float]] | None:
    normalized_texts = [text.strip() for text in texts if text.strip()]
    if not normalized_texts:
        return []

    endpoint, api_key, api_version = _azure_openai_base_config()
    deployment = _resolve_embedding_deployment()
    if not endpoint or not api_key or not deployment:
        return None

    url = f"{endpoint}/openai/deployments/{deployment}/embeddings"
    try:
        with httpx.Client(timeout=20.0) as http_client:
            response = http_client.post(
                url,
                params={"api-version": api_version},
                headers={"api-key": api_key, "content-type": "application/json"},
                json={"input": normalized_texts},
            )
            response.raise_for_status()
            response_data = response.json()
    except Exception as error:  # pragma: no cover - network/provider fallback
        LOGGER.warning("File embedding generation failed; falling back to keyword retrieval: %s", error)
        return None

    embeddings_by_index: dict[int, list[float]] = {}
    for item in response_data.get("data", []):
        if not isinstance(item, dict) or not isinstance(item.get("embedding"), list):
            continue
        item_index = int(item.get("index", len(embeddings_by_index)) or 0)
        embeddings_by_index[item_index] = [float(value) for value in item["embedding"]]

    return [embeddings_by_index[index] for index in range(len(normalized_texts)) if index in embeddings_by_index]


def _cosine_similarity(left: list[float] | None, right: list[float] | None) -> float | None:
    if not left or not right or len(left) != len(right):
        return None
    dot_product = sum(a * b for a, b in zip(left, right, strict=False))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return None
    return dot_product / (left_norm * right_norm)


def _parse_image_with_azure_vision(filename: str, file_bytes: bytes) -> str:
    if len(file_bytes) > IMAGE_PARSE_MAX_BYTES:
        LOGGER.warning("Skipping image parsing for %s because it exceeds the %s byte vision limit.", filename, IMAGE_PARSE_MAX_BYTES)
        return ""

    endpoint, api_key, api_version = _azure_openai_base_config()
    deployment = _resolve_vision_deployment()
    if not endpoint or not api_key or not deployment:
        return ""

    encoded_image = base64.b64encode(file_bytes).decode("ascii")
    image_url = f"data:{_image_mime_type(filename)};base64,{encoded_image}"
    request_url = f"{endpoint}/openai/deployments/{deployment}/chat/completions"
    payload = {
        "messages": [
            {
                "role": "system",
                "content": (
                    "Extract readable text from the image. Also summarize visual details that could help answer "
                    "questions about the image. Return concise plain text only."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Read this image for retrieval context."},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            },
        ],
        "temperature": 0,
        "max_tokens": 800,
    }

    try:
        with httpx.Client(timeout=30.0) as http_client:
            response = http_client.post(
                request_url,
                params={"api-version": api_version},
                headers={"api-key": api_key, "content-type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            response_data = response.json()
    except Exception as error:  # pragma: no cover - network/provider fallback
        LOGGER.warning("Image parsing failed for %s: %s", filename, error)
        return ""

    choices = response_data.get("choices", [])
    if not choices or not isinstance(choices[0], dict):
        return ""
    message = choices[0].get("message", {})
    if not isinstance(message, dict):
        return ""
    content = message.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_parts = [str(item.get("text", "")).strip() for item in content if isinstance(item, dict) and str(item.get("text", "")).strip()]
        return "\n".join(text_parts).strip()
    return ""


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
        return _parse_image_with_azure_vision(filename, file_bytes)

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

    payload = build_parsed_chunk_payload(
        filename,
        chunks,
        {
            "user_id": user_id,
            "display_name": display_name or user_id,
            "session_id": session_id,
            "session_title": session_title or session_id,
        },
    )

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


def build_parsed_chunk_payload(filename: str, chunks: list[str], metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    normalized_chunks = [str(chunk).strip() for chunk in chunks if str(chunk).strip()]
    embeddings = _embed_texts(normalized_chunks)
    chunk_metadata: list[dict[str, Any]] = []
    for chunk_index, _chunk in enumerate(normalized_chunks):
        chunk_metadata.append(
            {
                "chunk_index": chunk_index,
                "citation_label": f"F{chunk_index + 1}",
            }
        )
    return {
        "filename": _safe_filename(filename),
        "chunk_count": len(normalized_chunks),
        "chunks": normalized_chunks,
        "chunk_metadata": chunk_metadata,
        "embeddings": embeddings if embeddings is not None and len(embeddings) == len(normalized_chunks) else [],
        "embedding_model": _resolve_embedding_deployment() or None,
        "parsed_at": datetime.now(UTC).isoformat(),
        **(metadata or {}),
    }


def records_from_parsed_payload(parsed_payload: dict[str, Any], fallback_filename: str) -> list[dict[str, Any]]:
    chunks = parsed_payload.get("chunks")
    if not isinstance(chunks, list):
        return []
    embeddings = parsed_payload.get("embeddings")
    metadata_items = parsed_payload.get("chunk_metadata")
    filename = str(parsed_payload.get("filename") or fallback_filename).strip() or fallback_filename
    records: list[dict[str, Any]] = []
    for chunk_index, raw_chunk in enumerate(chunks):
        text = str(raw_chunk).strip()
        if not text:
            continue
        embedding = None
        if isinstance(embeddings, list) and chunk_index < len(embeddings) and isinstance(embeddings[chunk_index], list):
            embedding = [float(value) for value in embeddings[chunk_index]]
        chunk_metadata = metadata_items[chunk_index] if isinstance(metadata_items, list) and chunk_index < len(metadata_items) and isinstance(metadata_items[chunk_index], dict) else {}
        records.append(
            {
                "filename": filename,
                "chunk_index": int(chunk_metadata.get("chunk_index", chunk_index) or chunk_index),
                "citation_label": str(chunk_metadata.get("citation_label") or f"F{chunk_index + 1}"),
                "content": text,
                "embedding": embedding,
                "score": None,
            }
        )
    return records


def load_parsed_chunk_records(
    user_id: str,
    session_id: str,
    filename: str,
    display_name: str | None = None,
    session_title: str | None = None,
) -> list[dict[str, Any]] | None:
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

    records = records_from_parsed_payload(parsed_payload, filename)
    if existing_blob_name != canonical_blob_name:
        parsed_payload["user_id"] = user_id
        parsed_payload["display_name"] = display_name or parsed_payload.get("display_name") or user_id
        parsed_payload["session_id"] = session_id
        parsed_payload["session_title"] = session_title or parsed_payload.get("session_title") or session_id
        write_json_with_migration(parsed_container, canonical_blob_name, parsed_payload, old_blob_name=existing_blob_name)
    return records


# This function ranks chunks by simple keyword overlap and returns only the top matches.
def get_relevant_chunks(chunks: list[str], user_question: str, max_chunks: int = 3) -> list[str]:
    records = [
        {"filename": "", "chunk_index": chunk_index, "citation_label": f"F{chunk_index + 1}", "content": chunk, "embedding": None}
        for chunk_index, chunk in enumerate(chunks)
    ]
    return [record["content"] for record in get_relevant_chunk_records(records, user_question, max_chunks)]


def get_relevant_chunk_records(records: list[dict[str, Any]], user_question: str, max_chunks: int = 3) -> list[dict[str, Any]]:
    if not records or max_chunks <= 0:
        return []

    query_embeddings = _embed_texts([user_question])
    query_embedding = query_embeddings[0] if query_embeddings else None
    if query_embedding is not None:
        semantic_scores: list[tuple[float, int, dict[str, Any]]] = []
        for record_index, record in enumerate(records):
            score = _cosine_similarity(query_embedding, record.get("embedding"))
            if score is None:
                continue
            next_record = dict(record)
            next_record["score"] = round(score, 4)
            semantic_scores.append((score, -record_index, next_record))
        if semantic_scores:
            semantic_scores.sort(reverse=True, key=lambda item: (item[0], item[1]))
            return [record for _score, _negative_index, record in semantic_scores[:max_chunks]]

    question_tokens = _keyword_tokens(user_question)
    if not question_tokens:
        return [dict(record, score=None) for record in records[:max_chunks]]

    question_token_set = set(question_tokens)
    scored_records: list[tuple[int, int, dict[str, Any]]] = []
    for record_index, record in enumerate(records):
        chunk_tokens = set(_keyword_tokens(str(record.get("content", ""))))
        score = sum(1 for token in question_token_set if token in chunk_tokens)
        scored_records.append((score, -record_index, dict(record, score=float(score) if score > 0 else None)))

    scored_records.sort(reverse=True, key=lambda item: (item[0], item[1]))
    top_records = [record for score, _negative_index, record in scored_records if score > 0][:max_chunks]
    if top_records:
        return top_records

    # COST NOTE: This relevance fallback is pure Python and avoids paid LLM calls.
    return [dict(record, score=None) for record in records[:max_chunks]]


def build_file_context_prompt(records: list[dict[str, Any]]) -> str:
    if not records:
        return ""
    lines = ["Relevant content from uploaded files. Cite file-backed claims with the shown labels, such as [F1] or [F2]."]
    for index, record in enumerate(records, start=1):
        citation_label = f"F{index}"
        filename = str(record.get("filename") or "uploaded file")
        chunk_index = int(record.get("chunk_index", index - 1) or 0) + 1
        score = record.get("score")
        score_text = f" score={score:.3f}" if isinstance(score, (int, float)) else ""
        lines.append(f"[{citation_label}] {filename} chunk {chunk_index}{score_text}\n{str(record.get('content', '')).strip()}")
    return "\n\n".join(lines)


def build_file_sources(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        citation_label = f"F{index}"
        filename = str(record.get("filename") or "uploaded file")
        chunk_index = int(record.get("chunk_index", index - 1) or 0) + 1
        content = str(record.get("content", "")).strip()
        score = record.get("score")
        source: dict[str, Any] = {
            "source_type": "file",
            "title": f"[{citation_label}] {filename}",
            "url": "",
            "snippet": content[:280],
            "filename": filename,
            "chunk_index": chunk_index,
            "citation_label": citation_label,
        }
        if isinstance(score, (int, float)):
            source["score"] = round(float(score), 4)
        sources.append(source)
    return sources


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
