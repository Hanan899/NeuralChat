from __future__ import annotations

import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.services import chat_service
from app.services.chat_service import tokenize_text
from app.services.storage import load_messages


class ChatServiceTests(unittest.TestCase):
    def test_tokenize_text_order(self):
        tokens = tokenize_text("Hello world, NeuralChat!")
        self.assertEqual(tokens, ["Hello ", "world, ", "NeuralChat!"])

    def test_generate_and_persist_messages(self):
        with TemporaryDirectory() as tmp:
            store_path = Path(tmp)
            request = {
                "session_id": "session-1",
                "message": "How are you?",
                "model": "claude",
                "stream": False,
            }

            async def fake_generate_reply(model: str, message: str, history: list[dict], timeout_seconds: float = 25.0):
                del timeout_seconds
                return f"reply({model}): {message}; history={len(history)}"

            original_generate_reply = chat_service.generate_model_reply
            chat_service.generate_model_reply = fake_generate_reply
            try:
                chat_service.save_user_message(request, request_id="req-1", store_path=store_path)
                reply = asyncio.run(chat_service.generate_reply(request, store_path=store_path))
            finally:
                chat_service.generate_model_reply = original_generate_reply

            chat_service.save_assistant_message(
                session_id=request["session_id"],
                model=request["model"],
                request_id="req-1",
                reply=reply,
                store_path=store_path,
            )

            saved = load_messages(store_path, "session-1")
            self.assertEqual(saved[0]["role"], "user")
            self.assertEqual(saved[1]["role"], "assistant")
            self.assertIn("reply(claude)", saved[1]["content"])


if __name__ == "__main__":
    unittest.main()
