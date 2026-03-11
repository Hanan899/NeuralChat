from __future__ import annotations

import asyncio
import os
import unittest

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from app.services import chat_service
from app.services.chat_service import tokenize_text
from app.services.storage import init_store, load_messages, reset_memory_store


class ChatServiceTests(unittest.TestCase):
    def test_tokenize_text_order(self):
        tokens = tokenize_text("Hello world, NeuralChat!")
        self.assertEqual(tokens, ["Hello ", "world, ", "NeuralChat!"])

    def test_generate_and_persist_messages(self):
        store = init_store()
        reset_memory_store()

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
            chat_service.save_user_message(request, request_id="req-1", store=store, user_id="user-1")
            reply = asyncio.run(chat_service.generate_reply(request, store=store, user_id="user-1"))
        finally:
            chat_service.generate_model_reply = original_generate_reply

        chat_service.save_assistant_message(
            session_id=request["session_id"],
            model=request["model"],
            request_id="req-1",
            reply=reply,
            store=store,
            user_id="user-1",
        )

        saved = load_messages(store, "user-1", "session-1")
        self.assertEqual(saved[0]["role"], "user")
        self.assertEqual(saved[1]["role"], "assistant")
        self.assertIn("reply(claude)", saved[1]["content"])
        self.assertEqual(saved[1]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
