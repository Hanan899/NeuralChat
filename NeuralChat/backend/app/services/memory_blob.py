"""Small in-process blob container used by tests and local memory storage mode."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError


@dataclass
class _MemoryBlobRecord:
    payload: bytes
    last_modified: datetime
    content_type: str | None = None


_BLOB_LOCK = Lock()
_BLOB_CONTAINERS: dict[str, dict[str, _MemoryBlobRecord]] = {}


class _MemoryBlobDownload:
    def __init__(self, payload: bytes):
        self._payload = payload

    def readall(self) -> bytes:
        return self._payload


class MemoryBlobClient:
    def __init__(self, container_name: str, blob_name: str):
        self._container_name = container_name
        self._blob_name = blob_name

    def upload_blob(self, data: Any, overwrite: bool = False, content_type: str | None = None) -> None:
        if hasattr(data, "read"):
            data = data.read()
        if isinstance(data, str):
            payload = data.encode("utf-8")
        elif isinstance(data, bytes):
            payload = data
        elif isinstance(data, bytearray):
            payload = bytes(data)
        else:
            payload = str(data).encode("utf-8")

        with _BLOB_LOCK:
            container = _BLOB_CONTAINERS.setdefault(self._container_name, {})
            if not overwrite and self._blob_name in container:
                raise ResourceExistsError("Blob already exists.")
            container[self._blob_name] = _MemoryBlobRecord(
                payload=payload,
                last_modified=datetime.now(UTC),
                content_type=content_type,
            )

    def download_blob(self) -> _MemoryBlobDownload:
        with _BLOB_LOCK:
            record = _BLOB_CONTAINERS.get(self._container_name, {}).get(self._blob_name)
            if record is None:
                raise ResourceNotFoundError("Blob not found.")
            return _MemoryBlobDownload(record.payload)

    def delete_blob(self, delete_snapshots: str | None = None) -> None:
        with _BLOB_LOCK:
            container = _BLOB_CONTAINERS.setdefault(self._container_name, {})
            if self._blob_name not in container:
                raise ResourceNotFoundError("Blob not found.")
            del container[self._blob_name]


class MemoryBlobContainer:
    def __init__(self, container_name: str):
        self._container_name = container_name

    def create_container(self) -> None:
        with _BLOB_LOCK:
            _BLOB_CONTAINERS.setdefault(self._container_name, {})

    def get_blob_client(self, blob: str) -> MemoryBlobClient:
        with _BLOB_LOCK:
            _BLOB_CONTAINERS.setdefault(self._container_name, {})
        return MemoryBlobClient(self._container_name, blob)

    def list_blobs(self, name_starts_with: str = ""):
        with _BLOB_LOCK:
            records = list(_BLOB_CONTAINERS.setdefault(self._container_name, {}).items())

        for blob_name, record in sorted(records, key=lambda item: item[0]):
            if not blob_name.startswith(name_starts_with):
                continue
            yield type("BlobItem", (), {"name": blob_name, "last_modified": record.last_modified})()


def get_memory_blob_container(container_name: str) -> MemoryBlobContainer:
    container = MemoryBlobContainer(container_name)
    container.create_container()
    return container


def clear_memory_blob_containers() -> None:
    with _BLOB_LOCK:
        _BLOB_CONTAINERS.clear()
