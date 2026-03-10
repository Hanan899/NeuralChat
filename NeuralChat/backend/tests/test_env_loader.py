from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.env_loader import load_local_settings_env


class EnvLoaderTests(unittest.TestCase):
    def test_loads_values_shape(self):
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "local.settings.json").write_text(
                json.dumps({"Values": {"AZURE_OPENAI_ENDPOINT": "https://example.test", "EMPTY": ""}}),
                encoding="utf-8",
            )

            os.environ.pop("AZURE_OPENAI_ENDPOINT", None)
            load_local_settings_env(base)
            self.assertEqual(os.getenv("AZURE_OPENAI_ENDPOINT"), "https://example.test")

    def test_loads_flat_shape(self):
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "local.settings.json").write_text(
                json.dumps({"AZURE_OPENAI_DEPLOYMENT_NAME": "gpt-5-chat"}),
                encoding="utf-8",
            )

            os.environ.pop("AZURE_OPENAI_DEPLOYMENT_NAME", None)
            load_local_settings_env(base)
            self.assertEqual(os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME"), "gpt-5-chat")


if __name__ == "__main__":
    unittest.main()
