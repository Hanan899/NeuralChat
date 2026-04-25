from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class PlatformSettings:
    database_url: str
    master_key: str
    workspace_key: str
    route_confidence_threshold: float
    index_queue_name: str
    default_embedding_dimensions: int

    @property
    def configured(self) -> bool:
        return bool(self.database_url and self.master_key)


@lru_cache(maxsize=1)
def get_platform_settings() -> PlatformSettings:
    threshold_raw = os.getenv("PLATFORM_ROUTE_CONFIDENCE_THRESHOLD", "0.65").strip()
    try:
        threshold = float(threshold_raw)
    except ValueError:
        threshold = 0.65
    threshold = min(max(threshold, 0.0), 1.0)

    dimensions_raw = os.getenv("PLATFORM_EMBEDDING_DIMENSIONS", "1536").strip()
    try:
        dimensions = max(1, int(dimensions_raw))
    except ValueError:
        dimensions = 1536

    return PlatformSettings(
        database_url=os.getenv("PLATFORM_DATABASE_URL", "").strip(),
        master_key=os.getenv("PLATFORM_MASTER_KEY", "").strip(),
        workspace_key=os.getenv("PLATFORM_WORKSPACE_KEY", "default").strip() or "default",
        route_confidence_threshold=threshold,
        index_queue_name=os.getenv("PLATFORM_INDEX_QUEUE_NAME", "platform-document-index").strip() or "platform-document-index",
        default_embedding_dimensions=dimensions,
    )


def platform_is_configured() -> bool:
    return get_platform_settings().configured


def validate_platform_configuration() -> None:
    settings = get_platform_settings()
    if not settings.database_url:
        raise RuntimeError("PLATFORM_DATABASE_URL is required for platform features.")
    if not settings.master_key:
        raise RuntimeError("PLATFORM_MASTER_KEY is required for platform features.")
    try:
        raw_key = settings.master_key.encode("utf-8")
        decoded = base64.urlsafe_b64decode(raw_key + b"=" * (-len(raw_key) % 4))
    except Exception as error:
        raise RuntimeError("PLATFORM_MASTER_KEY must be URL-safe base64.") from error
    if len(decoded) != 32:
        raise RuntimeError("PLATFORM_MASTER_KEY must decode to exactly 32 bytes.")
