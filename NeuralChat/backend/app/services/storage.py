"""Local JSON persistence for conversation history.

Explain this code:
- Each session is stored as one JSON file so you can inspect memory easily.
- This local store is intentionally simple and will map to Azure Blob later.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from threading import Lock
from typing import Any

_STORE_LOCK = Lock()

def init_store(base_path: Path) -> Path:
    """Create the local conversation folder and return its normalized path."""
    normalized = Path(base_path)
    normalized.mkdir(parents=True, exist_ok=True)
    return normalized


def session_path(base_path: Path, session_id: str) -> Path:
    safe_session = re.sub(r"[^a-zA-Z0-9_-]", "_", session_id)
    return Path(base_path) / f"{safe_session}.json"


def load_messages(base_path: Path, session_id: str) -> list[dict[str, Any]]:
    path = session_path(base_path, session_id)
    if not path.exists():
        return []

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []

    if isinstance(payload, list):
        return payload
    return []


def append_message(base_path: Path, session_id: str, message: dict[str, Any]) -> None:
    with _STORE_LOCK:
        messages = load_messages(base_path, session_id)
        messages.append(message)

        path = session_path(base_path, session_id)
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(messages, ensure_ascii=True, indent=2), encoding="utf-8")
        temp_path.replace(path)
