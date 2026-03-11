from __future__ import annotations

import json
import os
import uuid
import unittest

os.environ.setdefault("NEURALCHAT_STORAGE_MODE", "memory")

from fastapi.testclient import TestClient

from app.auth import require_user_id
from app.main import STORE, app
from app.services.storage import load_messages, load_profile, reset_memory_store


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def setUp(self):
        reset_memory_store()
        app.dependency_overrides[require_user_id] = lambda: "user-test"

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_health_returns_expected_shape(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertIn("timestamp", payload)
        self.assertIn("version", payload)

    def test_chat_requires_auth_without_token(self):
        app.dependency_overrides.pop(require_user_id, None)

        response = self.client.post(
            "/api/chat",
            json={
                "session_id": "s-1",
                "message": "hello",
                "model": "claude",
                "stream": False,
            },
        )
        self.assertEqual(response.status_code, 401)

    def test_me_requires_auth_without_token(self):
        app.dependency_overrides.pop(require_user_id, None)
        response = self.client.get("/api/me")
        self.assertEqual(response.status_code, 401)

    def test_me_returns_user_profile(self):
        response = self.client.get("/api/me")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["user_id"], "user-test")
        self.assertIsInstance(payload["profile"], dict)
        self.assertEqual(load_profile(STORE, "user-test").get("user_id"), "user-test")

    def test_chat_rejects_invalid_model(self):
        response = self.client.post(
            "/api/chat",
            json={
                "session_id": "s-1",
                "message": "hello",
                "model": "invalid-model",
                "stream": False,
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_chat_stream_emits_token_then_done(self):
        session_id = f"s-{uuid.uuid4()}"
        response = self.client.post(
            "/api/chat",
            json={
                "session_id": session_id,
                "message": "test stream",
                "model": "claude",
                "stream": True,
            },
        )
        self.assertEqual(response.status_code, 200)

        chunks = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        self.assertGreaterEqual(len(chunks), 2)
        self.assertEqual(chunks[0]["type"], "token")
        self.assertEqual(chunks[-1]["type"], "done")
        self.assertEqual(chunks[-1]["status"], "completed")
        self.assertIsInstance(chunks[-1]["first_token_ms"], int)
        self.assertIsInstance(chunks[-1]["tokens_emitted"], int)

        # Verify user-scoped persistence in storage.
        stored = load_messages(STORE, "user-test", session_id)
        self.assertEqual(len(stored), 2)
        self.assertEqual(stored[0]["role"], "user")
        self.assertEqual(stored[1]["role"], "assistant")

    def test_chat_options_preflight_allowed(self):
        response = self.client.options(
            "/api/chat",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:5173")


if __name__ == "__main__":
    unittest.main()
