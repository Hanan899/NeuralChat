from __future__ import annotations

import json
import os
from pathlib import Path

from app.env_loader import load_local_settings_env


def test_loads_values_shape(tmp_path: Path):
    settings_path = tmp_path / "local.settings.json"
    settings_path.write_text(
        json.dumps({"Values": {"AZURE_OPENAI_ENDPOINT": "https://example.test", "EMPTY": ""}}),
        encoding="utf-8",
    )

    os.environ.pop("AZURE_OPENAI_ENDPOINT", None)
    load_local_settings_env(tmp_path)

    assert os.getenv("AZURE_OPENAI_ENDPOINT") == "https://example.test"


def test_loads_flat_shape(tmp_path: Path):
    settings_path = tmp_path / "local.settings.json"
    settings_path.write_text(
        json.dumps({"AZURE_OPENAI_DEPLOYMENT_NAME": "gpt-5-chat"}),
        encoding="utf-8",
    )

    os.environ.pop("AZURE_OPENAI_DEPLOYMENT_NAME", None)
    load_local_settings_env(tmp_path)

    assert os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME") == "gpt-5-chat"
