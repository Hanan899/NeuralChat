"""Small in-memory cache helpers for Azure Function instances.

This cache is process-local by design. On Azure Consumption, each warm instance keeps
its own short-lived cache, which is still useful for reducing repeated reads during the
instance lifetime without adding Redis or another shared dependency.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from time import time
from typing import Generic, TypeVar

CacheValue = TypeVar("CacheValue")


@dataclass(slots=True)
class CacheEntry(Generic[CacheValue]):
    """Stores a cached value together with its expiry timestamp."""

    value: CacheValue
    expires_at: float


class InMemoryCache:
    """Keeps up to a fixed number of short-lived entries in process memory."""

    def __init__(self, max_entries: int = 100):
        self._max_entries = max_entries
        self._entries: OrderedDict[str, CacheEntry[object]] = OrderedDict()
        self._lock = Lock()

    def get(self, key: str) -> object | None:
        """Returns a cached value when it exists and has not expired."""

        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= time():
                self._entries.pop(key, None)
                return None
            self._entries.move_to_end(key)
            return entry.value

    def set(self, key: str, value: object, ttl_seconds: int) -> None:
        """Stores a value with a time-to-live and evicts the oldest entry when full."""

        expires_at = time() + max(1, ttl_seconds)
        with self._lock:
            if key in self._entries:
                self._entries.pop(key, None)
            self._entries[key] = CacheEntry(value=value, expires_at=expires_at)
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)

    def invalidate(self, key: str) -> None:
        """Removes one exact cache entry when a write changes the underlying data."""

        with self._lock:
            self._entries.pop(key, None)

    def invalidate_prefix(self, prefix: str) -> None:
        """Removes every entry that starts with a prefix after related writes."""

        with self._lock:
            keys_to_remove = [cache_key for cache_key in self._entries if cache_key.startswith(prefix)]
            for cache_key in keys_to_remove:
                self._entries.pop(cache_key, None)


api_cache = InMemoryCache(max_entries=100)
