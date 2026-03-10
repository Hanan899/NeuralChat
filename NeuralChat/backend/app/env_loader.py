"""Local environment loader for development.

Supports both Azure Functions format:
{
  "Values": {"KEY": "value"}
}

and flat JSON format:
{
  "KEY": "value"
}
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def load_local_settings_env(base_dir: Path) -> None:
    """Load env vars from local.settings.json when running locally with uvicorn.

    Existing environment variables are not overwritten.
    """
    settings_path = Path(base_dir) / "local.settings.json"
    if not settings_path.exists():
        return

    try:
        raw = json.loads(settings_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return

    values = _extract_values(raw)
    for key, value in values.items():
        if not isinstance(value, str):
            continue
        if not key.strip() or not value.strip():
            continue
        # Fill missing keys and replace explicitly empty runtime values.
        if not os.getenv(key):
            os.environ[key] = value


def _extract_values(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        nested = raw.get("Values")
        if isinstance(nested, dict):
            return nested
        return raw
    return {}
