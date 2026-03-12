from __future__ import annotations

import asyncio
import os
import unittest

from fastapi import HTTPException

from app.services import providers


class ProviderRoutingTests(unittest.TestCase):
    def test_gpt5_uses_azure_when_config_exists(self):
        async def fake_azure(message: str, history: list[dict], timeout_seconds: float):
            del message, history, timeout_seconds
            return "azure-ok"

        original_azure = providers.call_azure_openai_chat
        providers.call_azure_openai_chat = fake_azure

        old_values = {k: os.getenv(k) for k in [
            "AZURE_OPENAI_ENDPOINT",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_DEPLOYMENT_NAME",
        ]}
        try:
            os.environ["AZURE_OPENAI_ENDPOINT"] = "https://example.cognitiveservices.azure.com"
            os.environ["AZURE_OPENAI_API_KEY"] = "key"
            os.environ["AZURE_OPENAI_DEPLOYMENT_NAME"] = "gpt-5-chat"

            reply = asyncio.run(
                providers.generate_reply(model="gpt-5", message="hello", history=[])
            )
            self.assertEqual(reply, "azure-ok")
        finally:
            providers.call_azure_openai_chat = original_azure
            for key, value in old_values.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_gpt5_raises_503_when_azure_missing(self):
        old_values = {k: os.getenv(k) for k in [
            "AZURE_OPENAI_ENDPOINT",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_DEPLOYMENT_NAME",
        ]}
        try:
            os.environ.pop("AZURE_OPENAI_ENDPOINT", None)
            os.environ.pop("AZURE_OPENAI_API_KEY", None)
            os.environ.pop("AZURE_OPENAI_DEPLOYMENT_NAME", None)

            with self.assertRaises(HTTPException) as context:
                asyncio.run(providers.generate_reply(model="gpt-5", message="hello", history=[]))

            self.assertEqual(context.exception.status_code, 503)
            self.assertIn("Azure OpenAI is not configured", context.exception.detail)
        finally:
            for key, value in old_values.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
