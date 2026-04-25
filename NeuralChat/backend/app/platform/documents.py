from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any

from azure.core.exceptions import ResourceExistsError
from azure.storage.blob import BlobServiceClient
from azure.storage.queue import QueueClient
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.platform.config import get_platform_settings
from app.platform.models import Document, DocumentChunk
from app.platform.providers import embed_texts
from app.services.file_handler import _safe_filename, _get_blob_service_client, chunk_text, parse_file


def _platform_upload_blob_name(collection_id: str, document_id: str, filename: str) -> str:
    return f"platform-collections/{collection_id}/{document_id}/{_safe_filename(filename)}"


def upload_platform_document_blob(collection_id: str, document_id: str, filename: str, file_bytes: bytes) -> str:
    uploads_container_name = "neurarchat-uploads"
    blob_service = _get_blob_service_client()
    container = blob_service.get_container_client(uploads_container_name)
    try:
        container.create_container()
    except ResourceExistsError:
        pass
    blob_name = _platform_upload_blob_name(collection_id, document_id, filename)
    container.get_blob_client(blob=blob_name).upload_blob(file_bytes, overwrite=True)
    return blob_name


def enqueue_document_index(document_id: str) -> None:
    settings = get_platform_settings()
    connection_string = blob_connection_string()
    queue_client = QueueClient.from_connection_string(connection_string, settings.index_queue_name)
    try:
        queue_client.create_queue()
    except ResourceExistsError:
        pass
    queue_client.send_message(json.dumps({"document_id": document_id}, ensure_ascii=True))


def blob_connection_string() -> str:
    import os

    connection_string = (
        os.getenv("AZURE_STORAGE_CONNECTION_STRING", "").strip()
        or os.getenv("AzureWebJobsStorage", "").strip()
    )
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage is required.")
    return connection_string


async def process_document_index(document_id: str, session: Session) -> dict[str, Any]:
    document = session.get(Document, document_id)
    if document is None:
        return {"processed": False, "detail": "Document not found."}
    document.status = "parsing"
    document.error_message = None
    session.commit()

    try:
        blob_service = _get_blob_service_client()
        uploads_container = blob_service.get_container_client("neurarchat-uploads")
        file_bytes = uploads_container.get_blob_client(document.blob_path).download_blob().readall()
        extracted_text = parse_file(document.filename, file_bytes)
        chunks = chunk_text(extracted_text, chunk_size=500, overlap=60)
        document.status = "indexing"
        document.chunk_count = len(chunks)
        session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
        session.commit()

        embeddings: list[list[float]] = []
        if chunks:
            embeddings, _usage, runtime = await embed_texts(session, chunks)
        for chunk_index, chunk in enumerate(chunks):
            embedding = embeddings[chunk_index] if chunk_index < len(embeddings) else None
            session.add(
                DocumentChunk(
                    document_id=document.id,
                    collection_id=document.collection_id,
                    chunk_index=chunk_index,
                    content=chunk,
                    token_count=len(chunk.split()),
                    metadata_json={"provider": runtime.provider_key if chunks and chunk_index < len(embeddings) else None},
                    embedding=embedding,
                )
            )
        document.status = "ready"
        document.indexed_at = datetime.now(UTC)
        document.error_message = None
        session.commit()
        return {"processed": True, "chunks": len(chunks)}
    except Exception as error:
        document.status = "failed"
        document.error_message = str(error)
        session.commit()
        return {"processed": False, "detail": str(error)}


def search_document_chunks(
    session: Session,
    *,
    collection_id: str,
    query_embedding: list[float],
    limit: int = 5,
) -> list[dict[str, Any]]:
    statement = text(
        """
        SELECT id, document_id, collection_id, chunk_index, content, metadata_json, embedding <=> CAST(:embedding AS vector) AS distance
        FROM document_chunks
        WHERE collection_id = :collection_id
        ORDER BY embedding <=> CAST(:embedding AS vector)
        LIMIT :limit
        """
    )
    result = session.execute(
        statement,
        {
            "collection_id": collection_id,
            "embedding": "[" + ",".join(str(value) for value in query_embedding) + "]",
            "limit": limit,
        },
    )
    rows = result.mappings().all()
    payload: list[dict[str, Any]] = []
    for row in rows:
        payload.append(
            {
                "chunk_id": row["id"],
                "document_id": row["document_id"],
                "collection_id": row["collection_id"],
                "chunk_index": row["chunk_index"],
                "content": row["content"],
                "score": max(0.0, 1.0 - float(row["distance"] or 0.0)),
                "metadata": row["metadata_json"] or {},
            }
        )
    return payload
