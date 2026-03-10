from __future__ import annotations

import asyncio
import os
import unittest

from app.services import providers


class ProviderRoutingTests(unittest.TestCase):
    def test_gpt4o_prefers_azure_when_config_exists(self):
        async def fake_azure(message: str, history: list[dict], timeout_seconds: float):
            del message, history, timeout_seconds
            return "azure-ok"

        original_azure = providers.call_azure_openai_chat
        original_openai = providers.call_openai
        providers.call_azure_openai_chat = fake_azure

        async def fake_openai(message: str, history: list[dict], timeout_seconds: float):
            del message, history, timeout_seconds
            return "openai-ok"

        providers.call_openai = fake_openai

        old_values = {k: os.getenv(k) for k in [
            "AZURE_OPENAI_ENDPOINT",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_DEPLOYMENT_NAME",
            "OPENAI_API_KEY",
        ]}
        try:
            os.environ["AZURE_OPENAI_ENDPOINT"] = "https://example.cognitiveservices.azure.com"
            os.environ["AZURE_OPENAI_API_KEY"] = "key"
            os.environ["AZURE_OPENAI_DEPLOYMENT_NAME"] = "gpt-5-chat"
            os.environ["OPENAI_API_KEY"] = "openai-key"

            reply = asyncio.run(
                providers.generate_reply(model="gpt4o", message="hello", history=[])
            )
            self.assertEqual(reply, "azure-ok")
        finally:
            providers.call_azure_openai_chat = original_azure
            providers.call_openai = original_openai
            for key, value in old_values.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_gpt4o_uses_openai_when_azure_missing(self):
        async def fake_openai(message: str, history: list[dict], timeout_seconds: float):
            del message, history, timeout_seconds
            return "openai-ok"

        original_openai = providers.call_openai
        providers.call_openai = fake_openai

        old_values = {k: os.getenv(k) for k in [
            "AZURE_OPENAI_ENDPOINT",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_DEPLOYMENT_NAME",
            "OPENAI_API_KEY",
        ]}
        try:
            os.environ.pop("AZURE_OPENAI_ENDPOINT", None)
            os.environ.pop("AZURE_OPENAI_API_KEY", None)
            os.environ.pop("AZURE_OPENAI_DEPLOYMENT_NAME", None)
            os.environ["OPENAI_API_KEY"] = "openai-key"

            reply = asyncio.run(
                providers.generate_reply(model="gpt4o", message="hello", history=[])
            )
            self.assertEqual(reply, "openai-ok")
        finally:
            providers.call_openai = original_openai
            for key, value in old_values.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
